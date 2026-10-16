import { lineDiff } from "@nyte-ai/core";
import { asId, writePatch } from "@nyte-ai/schema";
import type { FileStatus, LineStat, PatchEntry } from "@nyte-ai/schema";
import { sha256 } from "../hash.ts";
import type { Ran } from "./command.ts";

/** One file's section of `git diff` output: its paths, whether git called it binary, whether it has a hunk, its line counts and its text. */
type DiffSection = {
  readonly oldPath: string | null;
  readonly newPath: string | null;
  readonly binary: boolean;
  readonly hunked: boolean;
  readonly added: number;
  readonly removed: number;
  readonly text: string;
};

export const PATCH_LIMIT = 1024 * 1024;

const ESCAPES = new Map([
  ["a", 7],
  ["b", 8],
  ["f", 12],
  ["n", 10],
  ["r", 13],
  ["t", 9],
  ["v", 11],
  ['"', 34],
  ["\\", 92],
]);

export type Changed = {
  readonly path: string;
  readonly status: FileStatus;
  readonly from?: string;
};

function splitDiff(output: string): readonly DiffSection[] {
  const lines = output.split("\n");

  if (lines.at(-1) === "") lines.pop();
  const sections: DiffSection[] = [];
  let index = 0;

  while (index < lines.length) {
    const header = lines[index] ?? "";

    if (!header.startsWith("diff --git ")) {
      index += 1;
      continue;
    }

    const start = index;
    const named = headerPaths(header.slice("diff --git ".length));
    let oldPath: string | null = named?.old ?? null;
    let newPath: string | null = named?.new ?? null;
    let binary = false;
    let hunked = false;
    let added = 0;
    let removed = 0;
    index += 1;

    while (index < lines.length && !(lines[index] ?? "").startsWith("diff --git ")) {
      const line = lines[index] ?? "";
      index += 1;

      if (line.startsWith("@@ ")) hunked = true;
      else if (hunked && line.startsWith("+")) added += 1;
      else if (hunked && line.startsWith("-")) removed += 1;
      else if (hunked) continue;
      else if (line.startsWith("--- ")) oldPath = sidePath(line.slice(4), "a/");
      else if (line.startsWith("+++ ")) newPath = sidePath(line.slice(4), "b/");
      else if (/^(?:rename|copy) from /u.test(line))
        oldPath = unquote(line.replace(/^(?:rename|copy) from /u, ""));
      else if (/^(?:rename|copy) to /u.test(line))
        newPath = unquote(line.replace(/^(?:rename|copy) to /u, ""));
      else if (line.startsWith("new file mode ")) oldPath = null;
      else if (line.startsWith("deleted file mode ")) newPath = null;
      else if (line.startsWith("Binary files ") || line === "GIT binary patch") binary = true;
    }

    sections.push({
      oldPath,
      newPath,
      binary,
      hunked,
      added,
      removed,
      text: `${lines.slice(start, index).join("\n")}\n`,
    });
  }

  return sections;
}

function sectionEntry(path: string, status: FileStatus, section: DiffSection): PatchEntry {
  const digest = sha256(section.text);

  if (section.binary) return { path, status, digest, kind: "binary" };

  if (section.text.length > PATCH_LIMIT)
    return { path, status, digest, kind: "too-large", limit: PATCH_LIMIT };

  if (!section.hunked) return { path, status, digest, kind: "empty" };

  return {
    path,
    status,
    digest,
    kind: "text",
    added: section.added,
    removed: section.removed,
    patch: section.text,
  };
}

/** The entry for two texts diffed on the host: a text entry's digest is its patch's, so it moves with the whitespace mode; an empty one digests both sides and the mode. */
export function textEntry(
  path: string,
  status: FileStatus,
  before: string | null,
  after: string | null,
  options?: { readonly ignoreWhitespace?: boolean },
): PatchEntry {
  const { hunks, added, removed } = lineDiff(before ?? "", after ?? "", options);

  if (hunks.length === 0) {
    const mode = options?.ignoreWhitespace === true ? "ignore-whitespace" : "";

    return {
      path,
      status,
      digest: sha256(`${mode}\u0000${before ?? ""}\u0000${after ?? ""}`),
      kind: "empty",
    };
  }

  const patch = writePatch(path, status, hunks);

  return { path, status, digest: sha256(patch), kind: "text", added, removed, patch };
}

