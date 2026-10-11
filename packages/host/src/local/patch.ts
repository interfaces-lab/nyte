import { asId } from "@nyte-ai/schema";
import type {
  FileStatus,
  GitRevision,
  Hunk,
  LineStat,
  PatchEntry,
  SnapshotId,
} from "@nyte-ai/schema";
import { sha256 } from "../hash.ts";
import type { Ran } from "./command.ts";

/** Returns one file's section of `git diff` output: its old and new paths (null for `/dev/null`), whether git called it binary, its hunks with their added and removed line counts, and its raw text. */
export type ParsedDiff = {
  readonly oldPath: string | null;
  readonly newPath: string | null;
  readonly binary: boolean;
  readonly hunks: readonly Hunk[];
  readonly added: number;
  readonly removed: number;
  readonly text: string;
};

/** The size past which a path's patch or one side of a file is not read: 1 MiB. */
export const PATCH_LIMIT = 1024 * 1024;

/** The context lines around each change in a hunk. */
const CONTEXT = 3;

/** The most edits the line diff searches before answering the whole middle as replaced. */
const MAX_EDITS = 4_000;

/** Returns one changed path of a comparison as `git diff --name-status` reports it: its status and, for a rename, the path it came from. */
export type Changed = {
  readonly path: string;
  readonly status: FileStatus;
  readonly from?: string;
};

type Line = Hunk["lines"][number];

const HUNK_HEADER = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@ ?(.*)$/;

/** Parses `git diff` output, written with the default `a/` and `b/` prefixes and no colour, into its file sections in order. */
export function parseDiff(output: string): readonly ParsedDiff[] {
  const lines = output.split("\n");

  if (lines.at(-1) === "") lines.pop();
  const sections: ParsedDiff[] = [];
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
    const hunks: Hunk[] = [];
    let added = 0;
    let removed = 0;
    index += 1;

    while (index < lines.length && !(lines[index] ?? "").startsWith("diff --git ")) {
      const line = lines[index] ?? "";
      const hunk = HUNK_HEADER.exec(line);

      if (hunk !== null) {
        const parsed = readHunk(lines, index, hunk);
        hunks.push(parsed.hunk);
        added += parsed.hunk.lines.filter((entry) => entry.kind === "add").length;
        removed += parsed.hunk.lines.filter((entry) => entry.kind === "remove").length;
        index = parsed.next;
        continue;
      }

      if (line.startsWith("--- ")) oldPath = sidePath(line.slice(4), "a/");
      else if (line.startsWith("+++ ")) newPath = sidePath(line.slice(4), "b/");
      else if (line.startsWith("rename from ") || line.startsWith("copy from "))
        oldPath = unquote(line.slice(line.indexOf(" from ") + 6));
      else if (line.startsWith("rename to ") || line.startsWith("copy to "))
        newPath = unquote(line.slice(line.indexOf(" to ") + 4));
      else if (line.startsWith("new file mode ")) oldPath = null;
      else if (line.startsWith("deleted file mode ")) newPath = null;
      else if (line.startsWith("Binary files ") || line === "GIT binary patch") binary = true;
      index += 1;
    }

    sections.push({
      oldPath,
      newPath,
      binary,
      hunks,
      added,
      removed,
      text: `${lines.slice(start, index).join("\n")}\n`,
    });
  }

  return sections;
}

/** Returns one path's `PatchEntry` from its parsed section: `binary`, `too-large` past `PATCH_LIMIT`, `empty` without hunks, else `text`; `digest` the SHA-256 of the section. */
export function entryOf(path: string, status: FileStatus, parsed: ParsedDiff): PatchEntry {
  const digest = sha256(parsed.text);

  if (parsed.binary) return { path, status, digest, kind: "binary" };

  if (parsed.text.length > PATCH_LIMIT)
    return { path, status, digest, kind: "too-large", limit: PATCH_LIMIT };

  if (parsed.hunks.length === 0) return { path, status, digest, kind: "empty" };

  return {
    path,
    status,
    digest,
    kind: "text",
    added: parsed.added,
    removed: parsed.removed,
    hunks: parsed.hunks,
  };
}

/** Returns one path's `PatchEntry` between two texts (null for an absent side) with the line diff: hunks with three lines of context, `empty` when the texts are equal, and `digest` the SHA-256 of both sides. */
export function textEntry(
  path: string,
  status: FileStatus,
  before: string | null,
  after: string | null,
  options?: { readonly ignoreWhitespace?: boolean },
): PatchEntry {
  const digest = sha256(`${before ?? ""}\u0000${after ?? ""}`);
  const diffed = lineDiff(before ?? "", after ?? "", options);

  if (diffed.hunks.length === 0) return { path, status, digest, kind: "empty" };

  return { path, status, digest, kind: "text", ...diffed };
}

