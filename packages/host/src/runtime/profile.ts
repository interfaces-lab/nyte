/**
 * A host profile: one runtime identity and everything it owns on disk, under
 * `<nyteHome>/hosts/<name>/`. The identity key and bearer token are created
 * once; the session store, workspace registry, trust rows, start journal and
 * Connect state live beside them, so two profiles never share a database
 * because they happen to serve the same folder.
 *
 * One live process owns a profile at a time. Ownership is an OS lock: the
 * owner holds a write transaction open on `owner.db` for its whole life, and
 * the kernel releases it when the process ends, cleanly or not. A second
 * opener is refused at once and reads who holds it. Nothing here guesses
 * whether a pid is alive, and nothing deletes another process's claim.
 *
 * `readProfile` inspects without creating or locking; what it reads is saved
 * state, not a live host.
 */
import { randomBytes, randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, rm, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { HostIdentity, IdentityChallenge } from "@nyte-ai/protocol";
import { isFileError, nyteHome } from "../paths.ts";
import {
  ProfileKey,
  generateProfileKey,
  keyThumbprint,
  publicKeyOf,
  signIdentityChallenge,
} from "./identity.ts";

export const PROFILE_NAME_PATTERN = /^[a-z0-9][a-z0-9_-]{0,63}$/u;

const IdentityFile = Type.Object(
  { version: Type.Literal(1), key: ProfileKey, createdAt: Type.Number({ minimum: 0 }) },
  { additionalProperties: false },
);

const OwnerRow = Type.Object({
  pid: Type.Integer({ minimum: 1 }),
  nonce: Type.String({ minLength: 1 }),
  started_at: Type.Number({ minimum: 0 }),
});

/** A profile directory or secret that other users could read; refused rather than used. */
export class ProfileExposed extends Error {
  readonly path: string;

  constructor(path: string, expected: string) {
    super(
      `${path} is readable by other users; make it ${expected} (chmod ${expected} ${path}) and start again.`,
    );
    this.name = "ProfileExposed";
    this.path = path;
  }
}

/** On POSIX, refuse a directory or file that grants group or others anything. */
async function requirePrivate(path: string, expected: "700" | "600"): Promise<void> {
  if (process.platform === "win32") return;
  const info = await stat(path);

  if ((info.mode & 0o077) !== 0) throw new ProfileExposed(path, expected);
}

export class ProfileLocked extends Error {
  readonly owner: { readonly pid: number; readonly startedAt: number } | undefined;

  constructor(
    name: string,
    owner: { readonly pid: number; readonly startedAt: number } | undefined,
  ) {
    super(
      owner === undefined
        ? `Host profile "${name}" is in use by another process.`
        : `Host profile "${name}" is in use by pid ${String(owner.pid)}.`,
    );
    this.name = "ProfileLocked";
    this.owner = owner;
  }
}

/** The paths a profile owns. Reading them needs no lock; writing them needs the owner. */
export interface ProfilePaths {
  readonly name: string;
  readonly directory: string;
  readonly storePath: string;
  readonly registryPath: string;
  readonly startsPath: string;
  readonly connectPath: string;
  readonly tokenPath: string;
}

/** Saved identity, as a status command reads it. No token, no key, no lock. */
export interface SavedProfile extends ProfilePaths, HostIdentity {
  readonly createdAt: number;
}

export interface HostProfile extends ProfilePaths, HostIdentity {
  /** The direct-access bearer, read from `token`; the owner principal's credential. */
  readonly token: string;
  /** Epoch milliseconds this owner took the profile. */
  readonly epoch: number;
  sign(nonce: string): IdentityChallenge;
  /** Give ownership back. Idempotent. */
  release(): Promise<void>;
}

export function profileDirectory(name: string, home = nyteHome()): string {
  if (!PROFILE_NAME_PATTERN.test(name)) {
    throw new Error(
      `Profile names use lowercase letters, digits, "-" and "_", up to 64 characters: ${name}`,
    );
  }

  return join(home, "hosts", name);
}

function paths(name: string, directory: string): ProfilePaths {
  return {
    name,
    directory,
    storePath: join(directory, "sessions.db"),
    registryPath: join(directory, "registry.json"),
    startsPath: join(directory, "starts.db"),
    connectPath: join(directory, "connect.json"),
    tokenPath: join(directory, "token"),
  };
}

async function readIdentity(
  path: string,
): Promise<{ key: ProfileKey; createdAt: number } | undefined> {
  const text = await readFile(path, "utf8").catch((cause: unknown) => {
    if (isFileError(cause, ["ENOENT"])) return undefined;
    throw cause;
  });

  if (text === undefined) return undefined;
  let parsed: unknown;

  try {
    parsed = JSON.parse(text);
  } catch {
    throw new Error(`Corrupt host identity: ${path}`);
  }

  if (!Value.Check(IdentityFile, parsed)) throw new Error(`Corrupt host identity: ${path}`);

  return { key: parsed.key, createdAt: parsed.createdAt };
}

/**
 * Publish a secret file once: written whole and synced under a private
 * temporary name, then linked into place. A reader never sees a partial
 * file, and a concurrent creator finds the winner rather than replacing it.
 */
async function publishOnce(path: string, text: string): Promise<void> {
  const temporary = `${path}.${randomUUID()}.tmp`;

  try {
    const handle = await open(temporary, "wx", 0o600);

    try {
      await handle.writeFile(text, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }

    await link(temporary, path);
    // The entry itself must reach disk too, or a crash can forget the file the data sync kept.
    const directory = await open(dirname(path), "r");

    try {
      await directory.sync();
    } finally {
      await directory.close();
    }
  } catch (cause) {
    if (!isFileError(cause, ["EEXIST"])) throw cause;
  } finally {
    await rm(temporary, { force: true });
  }
}

/**
 * Hold the profile for this process. `BEGIN IMMEDIATE` takes SQLite's
 * reserved lock, which the OS enforces across processes and connections and
 * releases when the holder exits. The owner row is committed first so a
 * refused opener can read who holds the profile.
 */
function claimOwnership(directory: string, name: string, startedAt: number): () => void {
  const db = new DatabaseSync(join(directory, "owner.db"));

  try {
    db.exec("PRAGMA busy_timeout = 0");
    db.exec(
      "CREATE TABLE IF NOT EXISTS owner (id INTEGER PRIMARY KEY CHECK (id = 1), pid INTEGER NOT NULL, nonce TEXT NOT NULL, started_at INTEGER NOT NULL)",
    );
  } catch (cause) {
    db.close();
    throw cause;
  }

  const nonce = randomUUID();

  const current = (): { readonly pid: number; readonly startedAt: number } | undefined => {
    const row: unknown = db.prepare("SELECT pid, nonce, started_at FROM owner WHERE id = 1").get();

    return Value.Check(OwnerRow, row) ? { pid: row.pid, startedAt: row.started_at } : undefined;
  };

  try {
    db.exec("BEGIN IMMEDIATE");
  } catch {
    const owner = current();
    db.close();
    throw new ProfileLocked(name, owner);
  }

  db.prepare(
    "INSERT INTO owner (id, pid, nonce, started_at) VALUES (1, ?, ?, ?) ON CONFLICT (id) DO UPDATE SET pid = excluded.pid, nonce = excluded.nonce, started_at = excluded.started_at",
  ).run(process.pid, nonce, startedAt);
  db.exec("COMMIT");

  // Between COMMIT and this BEGIN another process could slip in; its own
  // committed row then names it, and this BEGIN fails, so the claim is honest.
  try {
    db.exec("BEGIN IMMEDIATE");
  } catch {
    const owner = current();
    db.close();
    throw new ProfileLocked(name, owner);
  }

  const held = current();

  if (held === undefined || held.pid !== process.pid) {
    db.exec("ROLLBACK");
    db.close();
    throw new ProfileLocked(name, held);
  }

  let released = false;

  return () => {
    if (released) return;
    released = true;
    db.exec("ROLLBACK");
    db.close();
  };
}

/** Saved state only: no directory, key or token is created, and no lock is taken. */
export async function readProfile(name: string, home?: string): Promise<SavedProfile | undefined> {
  const directory = profileDirectory(name, home);
  const identity = await readIdentity(join(directory, "identity.json"));

  if (identity === undefined) return undefined;
  await requirePrivate(directory, "700");
  const publicKey = publicKeyOf(identity.key);

  return {
    ...paths(name, directory),
    hostId: keyThumbprint(publicKey),
    publicKey,
    createdAt: identity.createdAt,
  };
}

/** Take exclusive ownership, creating the profile on first use. */
export async function openProfile(name: string, home?: string): Promise<HostProfile> {
  const directory = profileDirectory(name, home);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  // mkdir leaves an existing directory's mode alone; a profile another user can read is not ours to use.
  await requirePrivate(directory, "700");
  const epoch = Date.now();
  const release = claimOwnership(directory, name, epoch);

  try {
    const identityPath = join(directory, "identity.json");
    const tokenPath = join(directory, "token");
    await publishOnce(
      identityPath,
      `${JSON.stringify({ version: 1, key: generateProfileKey(), createdAt: epoch })}\n`,
    );
    await requirePrivate(identityPath, "600");
    const identity = await readIdentity(identityPath);

    if (identity === undefined) throw new Error(`Host identity was not created: ${identityPath}`);
    await publishOnce(tokenPath, `${randomBytes(32).toString("base64url")}\n`);
    await requirePrivate(tokenPath, "600");
    const token = (await readFile(tokenPath, "utf8")).trim();

    if (token.length < 16) throw new Error(`Corrupt host token: ${tokenPath}`);
    const { key } = identity;
    const publicKey = publicKeyOf(key);
    let released = false;

    return {
      ...paths(name, directory),
      hostId: keyThumbprint(publicKey),
      publicKey,
      token,
      epoch,
      sign: (nonce) => signIdentityChallenge({ key, nonce, epoch }),
      release: async () => {
        if (released) return;
        released = true;
        release();
      },
    };
  } catch (cause) {
    release();
    throw cause;
  }
}
