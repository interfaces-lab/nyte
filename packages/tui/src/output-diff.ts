import { formatPatch, OMIT_HEADERS, parsePatch } from "diff";
import type { StructuredPatch } from "diff";

/** A hunk that replaces exactly one line with one line; `row` is the removed line's row within the hunk. */
export interface ChangedLinePair {
  readonly removed: string;
  readonly added: string;
  readonly row: number;
}

interface DiffSection {
  readonly patch: string;
  readonly omittedBefore: number;
  readonly rows: number;
  readonly pair: ChangedLinePair | undefined;
}

export interface OutputDiffFile {
  readonly sections: readonly DiffSection[];
  readonly path: string | undefined;
}

export interface OutputDiff {
  readonly files: readonly OutputDiffFile[];
  readonly before: string | undefined;
  readonly after: string | undefined;
}

function fileHeader(lines: readonly string[], index: number): boolean {
  return (
    (lines[index] ?? "").startsWith("diff --git ") ||
    ((lines[index] ?? "").startsWith("--- ") && (lines[index + 1] ?? "").startsWith("+++ "))
  );
}

/** Consume exactly the declared body, never the following command's output. */
function hunkEnd(lines: readonly string[], start: number): number {
  const header = /^@@ -\d+(?:,(\d+))? \+\d+(?:,(\d+))? @@/u.exec(lines[start] ?? "");
  if (header === null) return start;
  let oldRemaining = Number(header[1] ?? "1");
  let newRemaining = Number(header[2] ?? "1");
  let end = start + 1;
  while (oldRemaining > 0 || newRemaining > 0) {
    const line = lines[end];
    if (line === undefined) return start;
    if (line === "\\ No newline at end of file") {
      end++;
      continue;
    }
    if (line.startsWith("-")) oldRemaining--;
    else if (line.startsWith("+")) newRemaining--;
    else if (line.startsWith(" ") || (line === "" && end < lines.length - 1)) {
      oldRemaining--;
      newRemaining--;
    } else return start;
    if (oldRemaining < 0 || newRemaining < 0) return start;
    end++;
  }
  if (lines[end] === "\\ No newline at end of file") end++;
  return end;
}

function diffPath(patch: StructuredPatch): string | undefined {
  const named =
    patch.newFileName !== undefined && patch.newFileName !== "/dev/null"
      ? patch.newFileName
      : patch.oldFileName;
  if (named === undefined || named === "/dev/null") return undefined;
  return patch.isGit === true && /^[ab]\//u.test(named) ? named.slice(2) : named;
}

function changedLinePair(lines: readonly string[]): ChangedLinePair | undefined {
  const rows = lines.filter((line) => !line.startsWith("\\"));
  const removed = rows.flatMap((line, row) => (line.startsWith("-") ? [row] : []));
  const added = rows.flatMap((line, row) => (line.startsWith("+") ? [row] : []));
  const row = removed[0];
  if (row === undefined || removed.length !== 1 || added.length !== 1 || added[0] !== row + 1)
    return undefined;
  return {
    removed: (rows[row] ?? "").slice(1),
    added: (rows[row + 1] ?? "").slice(1),
    row,
  };
}

function trimSection(lines: readonly string[]): string | undefined {
  const text = lines.join("\n").replace(/^(?:\r?\n)+|(?:\r?\n)+$/gu, "");
  return text === "" ? undefined : text;
}

/** One section per hunk, following OpenCode's per-hunk layout; `source` stands in for a hunkless file. */
export function patchSections(file: StructuredPatch, source: string): readonly DiffSection[] {
  let previousEnd = 1;
  const sections = file.hunks.map((hunk) => {
    const omittedBefore = Math.max(0, hunk.newStart - previousEnd);
    previousEnd = hunk.newStart + hunk.newLines;
    return {
      patch: formatPatch({ ...file, isGit: false, hunks: [hunk] }, OMIT_HEADERS),
      omittedBefore,
      rows: hunk.lines.filter((line) => !line.startsWith("\\")).length,
      pair: changedLinePair(hunk.lines),
    };
  });
  return sections.length === 0
    ? [{ patch: source, omittedBefore: 0, rows: 0, pair: undefined }]
    : sections;
}

/**
 * jsdiff tolerates prose after hunks. Bound each file first, then use its parsed
 * hunks for both rendering and height, following OpenCode's per-hunk layout.
 */
export function diffFromOutput(text: string): OutputDiff | undefined {
  const lines = text.split("\n");
  const start = lines.findIndex(
    (line, index) => fileHeader(lines, index) || line.startsWith("@@ "),
  );
  if (start < 0) return undefined;
  const files: OutputDiffFile[] = [];
  let end = start;
  while (end < lines.length) {
    const fileStart = end;
    let headerEnd = fileStart;
    if (lines[headerEnd]?.startsWith("diff --git ")) {
      headerEnd++;
      while (
        /^(?:index |(?:old|new|new file|deleted file) mode |(?:dis)?similarity index |(?:rename|copy) (?:from|to) |Binary files )/u.test(
          lines[headerEnd] ?? "",
        )
      )
        headerEnd++;
    }
    if (lines[headerEnd]?.startsWith("--- ") && lines[headerEnd + 1]?.startsWith("+++ "))
      headerEnd += 2;
    let fileEnd = headerEnd;
    while (lines[fileEnd]?.startsWith("@@ ")) {
      const next = hunkEnd(lines, fileEnd);
      if (next === fileEnd) break;
      fileEnd = next;
    }
    if (fileEnd === fileStart) break;
    const source = lines.slice(fileStart, fileEnd).join("\n");
    let parsed: StructuredPatch[];
    try {
      parsed = parsePatch(source);
    } catch {
      break;
    }
    const file = parsed[0];
    if (
      file === undefined ||
      (file.hunks.length === 0 &&
        file.isBinary !== true &&
        file.isRename !== true &&
        file.isCopy !== true &&
        file.isCreate !== true &&
        file.isDelete !== true &&
        file.oldMode === file.newMode)
    )
      break;
    files.push({ path: diffPath(file), sections: patchSections(file, source) });
    end = fileEnd;
    if (!fileHeader(lines, end)) break;
  }
  if (files.length === 0) return undefined;
  return {
    files,
    before: trimSection(lines.slice(0, start)),
    after: trimSection(lines.slice(end)),
  };
}
