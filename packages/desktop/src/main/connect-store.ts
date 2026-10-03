/**
 * Account remote access on disk: `~/.nyte/connect.json`, mode 0600 beside the
 * other credential stores. The machine key is sealed by the OS keychain
 * before it reaches the file; device tokens exist here only as SHA-256
 * digests; session JWTs and leases never do.
 *
 * Every change lands on disk before it is visible, through an fsynced
 * temporary file renamed into place. A file that cannot be read, does not
 * parse, is from another version, or cannot be written makes the store
 * `failed` for the life of the process, and a failed store authorizes nothing.
 */
import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Type } from "typebox";
import type { Static, TProperties } from "typebox";
import { Compile } from "typebox/compile";
import {
  Base64Url32,
  BrokerKeys,
  ClientId,
  DEVICE_LIMIT,
  Name,
  RandomId,
  Uuid,
} from "@nyte-ai/connect";

/** Encrypts secrets with a key the OS holds for this app. */
export interface SecretCipher {
  /** False when the OS would store the key in plain text, or has none. */
  available(): boolean;
  seal(plain: string): string;
  /** Throws when the sealed text is not this app's. */
  open(sealed: string): string;
}

/** Local revocations whose broker revoke has not been confirmed. */
export const REVOCATION_LIMIT = 64;

/** Enrollment ids consumed and not yet expired. */
export const CONSUMED_LIMIT = 256;

/** Unlinks the broker has not confirmed. */
export const UNLINK_LIMIT = 8;

const strict = <P extends TProperties>(properties: P) =>
  Type.Object(properties, { additionalProperties: false });

const Sealed = Type.String({ minLength: 1, maxLength: 16_384 });

const Time = Type.Integer({ minimum: 0 });

const StoredDevice = strict({
  id: Uuid,
  clientId: ClientId,
  name: Name,
  digest: Base64Url32,
  /** When this desktop recorded it, by this desktop's clock. */
  createdAt: Time,
});

export type StoredDevice = Static<typeof StoredDevice>;

const StoredLink = strict({
  environment: strict({ id: Uuid, name: Name }),
  owner: strict({
    id: Type.String({ minLength: 1, maxLength: 128 }),
    label: Type.String({ maxLength: 320 }),
  }),
  /** The sealed machine key, a `PrivateJwk`. */
  key: Sealed,
  brokerKeys: BrokerKeys,
  devices: Type.Array(StoredDevice, { maxItems: DEVICE_LIMIT }),
  /**
   * Removed here; the broker call is retried until it answers. A `release`
   * came from the device itself and leaves its Clerk session alone; a
   * `revoke` came from this Mac's user and also ends that session. A revoke
   * replaces a release for the same device, never the other way round.
   */
  revocations: Type.Array(
    strict({
      deviceId: Uuid,
      kind: Type.Union([Type.Literal("release"), Type.Literal("revoke")]),
      at: Time,
    }),
    { maxItems: REVOCATION_LIMIT },
  ),
  /** Enrollment `jti`s, kept until they expire so a replay is refused. */
  consumed: Type.Array(strict({ jti: RandomId, exp: Time }), { maxItems: CONSUMED_LIMIT }),
});

export type StoredLink = Static<typeof StoredLink>;

const PendingUnlink = strict({ environmentId: Uuid, key: Sealed, at: Time });

export type PendingUnlink = Static<typeof PendingUnlink>;

const ConnectFileType = strict({
  version: Type.Literal(2),
  /** Serve whenever Nyte runs. Off by default. */
  enabled: Type.Boolean(),
  link: Type.Union([StoredLink, Type.Null()]),
  /**
   * The sealed key of a link the broker may have begun; a retry by the same
   * account resumes it. `owner` is the session JWT's `sub` as read here, for
   * this bookkeeping only; the broker decides who owns what.
   */
  linkKey: Type.Union([
    strict({
      sealed: Sealed,
      owner: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
    }),
    Type.Null(),
  ]),
  unlinks: Type.Array(PendingUnlink, { maxItems: UNLINK_LIMIT }),
});

const connectFile = Compile(ConnectFileType);

export type ConnectFile = Static<typeof ConnectFileType>;

export const EMPTY_CONNECT_FILE: ConnectFile = {
  version: 2,
  enabled: false,
  link: null,
  linkKey: null,
  unlinks: [],
};

export type ConnectRead =
  | { readonly kind: "ready"; readonly file: ConnectFile }
  | { readonly kind: "failed" };

export class ConnectStoreFailed extends Error {
  constructor() {
    super("The account remote access store could not be read or written");
    this.name = "ConnectStoreFailed";
  }
}

async function syncDirectory(path: string): Promise<void> {
  const handle = await open(path, "r");

  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}

function isMissing(cause: unknown): boolean {
  return cause instanceof Error && "code" in cause && cause.code === "ENOENT";
}

export class ConnectStore {
  private readonly path: string;
  private loading: Promise<ConnectRead> | undefined;
  private loaded: ConnectRead | undefined;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(path: string) {
    this.path = path;
  }

  /** The file as the last write left it; the disk is read once. */
  async read(): Promise<ConnectRead> {
    this.loading ??= this.load().then((read) => {
      this.loaded ??= read;

      return read;
    });
    const first = await this.loading;

    return this.loaded ?? first;
  }

  /** What the last read or write left, without waiting; undefined before the first read. */
  snapshot(): ConnectRead | undefined {
    return this.loaded;
  }

  /**
   * Apply `change` to the file as every earlier change left it, then persist.
   * Changes run one at a time. A failed write fails the store for good.
   */
  update<T>(
    change: (file: ConnectFile) => { readonly file: ConnectFile; readonly result: T },
  ): Promise<T> {
    const run = this.writes.then(async () => {
      const loaded = await this.read();

      if (loaded.kind === "failed") throw new ConnectStoreFailed();
      const next = change(loaded.file);

      if (next.file === loaded.file) return next.result;

      if (!connectFile.Check(next.file)) throw new ConnectStoreFailed();

      try {
        await this.persist(next.file);
      } catch {
        this.loaded = { kind: "failed" };
        throw new ConnectStoreFailed();
      }

      this.loaded = { kind: "ready", file: next.file };

      return next.result;
    });

    this.writes = run.catch(() => undefined);

    return run;
  }

  private async load(): Promise<ConnectRead> {
    let text: string;

    try {
      text = await readFile(this.path, "utf8");
    } catch (cause) {
      return isMissing(cause) ? { kind: "ready", file: EMPTY_CONNECT_FILE } : { kind: "failed" };
    }

    try {
      return { kind: "ready", file: connectFile.Parse(JSON.parse(text)) };
    } catch {
      return { kind: "failed" };
    }
  }

  private async persist(file: ConnectFile): Promise<void> {
    const directory = dirname(this.path);
    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomBytes(8).toString("hex")}.tmp`;

    try {
      const handle = await open(temporary, "wx", 0o600);

      try {
        await handle.writeFile(`${JSON.stringify(file, null, 2)}\n`);
        await handle.sync();
      } finally {
        await handle.close();
      }

      await rename(temporary, this.path);
    } catch (cause) {
      await rm(temporary, { force: true }).catch(() => undefined);
      throw cause;
    }

    await syncDirectory(directory);
  }
}
