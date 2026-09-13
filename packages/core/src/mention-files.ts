import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import { findRipgrepFiles } from "./ripgrep.ts";

const MAX_MENTION_FILES = 5_000;

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

/**
 * Files offered by `@` and their parent folders. Ripgrep applies ignore files
 * and omits symlinks and .git; empty folders are not listed.
 */
export async function discoverMentionFiles(
  cwd: string,
  signal?: AbortSignal,
): Promise<MentionFile[]> {
  signal?.throwIfAborted();
  const root = resolve(cwd);
  const directory = await realpath(root);
  const home = directory === (await realpath(homedir()));
  const homeExcludes = !home
    ? []
    : process.platform === "darwin"
      ? [
          "Music",
          "Pictures",
          "Movies",
          "Downloads",
          "Desktop",
          "Documents",
          "Public",
          "Applications",
          "Library",
        ]
      : process.platform === "win32"
        ? [
            "AppData",
            "Downloads",
            "Desktop",
            "Documents",
            "Pictures",
            "Music",
            "Videos",
            "OneDrive",
          ]
        : [];
  const found = await findRipgrepFiles({
    cwd: directory,
    limit: 100_000,
    signal,
    ...(home ? { hidden: false } : {}),
    exclude: homeExcludes.map((name) => `${name}/**`),
  });
  const paths = new Set(found.files);
  for (const path of found.files) {
    const parts = path.split("/");
    for (let end = 1; end < parts.length; end++) paths.add(`${parts.slice(0, end).join("/")}/`);
  }
  return [...paths]
    .sort((a, b) => a.localeCompare(b))
    .slice(0, MAX_MENTION_FILES)
    .map((displayPath) => {
      const directory = displayPath.endsWith("/");
      const path = join(root, directory ? displayPath.slice(0, -1) : displayPath);
      return {
        path: path + (directory ? sep : ""),
        url: pathToFileURL(path).href,
        displayPath,
        label: basename(path) + (directory ? "/" : ""),
      };
    });
}
