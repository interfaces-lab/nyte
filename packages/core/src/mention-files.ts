/**
 * The workspace entries a composer offers behind `@`. Hosts walk the tree;
 * clients only filter and display, so the walk lives here where the TUI and
 * the desktop main process both reach it.
 */
import { readdir } from "node:fs/promises";
import { basename, join, relative, sep } from "node:path";
import { pathToFileURL } from "node:url";

const MAX_MENTION_FILES = 5_000;

const SKIPPED_DIRECTORIES = new Set([
  ".git",
  ".next",
  ".turbo",
  ".nyte",
  "build",
  "coverage",
  "dist",
  "node_modules",
]);

export interface MentionFile {
  /** Absolute path. Directories carry a trailing separator. */
  readonly path: string;
  /** The `file:` URL a message spells the mention as (`@file:///…`). */
  readonly url: string;
  /** Path relative to the workspace root, forward slashes, `/` suffix for directories. */
  readonly displayPath: string;
  /** Basename, `/` suffix for directories. */
  readonly label: string;
}

/** Files and folders offered by `@` completion. Common generated trees are skipped. */
export async function discoverMentionFiles(cwd: string): Promise<MentionFile[]> {
  const files: MentionFile[] = [];
  const pending = [cwd];
  while (pending.length > 0 && files.length < MAX_MENTION_FILES) {
    const directory = pending.pop();
    if (directory === undefined) break;
    const entries = await readdir(directory, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      if (files.length >= MAX_MENTION_FILES) break;
      const path = join(directory, entry.name);
      const displayPath = relative(cwd, path).split("\\").join("/");
      if (entry.isDirectory()) {
        if (SKIPPED_DIRECTORIES.has(entry.name)) continue;
        pending.push(path);
        files.push({
          path: path + sep,
          url: pathToFileURL(path).href,
          displayPath: `${displayPath}/`,
          label: `${entry.name}/`,
        });
        continue;
      }
      if (!entry.isFile()) continue;
      files.push({ path, url: pathToFileURL(path).href, displayPath, label: basename(path) });
    }
  }
  return files.toSorted((left, right) => left.displayPath.localeCompare(right.displayPath));
}