/** Reads the patches of `files` with one `git diff` through `read` (its stdout capped at `PATCH_LIMIT` a path), one entry per file in order; when that read throws, exits with an error or passes its cap, each path is read again alone, so a path past `PATCH_LIMIT` is `too-large`, one whose read throws or fails is `failed { reason }`, and the others are fine. A path the diff shows no section for is `empty`, its digest `emptyDigest(file)`. What `localGit.patches` and `localSnapshots.patches` read with. */
export async function readPatches(
  files: readonly Changed[],
  read: (files: readonly Changed[], limit: number) => Promise<Ran>,
  emptyDigest: (file: Changed) => string,
): Promise<readonly PatchEntry[]> {
  const settle = (batch: readonly Changed[], ran: Ran): readonly PatchEntry[] => {
    const sections = parseDiff(ran.stdout.toString("utf8"));

    return batch.map((file) => {
      const section = sections.find(
        (candidate) => (candidate.newPath ?? candidate.oldPath) === file.path,
      );

      return section === undefined
        ? { path: file.path, status: file.status, digest: emptyDigest(file), kind: "empty" }
        : entryOf(file.path, file.status, section);
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

/** Returns the line stat between two texts, as `textEntry` counts it. */
export function lineStat(before: string, after: string): LineStat {
  const { added, removed } = lineDiff(before, after);

  return { kind: "text", added, removed };
}

/** Returns a git revision or a snapshot id as the revision a `ChangeSet` or `PatchSet` carries. */
export function revisionOf(value: string): GitRevision {
  return asId<"git-revision">(value);
}

/** Returns a snapshot id. */
export function snapshotOf(value: string): SnapshotId {
  return asId<"snapshot">(value);
}

/** Diffs two texts by line (Myers, after trimming the common head and tail) into unified hunks with three lines of context; a line missing its final newline carries `noNewline`. Under `ignoreWhitespace` lines compare with their whitespace removed. */
export function lineDiff(
  before: string,
  after: string,
  options?: { readonly ignoreWhitespace?: boolean },
): { readonly hunks: readonly Hunk[]; readonly added: number; readonly removed: number } {
  const old = splitLines(before);
  const next = splitLines(after);

  const key = (line: { readonly text: string; readonly last: boolean }): string =>
    `${options?.ignoreWhitespace === true ? line.text.replace(/\s+/g, "") : line.text}${line.last ? "\u0000" : ""}`;

  const ops = edits(old.map(key), next.map(key));
  const script: { readonly kind: Line["kind"]; readonly old: number; readonly new: number }[] = [];
  let oldIndex = 0;
  let newIndex = 0;

  for (const op of ops) {
    script.push({ kind: op, old: oldIndex, new: newIndex });

    if (op !== "add") oldIndex += 1;

    if (op !== "remove") newIndex += 1;
  }

  const hunks: Hunk[] = [];
  let added = 0;
  let removed = 0;
  let index = 0;

  while (index < script.length) {
    if (script[index]?.kind === "context") {
      index += 1;
      continue;
    }

    const start = Math.max(0, index - CONTEXT);
    let end = index;
    let scan = index;

    while (scan < script.length) {
      if (script[scan]?.kind !== "context") {
        end = scan;
        scan += 1;
        continue;
      }

      let after = scan;

      while (after < script.length && script[after]?.kind === "context") after += 1;

      if (after < script.length && after - scan <= CONTEXT * 2) {
        scan = after;
        continue;
      }

      break;
    }

    const stop = Math.min(script.length, end + 1 + CONTEXT);
    const slice = script.slice(start, stop);
    const first = slice[0];

    if (first === undefined) break;

    const lines: Line[] = slice.map((step) => {
      const line = step.kind === "add" ? next[step.new] : old[step.old];
      const text = line?.text ?? "";

      if (step.kind === "add") added += 1;

      if (step.kind === "remove") removed += 1;

      return line?.last === true
        ? { kind: step.kind, text, noNewline: true }
        : { kind: step.kind, text };
    });

    const oldLines = slice.filter((step) => step.kind !== "add").length;
    const newLines = slice.filter((step) => step.kind !== "remove").length;

    hunks.push({
      oldStart: oldLines === 0 ? first.old : first.old + 1,
      oldLines,
      newStart: newLines === 0 ? first.new : first.new + 1,
      newLines,
      header: null,
      lines,
    });
    index = stop;
  }

  return { hunks, added, removed };
}

/** Returns the edit script between two key lists: `context` for a kept line, `remove`, `add`. */
function edits(old: readonly string[], next: readonly string[]): readonly Line["kind"][] {
  let head = 0;

  while (head < old.length && head < next.length && old[head] === next[head]) head += 1;
  let tail = 0;

  while (
    tail < old.length - head &&
    tail < next.length - head &&
    old[old.length - 1 - tail] === next[next.length - 1 - tail]
  )
    tail += 1;

  const a = old.slice(head, old.length - tail);
  const b = next.slice(head, next.length - tail);

  const middle = myers(a, b) ?? [
    ...a.map((): Line["kind"] => "remove"),
    ...b.map((): Line["kind"] => "add"),
  ];

  return [
    ...Array.from({ length: head }, (): Line["kind"] => "context"),
    ...middle,
    ...Array.from({ length: tail }, (): Line["kind"] => "context"),
  ];
}

/** Returns Myers' shortest edit script between two lists, or null past `MAX_EDITS` edits. */
function myers(a: readonly string[], b: readonly string[]): Line["kind"][] | null {
  const n = a.length;
  const m = b.length;
  const max = Math.min(n + m, MAX_EDITS);
  const offset = max + 1;
  const v = new Int32Array(2 * max + 3);
  const trace: Int32Array[] = [];
  v[offset + 1] = 0;

  for (let d = 0; d <= max; d += 1) {
    for (let k = -d; k <= d; k += 2) {
      let x =
        k === -d || (k !== d && v[offset + k - 1] < v[offset + k + 1])
          ? v[offset + k + 1]
          : v[offset + k - 1] + 1;

      let y = x - k;

      while (x < n && y < m && a[x] === b[y]) {
        x += 1;
        y += 1;
      }

      v[offset + k] = x;

      if (x >= n && y >= m) {
        trace.push(v.slice(offset - d, offset + d + 1));

        return backtrack(trace, n, m);
      }
    }

    trace.push(v.slice(offset - d, offset + d + 1));
  }

  return null;
}

function backtrack(trace: readonly Int32Array[], n: number, m: number): Line["kind"][] {
  const script: Line["kind"][] = [];
  let x = n;
  let y = m;

  for (let d = trace.length - 1; d > 0; d -= 1) {
    const previous = trace[d - 1];

    if (previous === undefined) break;
    const at = (k: number): number => previous[k + d - 1];
    const k = x - y;
    const down = k === -d || (k !== d && at(k - 1) < at(k + 1));
    const previousK = down ? k + 1 : k - 1;
    const previousX = at(previousK);
    const previousY = previousX - previousK;

    while (x > previousX && y > previousY) {
      script.push("context");
      x -= 1;
      y -= 1;
    }

    script.push(down ? "add" : "remove");
    x = previousX;
    y = previousY;
  }

  while (x > 0 && y > 0) {
    script.push("context");
    x -= 1;
    y -= 1;
  }

  return script.reverse();
}

/** Splits a text into lines without their newlines, marking the last; an empty text has none. */
function splitLines(text: string): readonly { readonly text: string; readonly last: boolean }[] {
  if (text === "") return [];
  const parts = text.split("\n");

  if (parts.at(-1) === "") parts.pop();

  return parts.map((part, index) => ({
    text: part,
    last: index === parts.length - 1 && !text.endsWith("\n"),
  }));
}

function readHunk(
  lines: readonly string[],
  at: number,
  header: RegExpExecArray,
): { readonly hunk: Hunk; readonly next: number } {
  const oldStart = Number(header[1]);
  const oldLines = header[2] === undefined ? 1 : Number(header[2]);
  const newStart = Number(header[3]);
  const newLines = header[4] === undefined ? 1 : Number(header[4]);
  const body: Line[] = [];
  let oldSeen = 0;
  let newSeen = 0;
  let index = at + 1;

  while (index < lines.length) {
    const line = lines[index] ?? "";

    if (line.startsWith("\\")) {
      const last = body.pop();

      if (last !== undefined) body.push({ ...last, noNewline: true });
      index += 1;
      continue;
    }

    if (oldSeen >= oldLines && newSeen >= newLines) break;
    const mark = line[0];

    if (mark === "+") {
      body.push({ kind: "add", text: line.slice(1) });
      newSeen += 1;
    } else if (mark === "-") {
      body.push({ kind: "remove", text: line.slice(1) });
      oldSeen += 1;
    } else if (mark === " " || line === "") {
      body.push({ kind: "context", text: line.slice(1) });
      oldSeen += 1;
      newSeen += 1;
    } else break;
    index += 1;
  }

  const text = header[5] ?? "";

  return {
    hunk: {
      oldStart,
      oldLines,
      newStart,
      newLines,
      header: text === "" ? null : text,
      lines: body,
    },
    next: index,
  };
}

/** Returns the old and new paths of a `diff --git a/<old> b/<new>` header, or null when they cannot be told apart (a rename's lines name them instead). */
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

  const split = rest.indexOf(" b/");

  return split < 0 ? null : { old: rest.slice(2, split), new: unquote(rest.slice(split + 3)) };
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

/** Undoes git's C-style quoting of a path (`"a\tb"`, octal escapes for bytes); an unquoted path comes back as is. */
export function unquote(text: string): string {
  if (!text.startsWith('"') || !text.endsWith('"') || text.length < 2) return text;
  const bytes: number[] = [];
  const encoder = new TextEncoder();

  const escapes: Readonly<Record<string, number>> = {
    a: 7,
    b: 8,
    f: 12,
    n: 10,
    r: 13,
    t: 9,
    v: 11,
    '"': 34,
    "\\": 92,
  };

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

    bytes.push(escapes[next] ?? next.charCodeAt(0));
    index += 1;
  }

  return new TextDecoder().decode(new Uint8Array(bytes));
}

/** Parses `git diff --numstat -z` into line stats by path (a rename under its new path). */
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

/** Parses `git diff --name-status -z` into changed paths. */
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
