import type { FileDiffMetadata, SelectedLineRange } from "@pierre/diffs";
import type { ExcerptReference } from "../conversation/message-references.ts";

interface DiffRow {
  readonly marker: " " | "-" | "+";
  readonly old: number | undefined;
  readonly new: number | undefined;
  readonly content: string;
}

function lineText(lines: readonly string[], index: number): string {
  return (lines[index] ?? "").replace(/\r?\n$/u, "");
}

function diffRows(diff: FileDiffMetadata): readonly DiffRow[] {
  const rows: DiffRow[] = [];
  const whole = !diff.isPartial;

  const context = (index: number, count: number, old: number, next: number): void => {
    for (let offset = 0; offset < count; offset += 1)
      rows.push({
        marker: " ",
        old: old + offset,
        new: next + offset,
        content: lineText(diff.additionLines, index + offset),
      });
  };

  let oldIndex = 0;
  let newIndex = 0;

  for (const hunk of diff.hunks) {
    if (whole)
      context(
        hunk.additionLineIndex - hunk.collapsedBefore,
        hunk.collapsedBefore,
        hunk.deletionLineIndex - hunk.collapsedBefore + 1,
        hunk.additionLineIndex - hunk.collapsedBefore + 1,
      );
    let old = hunk.deletionStart;
    let next = hunk.additionStart;

    for (const content of hunk.hunkContent) {
      if (content.type === "context") {
        context(content.additionLineIndex, content.lines, old, next);
        old += content.lines;
        next += content.lines;
        continue;
      }

      for (let offset = 0; offset < content.deletions; offset += 1)
        rows.push({
          marker: "-",
          old: old + offset,
          new: undefined,
          content: lineText(diff.deletionLines, content.deletionLineIndex + offset),
        });

      for (let offset = 0; offset < content.additions; offset += 1)
        rows.push({
          marker: "+",
          old: undefined,
          new: next + offset,
          content: lineText(diff.additionLines, content.additionLineIndex + offset),
        });
      old += content.deletions;
      next += content.additions;
    }

    oldIndex = hunk.deletionLineIndex + hunk.deletionCount;
    newIndex = hunk.additionLineIndex + hunk.additionCount;
  }

  if (whole && diff.hunks.length > 0)
    context(
      newIndex,
      Math.max(0, diff.additionLines.length - newIndex),
      oldIndex + 1,
      newIndex + 1,
    );

  return rows;
}

function rowIndex(rows: readonly DiffRow[], line: number, side: SelectedLineRange["side"]): number {
  return rows.findIndex((row) => (side === "deletions" ? row.old : row.new) === line);
}

function span(numbers: readonly (number | undefined)[]) {
  const present = numbers.filter((value) => value !== undefined);

  return present.length === 0
    ? undefined
    : { start: Math.min(...present), count: present.length, end: Math.max(...present) };
}

export function diffRangeExcerpt(
  path: string,
  diff: FileDiffMetadata,
  range: SelectedLineRange,
): ExcerptReference | undefined {
  const rows = diffRows(diff);
  const from = rowIndex(rows, range.start, range.side);
  const to = rowIndex(rows, range.end, range.endSide ?? range.side);

  if (from < 0 || to < 0) return undefined;
  const picked = rows.slice(Math.min(from, to), Math.max(from, to) + 1);
  const old = span(picked.map((row) => row.old));
  const next = span(picked.map((row) => row.new));
  const lines = next ?? old;

  if (lines === undefined) return undefined;
  const before = rows.slice(0, Math.min(from, to));

  const start = (side: "old" | "new"): number =>
    before.findLast((row) => row[side] !== undefined)?.[side] ?? 0;

  const header = `@@ -${String(old?.start ?? start("old"))},${String(old?.count ?? 0)} +${String(next?.start ?? start("new"))},${String(next?.count ?? 0)} @@`;

  return {
    kind: "excerpt",
    source: {
      kind: "diff",
      path,
      side: next === undefined ? "old" : "new",
      start: lines.start,
      end: lines.end,
    },
    text: [header, ...picked.map((row) => `${row.marker}${row.content}`)].join("\n"),
  };
}
