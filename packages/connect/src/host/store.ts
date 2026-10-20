import { open, stat } from "node:fs/promises";
import { serial } from "@nyte-ai/schema/serial";
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
import { lockFile } from "./file-lock.ts";
import { writePrivateFile } from "./private-file.ts";

export const REVOCATION_LIMIT = 64;

export const CONSUMED_LIMIT = 256;

export const UNLINK_LIMIT = 8;

const strict = <P extends TProperties>(properties: P) =>
  Type.Object(properties, { additionalProperties: false });

const Time = Type.Integer({ minimum: 0 });

const Origin = Type.String({ pattern: "^https://[^/?#]+$", maxLength: 256 });

const deviceFields = {
  id: Uuid,
  clientId: ClientId,
  name: Name,
  digest: Base64Url32,
  createdAt: Time,
};

const StoredDevice = strict({ ...deviceFields, role: DeviceRole });

export type StoredDevice = Static<typeof StoredDevice>;

const linkFields = {
  environment: strict({ id: Uuid, name: Name }),
  owner: strict({
    id: Type.String({ minLength: 1, maxLength: 128 }),
    label: Type.String({ maxLength: 320 }),
  }),
  key: PrivateJwk,
  brokerKeys: BrokerKeys,
  revocations: Type.Array(
    strict({
      deviceId: Uuid,
      kind: Type.Union([Type.Literal("release"), Type.Literal("revoke")]),
      at: Time,
    }),
    { maxItems: REVOCATION_LIMIT },
  ),
  consumed: Type.Array(strict({ jti: RandomId, exp: Time }), { maxItems: CONSUMED_LIMIT }),
};

const StoredLink = strict({
  origin: Origin,
  ...linkFields,
  devices: Type.Array(StoredDevice, { maxItems: DEVICE_LIMIT }),
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

/** The file before links recorded their broker origin and devices their role. */
const connectFileV3 = Compile(
  strict({
    version: Type.Literal(3),
    enabled: Type.Boolean(),
    link: Type.Union([
      strict({
        ...linkFields,
        devices: Type.Array(strict(deviceFields), { maxItems: DEVICE_LIMIT }),
      }),
      Type.Null(),
    ]),
    linkKey: Type.Union([
      strict({
        key: PrivateJwk,
        owner: Type.Union([Type.String({ minLength: 1, maxLength: 128 }), Type.Null()]),
      }),
      Type.Null(),
    ]),
    unlinks: Type.Array(strict({ environmentId: Uuid, key: PrivateJwk, at: Time }), {
      maxItems: UNLINK_LIMIT,
    }),
  }),
);

/**
 * A version 3 file was written by a build with one broker, so its link is
 * read as this build's broker's. Devices enrolled then get the controller
 * role, the one an enrollment without a role gets.
 */
function parseConnectFile(text: string, origin: string | undefined): ConnectFile {
  const value: unknown = JSON.parse(text);

  if (origin === undefined || !connectFileV3.Check(value)) return connectFile.Parse(value);
  const { link, linkKey, unlinks } = value;

  return {
    version: 4,
    enabled: value.enabled,
    link:
      link === null
        ? null
        : {
            ...link,
            origin,
            devices: link.devices.map((device) => ({ ...device, role: "controller" as const })),
          },
    linkKey: linkKey === null ? null : { kind: "session", origin, ...linkKey },
    unlinks: unlinks.map((unlink) => ({ ...unlink, origin })),
  };
}

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

export class ConnectStore {
  private readonly path: string;
  private readonly origin: string | undefined;
  private readonly onFailed: () => void;
  private loaded: ConnectRead | undefined;
  private seen: string | null = null;
  private readonly writes = serial();

  constructor(
    path: string,
    owner: { readonly origin?: string; readonly onFailed?: () => void } = {},
  ) {
    this.path = path;
    this.origin = owner.origin;
    this.onFailed = owner.onFailed ?? (() => undefined);
  }

  async read(): Promise<ConnectRead> {
    const key = await fileKey(this.path);

    if (this.loaded !== undefined && key === this.seen) return this.loaded;
    const read = await this.load();
    this.loaded = read;
    this.seen = key;

    return read;
  }

  snapshot(): ConnectRead | undefined {
    return this.loaded;
  }

  async ready(): Promise<ConnectFile> {
    const read = await this.read();

    if (read.kind === "failed") throw storeFailed();

    return read.file;
  }

  loadedFile(): ConnectFile | undefined {
    return this.loaded?.kind === "ready" ? this.loaded.file : undefined;
  }

  currentLink(environmentId: string): StoredLink | undefined {
    const link = this.loadedFile()?.link ?? null;

    return link !== null && link.environment.id === environmentId && link.origin === this.origin
      ? link
      : undefined;
  }

  async change(change: (file: ConnectFile) => ConnectFile): Promise<void> {
    try {
      await this.update((file) => ({ file: change(file), result: undefined }));
    } catch (cause) {
      if (!(cause instanceof ConnectStoreFailed)) throw cause;
      this.onFailed();
      throw storeFailed();
    }
  }

  update<T>(
    change: (file: ConnectFile) => { readonly file: ConnectFile; readonly result: T },
  ): Promise<T> {
    return this.writes.run(async () => {
      const release = await lockFile(`${this.path}.lock`).catch(() => {
        this.loaded = { kind: "failed" };
        throw new ConnectStoreFailed();
      });

      try {
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
        this.seen = await fileKey(this.path);

        return next.result;
      } finally {
        release();
      }
    });
  }

  async idle(): Promise<void> {
    while (this.writes.busy) await this.writes.settled();
  }

  private async load(): Promise<ConnectRead> {
    return readConnectFile(this.path, this.origin);
  }
}

async function fileKey(path: string): Promise<string | null> {
  const stats = await stat(path).catch(() => null);

  return stats === null
    ? null
    : `${String(stats.ino)}:${String(stats.mtimeMs)}:${String(stats.size)}`;
}

async function readConnectFile(path: string, origin: string | undefined): Promise<ConnectRead> {
  let text: string;

  try {
    const handle = await open(path, "r");

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
    return { kind: "ready", file: parseConnectFile(text, origin) };
  } catch {
    return { kind: "failed" };
  }
}
