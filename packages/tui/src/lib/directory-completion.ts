import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

// eslint-disable-next-line no-control-regex -- rejecting control characters is the point
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/;

interface DirectoryQuery {
  readonly start: number;
  readonly end: number;
  readonly path: string;
}

export function directoryCompletionQuery(
  value: string,
  cursor = value.length,
): DirectoryQuery | undefined {
  const command = /^[ \t]*\/cd[ \t]+/i.exec(value);

  if (command === null || /[\r\n\0]/.test(value)) return undefined;
  const start = command[0].length;

  if (cursor < start || cursor > value.length) return undefined;

  return { start, end: value.length, path: value.slice(start, cursor) };
}

export async function directorySuggestions(options: {
  readonly path: string;
  readonly cwd: string;
  readonly home?: string;
}): Promise<string[]> {
  if (CONTROL_CHARACTERS.test(options.path)) return [];
  const path = /^(?:~|(?:\.\.\/)*\.\.)$/.test(options.path) ? `${options.path}/` : options.path;
  const split = path.lastIndexOf("/") + 1;
  const parent = path.slice(0, split);
  const prefix = path.slice(split).toLowerCase();

  const directory = resolve(
    options.cwd,
    parent.startsWith("~/") ? `${options.home ?? homedir()}/${parent.slice(2)}` : parent,
  );

  try {
    const entries = await readdir(directory, { withFileTypes: true });

    const matches = await Promise.all(
      entries.map(async (entry) => {
        if (!entry.name.toLowerCase().startsWith(prefix)) return undefined;

        if (entry.name.startsWith(".") && !prefix.startsWith(".")) return undefined;

        if (CONTROL_CHARACTERS.test(entry.name)) return undefined;

        if (!entry.isDirectory()) {
          if (!entry.isSymbolicLink()) return undefined;
          const target = await stat(resolve(directory, entry.name)).catch(() => undefined);

          if (!target?.isDirectory()) return undefined;
        }

        return `${parent}${entry.name}/`;
      }),
    );

    return matches
      .filter((match) => match !== undefined)
      .toSorted((left, right) => left.localeCompare(right));
  } catch {
    return [];
  }
}
