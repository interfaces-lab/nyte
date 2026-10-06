import { createHash, randomUUID } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Value } from "typebox/value";
import { CanvasSnapshotSchema, type CanvasSnapshot } from "../src/canvas/wire.ts";
import { CACHE_DIR } from "./host.ts";

const directory = join(CACHE_DIR, "canvases");

export async function storeCanvas(input: Omit<CanvasSnapshot, "id">): Promise<CanvasSnapshot> {
  const id = createHash("sha256").update(JSON.stringify(input)).digest("hex");
  const snapshot = { id, ...input };
  await mkdir(directory, { recursive: true });
  const temporary = join(directory, `${id}.${randomUUID()}.tmp`);
  await writeFile(temporary, JSON.stringify(snapshot));
  await rename(temporary, join(directory, `${id}.json`));

  return snapshot;
}

export async function readCanvas(id: string): Promise<CanvasSnapshot | undefined> {
  if (!/^[a-f0-9]{64}$/.test(id)) return undefined;

  try {
    const data: unknown = JSON.parse(await readFile(join(directory, `${id}.json`), "utf8"));

    return Value.Check(CanvasSnapshotSchema, data) && data.id === id ? data : undefined;
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ENOENT") return undefined;
    throw cause;
  }
}
