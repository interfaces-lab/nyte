/**
 * The one remote host this desktop remembers: where it is, which host
 * answered there, and the token it presents. Stored in `~/.nyte` beside the
 * credential stores, mode 0600, since the token is a credential. A damaged
 * file reads as "no server".
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { asId } from "@nyte-ai/schema";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import type { HostId } from "@nyte-ai/sdk";

const serverFile = Compile(
  Type.Object(
    {
      url: Type.String({ minLength: 1 }),
      hostId: Type.String({ minLength: 1 }),
      token: Type.String({ minLength: 1 }),
    },
    { additionalProperties: false },
  ),
);

/** A remote host this desktop remembers: its address, the host that answered there, and the token it took. */
export interface SavedServer {
  readonly url: string;
  readonly hostId: HostId;
  readonly token: string;
}

export class ServerSettingsStore {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async read(): Promise<SavedServer | undefined> {
    try {
      const saved = serverFile.Parse(JSON.parse(await readFile(this.path, "utf8")));

      return { ...saved, hostId: asId(saved.hostId) };
    } catch {
      return undefined;
    }
  }

  async write(settings: SavedServer): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await writeFile(this.path, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true });
  }
}
