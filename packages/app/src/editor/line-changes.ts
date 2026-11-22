import type { FileDiffMetadata } from "@nyte-ai/ui/diffs";
import type { TextEdit } from "@nyte-ai/ui/diffs/edit";

export interface LineChange {
  readonly kind: "added" | "modified" | "deleted";
  readonly start: number;
  readonly removed: readonly string[];
  readonly added: readonly string[];
}

export function lineChanges(diff: FileDiffMetadata): readonly LineChange[] {
  return diff.hunks.flatMap((hunk) => {
    let line = hunk.additionStart;

    return hunk.hunkContent.flatMap((content): LineChange[] => {
      if (content.type === "context") {
        line += content.lines;

        return [];
      }

      const start = line;
      line += content.additions;

      const removed = diff.deletionLines
        .slice(content.deletionLineIndex, content.deletionLineIndex + content.deletions)
        .map(stripEnd);

      const added = diff.additionLines
        .slice(content.additionLineIndex, content.additionLineIndex + content.additions)
        .map(stripEnd);

      return [
        {
          kind: added.length === 0 ? "deleted" : removed.length === 0 ? "added" : "modified",
          start,
          removed,
          added,
        },
      ];
    });
  });
}

/** The text a diff was made from, read back from the text it made; undefined once that text has moved on. */
export function textBefore(diff: FileDiffMetadata, after: string): string | undefined {
  const changes = lineChanges(diff);
  const lines = after.split("\n").map((line) => line.replace(/\r$/u, ""));

  const fits = changes.every((change) =>
    change.added.every((line, offset) => lines[change.start - 1 + offset] === line),
  );

  return fits
    ? changes.toReversed().reduce((text, change) => revertChange(text, change), after)
    : undefined;
}

function revertChange(contents: string, change: LineChange): string {
  const carriage = contents.includes("\r\n") ? "\r" : "";
  const lines = contents.split("\n");

  lines.splice(
    change.start - 1,
    change.added.length,
    ...change.removed.map((text) => `${text}${carriage}`),
  );

  return lines.join("\n");
}

/**
 * The one edit that puts a change's old lines back, in the positions of the text it changed, for the editor to apply
 * so the revert joins its undo history and leaves the caret outside it where it was. Lines keep the text's own line
 * ending; a change that reaches the last line keeps that line's lack of a final break, as `revertChange` does.
 */
export function revertEdit(
  change: LineChange,
  text: { readonly lineCount: number; readonly lineLength: (line: number) => number },
): TextEdit {
  const from = change.start - 1;
  const through = from + change.added.length;
  const last = text.lineCount - 1;

  if (through <= last) {
    return {
      range: { start: { line: from, character: 0 }, end: { line: through, character: 0 } },
      newText: change.removed.map((line) => `${line}\n`).join(""),
    };
  }

  const lead = from === 0 || change.removed.length === 0 ? "" : "\n";

  return {
    range: {
      start:
        from === 0
          ? { line: 0, character: 0 }
          : { line: from - 1, character: text.lineLength(from - 1) },
      end: { line: last, character: text.lineLength(last) },
    },
    newText: `${lead}${change.removed.join("\n")}`,
  };
}

export function changeBarCss(changes: readonly LineChange[]): string {
  const rule = (kind: LineChange["kind"], color: string, shadow: string): string => {
    const selectors = changes
      .filter((change) => change.kind === kind)
      .flatMap((change) =>
        kind === "deleted"
          ? [Math.max(1, change.start - 1)]
          : Array.from({ length: change.added.length }, (_, index) => change.start + index),
      )
      .map((line) => `[data-column-number="${String(line)}"]`);

    return selectors.length === 0
      ? ""
      : `${selectors.join(",")}{box-shadow:${shadow} var(${color});cursor:pointer}`;
  };

  return [
    rule("added", "--diffs-addition-base", "inset 3px 0 0"),
    rule("modified", "--diffs-modified-base", "inset 3px 0 0"),
    rule("deleted", "--diffs-deletion-base", "inset 3px -2px 0 -1px"),
  ].join("\n");
}

function stripEnd(text: string): string {
  return text.replace(/\r?\n$/u, "");
}
