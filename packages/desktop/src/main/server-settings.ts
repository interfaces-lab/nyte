/**
 * The one server this desktop reaches: where it is and the bearer it presents.
 * Stored in `~/.nyte` beside the credential stores, mode 0600, since the token
 * is a credential. A damaged file reads as "no server".
 */
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Compile } from "typebox/compile";

const serverType = Type.Object(
  { baseUrl: Type.String({ minLength: 1 }), token: Type.String({ minLength: 1 }) },
  { additionalProperties: false },
);
const serverFile = Compile(serverType);

export type ServerSettings = Static<typeof serverType>;

export class ServerSettingsStore {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async read(): Promise<ServerSettings | undefined> {
    try {
      return serverFile.Parse(JSON.parse(await readFile(this.path, "utf8")));
    } catch {
      return undefined;
    }
  }

  async write(settings: ServerSettings): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    await writeFile(this.path, `${JSON.stringify(settings, null, 2)}\n`, { mode: 0o600 });
  }

  async clear(): Promise<void> {
    await rm(this.path, { force: true });
  }
}
