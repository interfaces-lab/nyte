import { open } from "node:fs/promises";
import { Type } from "typebox";
import type { Static, TProperties } from "typebox";
import { Compile } from "typebox/compile";
import {
  Base64Url32,
  BrokerKeys,
  ClientId,
  DEVICE_LIMIT,
  DeviceRole,
  Name,
  RandomId,
  UserCode,
  Uuid,
} from "../index.ts";
import { PrivateJwk } from "../signing.ts";
import { storeFailed } from "./errors.ts";
import { writePrivateFile } from "./private-file.ts";

/** Local revocations whose broker revoke has not been confirmed. */
export const REVOCATION_LIMIT = 64;

/** Enrollment ids consumed and not yet expired. */
export const CONSUMED_LIMIT = 256;

/** Unlinks the broker has not confirmed. */
export const UNLINK_LIMIT = 8;

const strict = <P extends TProperties>(properties: P) =>
  Type.Object(properties, { additionalProperties: false });

const Time = Type.Integer({ minimum: 0 });

const Origin = Type.String({ pattern: "^https://[^/?#]+$", maxLength: 256 });

const StoredDevice = strict({
  id: Uuid,
  clientId: ClientId,
  name: Name,
  digest: Base64Url32,
  createdAt: Time,
  role: DeviceRole,
});

export type StoredDevice = Static<typeof StoredDevice>;

const StoredLink = strict({
  origin: Origin,
  environment: strict({ id: Uuid, name: Name }),
  owner: strict({
    id: Type.String({ minLength: 1, maxLength: 128 }),
    label: Type.String({ maxLength: 320 }),
  }),
  key: PrivateJwk,
  brokerKeys: BrokerKeys,
  devices: Type.Array(StoredDevice, { maxItems: DEVICE_LIMIT }),
  revocations: Type.Array(
    strict({
      deviceId: Uuid,
      kind: Type.Union([Type.Literal("release"), Type.Literal("revoke")]),
      at: Time,
    }),
    { maxItems: REVOCATION_LIMIT },
  ),
  consumed: Type.Array(strict({ jti: RandomId, exp: Time }), { maxItems: CONSUMED_LIMIT }),
});

export type StoredLink = Static<typeof StoredLink>;

const PendingUnlink = strict({ origin: Origin, environmentId: Uuid, key: PrivateJwk, at: Time });

const LinkKey = Type.Union([
  strict({
    kind: Type.Literal("session"),
    origin: Origin,
    key: PrivateJwk,
    owner: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
  }),
  strict({
    kind: Type.Literal("transaction"),
    origin: Origin,
    key: PrivateJwk,
    operationId: RandomId,
    userCode: UserCode,
    name: Name,
    abandoned: Type.Boolean(),
    transaction: Type.Union([
      strict({
        id: Uuid,
        verifyUrl: Type.String({ maxLength: 2048 }),
        expiresAt: Time,
      }),
      Type.Null(),
    ]),
  }),
]);

export type LinkKey = Static<typeof LinkKey>;

type PendingUnlink = Static<typeof PendingUnlink>;

const ConnectFileType = strict({
  version: Type.Literal(4),
  enabled: Type.Boolean(),
  link: Type.Union([StoredLink, Type.Null()]),
  linkKey: Type.Union([LinkKey, Type.Null()]),
  unlinks: Type.Array(PendingUnlink, { maxItems: UNLINK_LIMIT }),
});

const connectFile = Compile(ConnectFileType);

export type ConnectFile = Static<typeof ConnectFileType>;

export const EMPTY_CONNECT_FILE: ConnectFile = {
  version: 4,
  enabled: false,
  link: null,
  linkKey: null,
  unlinks: [],
};

type ConnectRead =
  | { readonly kind: "ready"; readonly file: ConnectFile }
  | { readonly kind: "failed" };

export class ConnectStoreFailed extends Error {
  constructor() {
    super("The account remote access store could not be read or written");
    this.name = "ConnectStoreFailed";
  }
}

/**
 * The Connect state file as every part of the runtime reads and changes it. `origin` is the
 * broker this build talks to, so a link through any other is not current; `onFailed` runs when a
 * `change` fails, before the caller hears `storeFailed`.
 */
export class ConnectStore {
  private readonly path: string;
  private readonly origin: string | undefined;
  private readonly onFailed: () => void;
  private loading: Promise<ConnectRead> | undefined;
  private loaded: ConnectRead | undefined;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(
    path: string,
    owner: { readonly origin?: string; readonly onFailed?: () => void } = {},
  ) {
    this.path = path;
    this.origin = owner.origin;
    this.onFailed = owner.onFailed ?? (() => undefined);
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

  /** The file, or `storeFailed` when it cannot be used. */
  async ready(): Promise<ConnectFile> {
    const read = await this.read();

    if (read.kind === "failed") throw storeFailed();

    return read.file;
  }

  /** The file as the last read or write left it, without waiting; undefined before the first read or after a failure. */
  loadedFile(): ConnectFile | undefined {
    return this.loaded?.kind === "ready" ? this.loaded.file : undefined;
  }

  /** The stored link when it is the one for `environmentId` through this build's broker. */
  currentLink(environmentId: string): StoredLink | undefined {
    const link = this.loadedFile()?.link ?? null;

    return link !== null && link.environment.id === environmentId && link.origin === this.origin
      ? link
      : undefined;
  }

  /** Applies `change` as `update` does; a failure runs `onFailed` and rejects with `storeFailed`. */
  async change(change: (file: ConnectFile) => ConnectFile): Promise<void> {
    try {
      await this.update((file) => ({ file: change(file), result: undefined }));
    } catch (cause) {
      if (!(cause instanceof ConnectStoreFailed)) throw cause;
      this.onFailed();
      throw storeFailed();
    }
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
        await writePrivateFile({
          path: this.path,
          text: `${JSON.stringify(next.file, null, 2)}\n`,
        });
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

  /** Settles once every change queued so far, and any queued while waiting, has landed or failed. */
  async idle(): Promise<void> {
    let tail: Promise<unknown>;

    do {
      tail = this.writes;
      await tail;
    } while (tail !== this.writes);
  }

  private async load(): Promise<ConnectRead> {
    let text: string;

    try {
      const handle = await open(this.path, "r");

      try {
        const stats = await handle.stat();

        if (process.platform !== "win32" && (!stats.isFile() || (stats.mode & 0o077) !== 0)) {
          return { kind: "failed" };
        }

        text = await handle.readFile("utf8");
      } finally {
        await handle.close();
      }
    } catch (cause) {
      return cause instanceof Error && "code" in cause && cause.code === "ENOENT"
        ? { kind: "ready", file: EMPTY_CONNECT_FILE }
        : { kind: "failed" };
    }

    try {
      return { kind: "ready", file: connectFile.Parse(JSON.parse(text)) };
    } catch {
      return { kind: "failed" };
    }
  }
}
