import { link, mkdir, open, readFile, unlink } from "node:fs/promises";
import { dirname } from "node:path";
import { SdkError } from "@nyte-ai/core";
import { codeOf } from "./local/tree.ts";

export async function readKeyFile(path: string, name: string): Promise<Uint8Array> {
  const bytes = await readFile(path)
    .then(
      (stored) => new Uint8Array(stored),
      (error: unknown) => {
        if (codeOf(error) === "ENOENT") return mintKeyFile(path);

        throw error;
      },
    )
    .catch((error: unknown) => {
      throw new SdkError(
        "unavailable",
        `The ${name} at ${path} cannot be read: ${error instanceof Error ? error.message : String(error)}`,
      );
    });

  if (bytes.length !== 32)
    throw new SdkError("invalid", `The ${name} at ${path} is ${bytes.length} bytes, not 32.`);

  return bytes;
}

async function mintKeyFile(path: string): Promise<Uint8Array> {
  await mkdir(dirname(path), { recursive: true, mode: 0o700 });
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const temp = `${path}.${crypto.randomUUID()}`;
  const file = await open(temp, "wx", 0o600);

  try {
    await file.writeFile(bytes);
    await file.sync();
  } finally {
    await file.close();
  }

  try {
    await link(temp, path);

    return bytes;
  } catch (error) {
    if (codeOf(error) !== "EEXIST") throw error;

    return new Uint8Array(await readFile(path));
  } finally {
    await unlink(temp).catch(() => undefined);
  }
}
