import type { Dirent } from "node:fs";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { resolve } from "node:path";

// Paths are inserted directly into the composer and rendered in the terminal.
// eslint-disable-next-line no-control-regex
const CONTROL_CHARACTERS = /[\x00-\x1f\x7f]/;

export interface DirectoryQuery {
  readonly start: number;
  readonly end: number;
  readonly path: string;
}

/** A /cd argument is one path, including spaces, rather than a shell word. */
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

/** One parent at a time; metadata checks keep edits visible across query prefixes. */
export class DirectoryListing {
  private generation = 0;
  private cached:
    | {
        readonly directory: string;
        readonly version: string;
        readonly expires: number;
        readonly entries: Promise<Dirent[]>;
      }
    | undefined;

  clear(): void {
    this.generation += 1;
    this.cached = undefined;
  }

  async read(directory: string) {
    const generation = this.generation;
    const info = await stat(directory, { bigint: true });

    if (generation !== this.generation) return readdir(directory, { withFileTypes: true });
    const version = `${info.dev}:${info.ino}:${info.mtimeNs}:${info.ctimeNs}`;
    const cached = this.cached;

    if (
      cached?.directory === directory &&
      cached.version === version &&
      cached.expires > Date.now()
    ) {
      return cached.entries;
    }

    const entries = readdir(directory, { withFileTypes: true });
    // Bound reuse even on filesystems whose directory timestamps are coarse.
    const next = { directory, version, expires: Date.now() + 1000, entries };
    this.cached = next;

    try {
      return await entries;
    } catch (error) {
      if (this.cached === next) this.clear();
      throw error;
    }
  }
}

/** Keep the typed path spelling; only expand ~ for filesystem access. */
export async function directorySuggestions(
  options: {
    readonly path: string;
    readonly cwd: string;
    readonly home?: string;
  },
  listing = new DirectoryListing(),
): Promise<string[]> {
  if (CONTROL_CHARACTERS.test(options.path)) return [];
  const path = options.path === "~" ? "~/" : options.path;
  const split = path.lastIndexOf("/") + 1;
  const parent = path.slice(0, split);
  const prefix = path.slice(split).toLowerCase();

  const directory = resolve(
    options.cwd,
    parent.startsWith("~/") ? `${options.home ?? homedir()}/${parent.slice(2)}` : parent,
  );

  try {
    const entries = await listing.read(directory);

    const matches = await Promise.all(
      entries.map(async (entry) => {
        if (!entry.name.toLowerCase().startsWith(prefix)) return undefined;

        if (entry.name.startsWith(".") && !prefix.startsWith(".")) return undefined;

        if (CONTROL_CHARACTERS.test(entry.name)) return undefined;

        if (!entry.isDirectory()) {
          if (!entry.isSymbolicLink()) return undefined;
          // Broken links and links removed during completion are not candidates.
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
    // Missing or unreadable parents are ordinary while editing a path.
    return [];
  }
}
