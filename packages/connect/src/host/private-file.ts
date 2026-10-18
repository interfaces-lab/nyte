import { randomBytes } from "node:crypto";
import { mkdir, open, rename, rm } from "node:fs/promises";
import { dirname } from "node:path";

/** Write `text` to `path`, 0600, through an fsynced temporary file renamed into place. */
export async function writePrivateFile(input: {
  readonly path: string;
  readonly text: string;
}): Promise<void> {
  const directory = dirname(input.path);
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const temporary = `${input.path}.${randomBytes(8).toString("hex")}.tmp`;

  try {
    const handle = await open(temporary, "wx", 0o600);

    try {
      await handle.writeFile(input.text);
      await handle.sync();
    } finally {
      await handle.close();
    }

    await rename(temporary, input.path);
  } catch (cause) {
    await rm(temporary, { force: true }).catch(() => undefined);
    throw cause;
  }

  await syncDirectory(directory);
}

async function syncDirectory(path: string): Promise<void> {
  if (process.platform === "win32") return;
  const handle = await open(path, "r");

  try {
    await handle.sync();
  } finally {
    await handle.close();
  }
}
