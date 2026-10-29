import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import { Type } from "typebox";
import { Compile } from "typebox/compile";
import type { UpdateChannel } from "@nyte-ai/app/bridge.ts";

const updateSettings = Compile(
  Type.Object({ channel: Type.Enum(["stable", "nightly"]) }, { additionalProperties: false }),
);

export class UpdateSettingsStore {
  private readonly path: string;

  constructor(path: string) {
    this.path = path;
  }

  async read(): Promise<UpdateChannel | undefined> {
    try {
      return updateSettings.Parse(JSON.parse(await readFile(this.path, "utf8"))).channel;
    } catch {
      return undefined;
    }
  }

  async write(channel: UpdateChannel): Promise<void> {
    await mkdir(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.tmp`;
    await writeFile(temporary, `${JSON.stringify({ channel })}\n`, { mode: 0o600 });
    await rename(temporary, this.path);
  }
}
