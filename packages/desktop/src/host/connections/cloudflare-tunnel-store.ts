import { open, readFile, rm } from "node:fs/promises";
import { serial } from "@nyte-ai/schema/serial";
import { dirname } from "node:path";
import { writePrivateFile } from "@nyte-ai/connect/private-file";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Compile } from "typebox/compile";

export const DEVICE_LIMIT = 20;

export const DEVICE_NAME_LIMIT = 64;

const deviceType = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 64 }),
    name: Type.String({ minLength: 1, maxLength: DEVICE_NAME_LIMIT }),
    digest: Type.String({ pattern: "^[A-Za-z0-9_-]{43}$" }),
    createdAt: Type.Integer({ minimum: 0 }),
    state: Type.Union([
      Type.Object(
        { kind: Type.Literal("pending"), expiresAt: Type.Integer({ minimum: 0 }) },
        { additionalProperties: false },
      ),
      Type.Object(
        { kind: Type.Literal("paired"), pairedAt: Type.Integer({ minimum: 0 }) },
        { additionalProperties: false },
      ),
    ]),
  },
  { additionalProperties: false },
);

const tunnelType = Type.Object(
  {
    hostname: Type.String({ minLength: 1, maxLength: 253 }),
    port: Type.Integer({ minimum: 1024, maximum: 65_535 }),
    tunnelToken: Type.String({ minLength: 1, maxLength: 4096 }),
    devices: Type.Array(deviceType, { maxItems: DEVICE_LIMIT }),
  },
  { additionalProperties: false },
);

const tunnelFile = Compile(tunnelType);

export type TunnelFile = Static<typeof tunnelType>;

export type StoredDevice = Static<typeof deviceType>;

type TunnelRead =
  | { readonly kind: "ready"; readonly file: TunnelFile | undefined }
  | { readonly kind: "failed" };

export class TunnelStoreFailed extends Error {
  constructor() {
    super("The Cloudflare tunnel settings could not be read or written");
    this.name = "TunnelStoreFailed";
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

export class CloudflareTunnelStore {
  private readonly path: string;
  private current: Promise<TunnelRead> | undefined;
  private readonly writes = serial();

  constructor(path: string) {
    this.path = path;
  }

  read(): Promise<TunnelRead> {
    this.current ??= this.load();

    return this.current;
  }

  update<T>(
    change: (file: TunnelFile | undefined) => {
      readonly file: TunnelFile | undefined;
      readonly result: T;
    },
  ): Promise<T> {
    return this.writes.run(async () => {
      const loaded = await this.read();

      if (loaded.kind === "failed") throw new TunnelStoreFailed();
      const next = change(loaded.file);

      if (next.file === loaded.file) return next.result;

      try {
        await this.persist(next.file);
      } catch {
        this.current = Promise.resolve({ kind: "failed" });
        throw new TunnelStoreFailed();
      }

      this.current = Promise.resolve({ kind: "ready", file: next.file });

      return next.result;
    });
  }

  private async load(): Promise<TunnelRead> {
    let text: string;

    try {
      text = await readFile(this.path, "utf8");
    } catch (cause) {
      return cause instanceof Error && "code" in cause && cause.code === "ENOENT"
        ? { kind: "ready", file: undefined }
        : { kind: "failed" };
    }

    try {
      return { kind: "ready", file: tunnelFile.Parse(JSON.parse(text)) };
    } catch {
      return { kind: "failed" };
    }
  }

  private async persist(file: TunnelFile | undefined): Promise<void> {
    if (file === undefined) {
      await rm(this.path, { force: true });
      await syncDirectory(dirname(this.path));

      return;
    }

    await writePrivateFile({ path: this.path, text: `${JSON.stringify(file, null, 2)}\n` });
  }
}
