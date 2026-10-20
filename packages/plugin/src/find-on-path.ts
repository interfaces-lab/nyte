import { constants } from "node:fs";
import { access } from "node:fs/promises";
import { delimiter, join } from "node:path";

/** Whether `path` is a file this process may run. */
export async function executable(path: string): Promise<boolean> {
  try {
    await access(path, constants.X_OK);

    return true;
  } catch {
    return false;
  }
}

/** The first executable `name` in the directories of `path`, a `PATH`-style list. */
export async function findOnPath(name: string, path: string): Promise<string | undefined> {
  const names = process.platform === "win32" ? [`${name}.exe`, `${name}.cmd`, name] : [name];

  for (const dir of path.split(delimiter))
    for (const candidate of names)
      if (dir !== "" && (await executable(join(dir, candidate)))) return join(dir, candidate);

  return undefined;
}
