/**
 * File-backed `CredentialStore` (auth.json, one credential per provider id).
 * Every Nyte client shares this one file, so each mutation holds a lock that
 * spans the whole read-modify-write — including the OAuth refresh `Models`
 * runs inside `modify`, which rotates the refresh token and must happen once
 * across all processes — and publishes by atomic rename. Reads take no lock:
 * rename means a reader sees the previous file or the next one, never a
 * partial write.
 *
 * Based on https://github.com/earendil-works/pi/blob/dev/packages/ai/src/auth/credential-store.ts
 * Synced with pi 7ebf9087e. Nyte divergence: pi's store is in-memory and its
 * CLI locks auth.json with proper-lockfile; Nyte owns the persistent store and
 * locks with an exclusively created file, keeping the dependency out of the
 * packaged desktop and binary builds.
 */
import { randomUUID } from "node:crypto";
import {
  closeSync,
  existsSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { hostname } from "node:os";
import { dirname, join } from "node:path";
import process from "node:process";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { defaultNyteHome } from "../utils/nyte-home.ts";
import type { AuthOperationOptions, Credential, CredentialInfo, CredentialStore } from "./types.ts";

export function defaultAuthPath(): string {
  return join(defaultNyteHome(), "auth.json");
}

/** Longer than a healthy credential write, including the OAuth refresh `modify` runs. */
const LOCK_TIMEOUT_MS = 30_000;

const LOCK_RETRY_MS = 25;

/**
 * Age at which a lock is reclaimed even though a live process still claims it:
 * pids get reused, and a refresh that hangs without a timeout of its own would
 * otherwise lock every client out permanently. Longer than `LOCK_TIMEOUT_MS`,
 * so reclaiming lands on a later command instead of cutting short a waiter,
 * and a holder that loses its lock this way finds out before it writes.
 */
const LOCK_ABANDONED_MS = 2 * LOCK_TIMEOUT_MS;

/** Age at which a recovery that never finished counts as crash residue instead of a live one. */
const RECOVERY_STALE_MS = 1_000;

const CredentialSchema = Type.Union([
  Type.Object({
    type: Type.Literal("api_key"),
    key: Type.Optional(Type.String()),
    env: Type.Optional(Type.Record(Type.String(), Type.String())),
  }),
  Type.Object({
    type: Type.Literal("oauth"),
    refresh: Type.String(),
    access: Type.String(),
    expires: Type.Number(),
  }),
]);

const CredentialFileSchema = Type.Record(Type.String(), Type.Unknown());

const SystemErrorSchema = Type.Object({ code: Type.String() });

/**
 * auth.json is an external boundary. Provider-specific extras (Codex account
 * ids, Copilot model ids) ride along on the value, and an entry this version
 * cannot read is reported as no credential rather than rewritten.
 */
function toCredential(value: unknown): Credential | undefined {
  return Value.Check(CredentialSchema, value) ? value : undefined;
}

function errorCode(cause: unknown): string | undefined {
  return Value.Check(SystemErrorSchema, cause) ? cause.code : undefined;
}

/**
 * `${pid} ${host} ${token}`: the host name keeps a shared home directory from
 * judging another machine's pid, and the token makes every acquisition
 * distinct, including two from the same process.
 */
function lockOwner(): string {
  return `${process.pid} ${hostname()} ${randomUUID()}`;
}

function readOwner(lockPath: string): string | undefined {
  try {
    return readFileSync(lockPath, "utf8");
  } catch {
    return undefined;
  }
}

function localOwnerPid(owner: string | undefined): number | undefined {
  if (owner === undefined) return undefined;
  const [pid, host] = owner.split(" ");

  if (host !== hostname()) return undefined;
  const parsed = Number(pid);

  return Number.isSafeInteger(parsed) && parsed > 0 ? parsed : undefined;
}

function isRunning(pid: number): boolean {
  try {
    process.kill(pid, 0);

    return true;
  } catch (error) {
    // EPERM: the process exists but belongs to another user.
    return errorCode(error) === "EPERM";
  }
}

function ageMs(path: string): number | undefined {
  try {
    return Date.now() - statSync(path).mtimeMs;
  } catch {
    // Gone while being inspected; the next create attempt decides.
    return undefined;
  }
}

/** Abandoned when the owning process is gone, and unconditionally once the lock ages out. */
function isAbandoned(lockPath: string): boolean {
  const pid = localOwnerPid(readOwner(lockPath));

  if (pid !== undefined && !isRunning(pid)) return true;
  const age = ageMs(lockPath);

  return age !== undefined && age > LOCK_ABANDONED_MS;
}

/**
 * A lock can change hands while its holder is still working: an aged-out hold
 * is reclaimed on purpose, and a crashed recovery can be taken over. `held` is
 * the backstop for both. The holder that lost its lock fails instead of
 * publishing over the client that owns it now.
 */
interface CredentialLock {
  held(): boolean;
  release(): void;
}

function createLock(lockPath: string, owner: string): boolean {
  let handle: number;

  try {
    handle = openSync(lockPath, "wx", 0o600);
  } catch (error) {
    if (errorCode(error) === "EEXIST") return false;
    throw error;
  }

  try {
    writeSync(handle, owner);
  } finally {
    closeSync(handle);
  }

  return true;
}

/**
 * Reclaiming is check-then-remove, so it runs under its own lock: a client that
 * judged the lock abandoned before another client replaced it re-checks here
 * under exclusion and finds a live lock instead of deleting it. Without that,
 * two clients recovering from one crash both remove and create, and both end up
 * inside the critical section.
 */
function reclaimAbandonedLock(lockPath: string, owner: string): void {
  const recoveryPath = `${lockPath}.recovery`;

  if (!createLock(recoveryPath, owner)) {
    // Reclaiming is two syscalls, so an aged recovery lock is residue from a crash.
    const age = ageMs(recoveryPath);

    if (age !== undefined && age > RECOVERY_STALE_MS) rmSync(recoveryPath, { force: true });

    return;
  }

  try {
    if (isAbandoned(lockPath)) rmSync(lockPath, { force: true });
  } finally {
    rmSync(recoveryPath, { force: true });
  }
}

async function acquireLock(
  lockPath: string,
  signal: AbortSignal | undefined,
): Promise<CredentialLock> {
  const owner = lockOwner();

  const lock: CredentialLock = {
    held: () => readOwner(lockPath) === owner,
    release: () => {
      // Keep a lock that now names another process; drop an unreadable one,
      // since leaking it blocks every client until it ages out.
      if (readOwner(lockPath) !== owner) return;

      try {
        rmSync(lockPath, { force: true });
      } catch {
        // A failed release must not mask a completed write; the age cap recovers it.
        return;
      }
    },
  };

  const deadline = Date.now() + LOCK_TIMEOUT_MS;

  for (;;) {
    signal?.throwIfAborted();

    if (createLock(lockPath, owner)) return lock;

    if (Date.now() >= deadline) {
      throw new Error(`Timed out waiting for the credential lock at ${lockPath}`);
    }

    if (isAbandoned(lockPath)) reclaimAbandonedLock(lockPath, owner);
    await new Promise<void>((resolve) => {
      setTimeout(resolve, LOCK_RETRY_MS);
    });
  }
}

/**
 * File-backed credential store. The file is created 0600 under a 0700
 * directory. Storage failures reject instead of resolving empty, so a file
 * that cannot be read is never replaced by one that drops its credentials.
 */
export class FileCredentialStore implements CredentialStore {
  private readonly path: string;
  private readonly lockPath: string;

  constructor(path: string = defaultAuthPath()) {
    this.path = path;
    this.lockPath = `${path}.lock`;
  }

  /** Entries stay `unknown` so an unreadable credential survives another provider's write. */
  private load(): Record<string, unknown> {
    if (!existsSync(this.path)) return {};
    const text = readFileSync(this.path, "utf8");

    let parsed: unknown;

    try {
      parsed = JSON.parse(text);
    } catch (error) {
      throw new Error(`${this.path} is not valid JSON. Fix or remove it, then sign in again.`, {
        cause: error,
      });
    }

    if (!Value.Check(CredentialFileSchema, parsed)) {
      throw new Error(`${this.path} does not hold credentials keyed by provider`);
    }

    return parsed;
  }

  /** Publish by rename so a concurrent reader never observes a half-written file. */
  private save(lock: CredentialLock, entries: Record<string, unknown>): void {
    // An advisory lock cannot make this check and the rename one step; it keeps
    // a holder that already lost its lock from overwriting the current owner.
    if (!lock.held()) {
      throw new Error(`Another process took over ${this.lockPath}; nothing was written`);
    }

    const staging = `${this.path}.${process.pid}.tmp`;

    try {
      writeFileSync(staging, `${JSON.stringify(entries, null, 2)}\n`, { mode: 0o600 });
      renameSync(staging, this.path);
    } catch (error) {
      rmSync(staging, { force: true });
      throw error;
    }
  }

  private async withLock<T>(
    run: (lock: CredentialLock) => Promise<T>,
    options?: AuthOperationOptions,
  ): Promise<T> {
    options?.signal?.throwIfAborted();
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const lock = await acquireLock(this.lockPath, options?.signal);

    try {
      return await run(lock);
    } finally {
      lock.release();
    }
  }

  async read(providerId: string, options?: AuthOperationOptions): Promise<Credential | undefined> {
    options?.signal?.throwIfAborted();

    return toCredential(this.load()[providerId]);
  }

  async list(options?: AuthOperationOptions): Promise<readonly CredentialInfo[]> {
    options?.signal?.throwIfAborted();
    const stored: CredentialInfo[] = [];

    for (const [providerId, value] of Object.entries(this.load())) {
      const credential = toCredential(value);

      if (credential) stored.push({ providerId, type: credential.type });
    }

    return stored;
  }

  modify(
    providerId: string,
    fn: (current: Credential | undefined) => Promise<Credential | undefined>,
    options?: AuthOperationOptions,
  ): Promise<Credential | undefined> {
    return this.withLock(async (lock) => {
      const entries = this.load();
      const current = toCredential(entries[providerId]);
      const next = await fn(current);

      // A credential `fn` already produced is persisted even when the caller
      // stopped waiting: a refresh rotates the token the stored one replaces,
      // so dropping it here would leave a spent credential on disk.
      if (next !== undefined) {
        entries[providerId] = next;
        this.save(lock, entries);
      }

      return next ?? current;
    }, options);
  }

  delete(providerId: string, options?: AuthOperationOptions): Promise<void> {
    return this.withLock(async (lock) => {
      const entries = this.load();

      if (providerId in entries) {
        delete entries[providerId];
        this.save(lock, entries);
      }
    }, options);
  }
}
