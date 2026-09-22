import { realpath } from "node:fs/promises";
import { homedir } from "node:os";
import { basename, join, resolve, sep } from "node:path";
import { pathToFileURL } from "node:url";
import type { MentionFile } from "@nyte-ai/protocol";
import { findRipgrepFiles } from "./ripgrep.ts";

const MAX_MENTION_FILES = 5_000;

/** What one `@` menu shows before it scrolls, and so what a reply carries. */
const MENTION_ROWS = 50;

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
    hidden: !home,
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

/**
 * The subset a `@` query names, best matches first: a leading match on the
 * basename beats one inside it, which beats a match elsewhere in the path.
 * Remote clients cannot walk the workspace, so the host narrows before sending,
 * and one menu's worth is as much as any of them shows.
 */
export function rankMentionFiles(
  files: readonly MentionFile[],
  query: string,
  limit: number = MENTION_ROWS,
): MentionFile[] {
  const needle = query.trim().toLocaleLowerCase();

  if (needle === "") return files.slice(0, limit);
  const ranked: { file: MentionFile; rank: number; index: number }[] = [];

  for (const [index, file] of files.entries()) {
    const label = file.label.toLocaleLowerCase();
    const displayPath = file.displayPath.toLocaleLowerCase();

    const rank = label.startsWith(needle)
      ? 0
      : label.includes(needle)
        ? 1
        : displayPath.includes(needle)
          ? 2
          : undefined;

    if (rank !== undefined) ranked.push({ file, rank, index });
  }

  return ranked
    .sort((left, right) => left.rank - right.rank || left.index - right.index)
    .slice(0, limit)
    .map((entry) => entry.file);
}
