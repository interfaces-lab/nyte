/**
 * The one writer for settings.json. A change is applied to the file as it is on
 * disk now, then the file is replaced atomically. Nothing here knows which keys
 * mean what; `schema.ts` does.
 */
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";
import { mkdir, readFile, rename, unlink, writeFile } from "node:fs/promises";
import { basename, dirname, join } from "node:path";
import { isFileError, nyteHome } from "../paths.ts";
import { settingsFileObject, type SettingsFileObject } from "./schema.ts";

export function settingsPath(): string {
  return join(nyteHome(), "settings.json");
}

/** Thrown instead of writing over a file that exists but isn't a JSON object, perhaps mid-edit. */
export class UnreadableSettingsFile extends Error {
  readonly path: string;

  constructor(path: string) {
    super(`${path} isn't valid JSON. Fix it or delete it, then try again.`);
    this.name = "UnreadableSettingsFile";
    this.path = path;
  }
}

function parseObject(text: string | undefined, path: string): SettingsFileObject {
  if (text === undefined) return {};

  try {
    return settingsFileObject(JSON.parse(text));
  } catch {
    throw new UnreadableSettingsFile(path);
  }
}

/** One synchronous read for hosts that read settings once, when they open. A bad file reads as empty. */
export function readSettingsFileSync(path: string = settingsPath()): SettingsFileObject {
  try {
    return parseObject(readFileSync(path, "utf8"), path);
  } catch {
    return {};
  }
}

export async function readSettingsFile(path: string = settingsPath()): Promise<SettingsFileObject> {
  const text = await readFile(path, "utf8").catch((cause: unknown) => {
    if (isFileError(cause, ["ENOENT"])) return undefined;
    throw cause;
  });

  return parseObject(text, path);
}

const tails = new Map<string, Promise<unknown>>();

/**
 * Applies `change` to the file's current object and replaces the file (temp
 * file, rename, mode 0600). Writes to one path from this process run one at a
 * time; across processes the last writer wins.
 */
export function updateSettingsFile(
  path: string,
  change: (file: SettingsFileObject) => SettingsFileObject,
): Promise<SettingsFileObject> {
  const previous = tails.get(path) ?? Promise.resolve();

  const next = previous.then(async () => {
    const file = change(await readSettingsFile(path));
    const directory = dirname(path);

    await mkdir(directory, { recursive: true, mode: 0o700 });
    const temporary = join(directory, `.${basename(path)}.${randomUUID()}.tmp`);
    let committed = false;

    try {
      await writeFile(temporary, `${JSON.stringify(file, null, 2)}\n`, {
        flag: "wx",
        mode: 0o600,
      });
      await rename(temporary, path);
      committed = true;
    } finally {
      if (!committed) await unlink(temporary).catch(() => undefined);
    }

    return file;
  });

  // The tail never rejects, so a failed write doesn't block the next one.
  tails.set(
    path,
    next.catch(() => undefined),
  );

  return next;
}
