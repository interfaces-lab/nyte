import { readFileSync } from "node:fs";
import { mkdir, rename, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import process from "node:process";
import { ModelRefType, ThinkingType } from "@nyte-ai/schema";
import { serial } from "@nyte-ai/schema/serial";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { FirstFramePort } from "../effects/ports.ts";

/** The selection the last launch's blank chat resolved to, so the next launch draws its chip before the host answers. */
const FirstFrameType = Type.Object(
  { model: ModelRefType, effort: ThinkingType, fast: Type.Boolean() },
  { additionalProperties: false },
);

/**
 * Keeps the first frame's selection in `path`; a missing or unreadable file reads as none. Writes
 * run one at a time, in the order they came, so the newest choice is the one left on disk.
 */
export function firstFramePort(path: string): FirstFramePort {
  const writes = serial();

  return {
    read() {
      try {
        const value: unknown = JSON.parse(readFileSync(path, "utf8"));

        return Value.Check(FirstFrameType, value) ? value : null;
      } catch {
        return null;
      }
    },
    write: (selection) =>
      writes.run(async () => {
        const temporary = `${path}.${String(process.pid)}.tmp`;
        await mkdir(dirname(path), { recursive: true, mode: 0o700 });
        await writeFile(temporary, `${JSON.stringify(selection)}\n`, { mode: 0o600 });
        await rename(temporary, path);
      }),
  };
}
