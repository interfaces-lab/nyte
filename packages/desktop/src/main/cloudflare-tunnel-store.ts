/**
 * The Cloudflare plugin's settings: the tunnel the user created and the
 * devices paired over it, in `~/.nyte/cloudflare-tunnel.json`, mode 0600
 * beside the other credential stores. Device tokens are kept only as SHA-256
 * digests.
 *
 * Every change lands on disk before it is visible, through a temporary file
 * renamed into place. A file that cannot be read, does not parse, or cannot be
 * written makes the store `failed` for the life of the process: nothing is
 * accepted and nothing is overwritten until the user fixes it and restarts.
 */
import { randomBytes } from "node:crypto";
import { mkdir, open, readFile, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Compile } from "typebox/compile";

/** Paired and pending devices together. */
export const DEVICE_LIMIT = 20;

export const DEVICE_NAME_LIMIT = 64;

const deviceType = Type.Object(
  {
    id: Type.String({ minLength: 1, maxLength: 64 }),
    name: Type.String({ minLength: 1, maxLength: DEVICE_NAME_LIMIT }),
    /** base64url SHA-256 of the device token. */
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

export type TunnelRead =
  | { readonly kind: "ready"; readonly file: TunnelFile | undefined }
  | { readonly kind: "failed" };

/** Thrown by `update` once the store has failed; the plugin answers it with a fixed message. */
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

function isMissing(cause: unknown): boolean {
  return cause instanceof Error && "code" in cause && cause.code === "ENOENT";
}

export class CloudflareTunnelStore {
  private readonly path: string;
  private current: Promise<TunnelRead> | undefined;
  private writes: Promise<unknown> = Promise.resolve();

  constructor(path: string) {
    this.path = path;
  }

  read(): Promise<TunnelRead> {
    this.current ??= this.load();

    return this.current;
  }

  /**
   * Apply `change` to the settings as they stand after every earlier change,
   * then persist. `undefined` removes the file. Changes run one at a time, so a
   * later change always sees an earlier one's result.
   */
  update<T>(
    change: (file: TunnelFile | undefined) => {
      readonly file: TunnelFile | undefined;
      readonly result: T;
    },
  ): Promise<T> {
    const run = this.writes.then(async () => {
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

    this.writes = run.catch(() => undefined);

    return run;
  }

  private async load(): Promise<TunnelRead> {
    let text: string;

    try {
      text = await readFile(this.path, "utf8");
    } catch (cause) {
      return isMissing(cause) ? { kind: "ready", file: undefined } : { kind: "failed" };
    }

    try {
      return { kind: "ready", file: tunnelFile.Parse(JSON.parse(text)) };
    } catch {
      return { kind: "failed" };
    }
  }

  /**
   * The file's bytes reach the disk before the rename, and the rename before
   * this resolves, so a crash leaves the old settings or the new ones, never a
   * paired device silently gone.
   */
  private async persist(file: TunnelFile | undefined): Promise<void> {
    const directory = dirname(this.path);

    if (file === undefined) {
      await rm(this.path, { force: true });
      await syncDirectory(directory);

      return;
    }

    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${randomBytes(8).toString("hex")}.tmp`;

    try {
      // `wx` creates the file, so the mode applies; rename keeps it.
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