export async function readPatches(
  files: readonly Changed[],
  read: (files: readonly Changed[], limit: number) => Promise<Ran>,
  emptyDigest: (file: Changed) => string,
): Promise<readonly PatchEntry[]> {
  const settle = (batch: readonly Changed[], ran: Ran): readonly PatchEntry[] => {
    const sections = splitDiff(ran.stdout.toString("utf8"));

    return batch.map((file) => {
      const section = sections.find(
        (candidate) => (candidate.newPath ?? candidate.oldPath) === file.path,
      );

      return section === undefined
        ? { path: file.path, status: file.status, digest: emptyDigest(file), kind: "empty" }
        : sectionEntry(file.path, file.status, section);
    });
  };

  const together = await read(files, PATCH_LIMIT * files.length + 4096).catch(() => null);

  if (together !== null && !together.truncated && (together.code === 0 || together.code === 1))
    return settle(files, together);
  const entries: PatchEntry[] = [];

  for (const file of files) {
    const failed = (reason: string): PatchEntry => ({
      path: file.path,
      status: file.status,
      digest: "",
      kind: "failed",
      reason,
    });

    const alone = await read([file], PATCH_LIMIT + 1).catch((error: unknown) =>
      error instanceof Error ? error.message : String(error),
    );

    if (typeof alone === "string") entries.push(failed(alone));
    else if (alone.truncated)
      entries.push({
        path: file.path,
        status: file.status,
        digest: sha256(alone.stdout),
        kind: "too-large",
        limit: PATCH_LIMIT,
      });
    else if (alone.code !== 0 && alone.code !== 1)
      entries.push(failed(alone.stderr.trim() || "git diff failed"));
    else entries.push(...settle([file], alone));
  }

  return entries;
}

export function lineStat(before: string, after: string): LineStat {
  const { added, removed } = lineDiff(before, after);

  return { kind: "text", added, removed };
}

function headerPaths(rest: string): { readonly old: string; readonly new: string } | null {
  if (rest.startsWith('"')) {
    const end = quotedEnd(rest);
    const old = unquote(rest.slice(0, end + 1));
    const next = unquote(rest.slice(end + 2));

    return { old: old.replace(/^a\//, ""), new: next.replace(/^b\//, "") };
  }

  const half = (rest.length - 5) / 2;

  if (Number.isInteger(half) && rest.startsWith("a/") && rest.slice(half + 2, half + 5) === " b/") {
    const path = rest.slice(2, half + 2);

    if (rest.slice(half + 5) === path) return { old: path, new: path };
  }

  const split = /^.{2}(.*?) b\/(.*)$/su.exec(rest);

  return split === null ? null : { old: split[1] ?? "", new: unquote(split[2] ?? "") };
}

function quotedEnd(text: string): number {
  for (let index = 1; index < text.length; index += 1) {
    if (text[index] === "\\") index += 1;
    else if (text[index] === '"') return index;
  }

  return text.length - 1;
}

function sidePath(text: string, prefix: string): string | null {
  const name = unquote(text.replace(/\t$/, ""));

  if (name === "/dev/null") return null;

  return name.startsWith(prefix) ? name.slice(prefix.length) : name;
}

function unquote(text: string): string {
  if (!text.startsWith('"') || !text.endsWith('"') || text.length < 2) return text;
  const bytes: number[] = [];
  const encoder = new TextEncoder();

  for (let index = 1; index < text.length - 1; index += 1) {
    const char = text[index] ?? "";

    if (char !== "\\") {
      bytes.push(...encoder.encode(char));
      continue;
    }

    const next = text[index + 1] ?? "";
    const octal = /^[0-7]{3}$/.exec(text.slice(index + 1, index + 4));

    if (octal !== null) {
      bytes.push(Number.parseInt(octal[0], 8));
      index += 3;
      continue;
    }

    bytes.push(ESCAPES.get(next) ?? next.charCodeAt(0));
    index += 1;
  }

  return new TextDecoder().decode(new Uint8Array(bytes));
}

export function parseNumstat(output: string): ReadonlyMap<string, LineStat> {
  const tokens = output.split("\u0000");
  const stats = new Map<string, LineStat>();

  for (let index = 0; index < tokens.length; index += 1) {
    const token = tokens[index] ?? "";

    if (token === "") continue;
    const [added = "", removed = "", path = ""] = token.split("\t");
    let name = path;

    if (path === "") {
      name = tokens[index + 2] ?? "";
      index += 2;
    }

    stats.set(
      name,
      added === "-" || removed === "-"
        ? { kind: "binary" }
        : { kind: "text", added: Number(added) || 0, removed: Number(removed) || 0 },
    );
  }

  return stats;
}

export function parseNameStatus(output: string): readonly Changed[] {
  const tokens = output.split("\u0000");
  const changed: Changed[] = [];

  for (let index = 0; index < tokens.length; index += 1) {
    const code = tokens[index] ?? "";

    if (code === "") continue;
    const letter = code[0];

    if (letter === "R" || letter === "C") {
      const from = tokens[index + 1] ?? "";
      const path = tokens[index + 2] ?? "";
      index += 2;
      changed.push(letter === "R" ? { path, status: "renamed", from } : { path, status: "added" });
      continue;
    }

    const path = tokens[index + 1] ?? "";
    index += 1;

    changed.push({
      path,
      status:
        letter === "A"
          ? "added"
          : letter === "D"
            ? "deleted"
            : letter === "U"
              ? "conflicted"
              : "modified",
    });
  }

  return changed;
}
