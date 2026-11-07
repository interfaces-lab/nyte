import { parseDiffFromFile } from "@pierre/diffs";

export interface LineChange {
  readonly kind: "added" | "modified" | "deleted";
  readonly start: number;
  readonly removed: readonly string[];
  readonly added: readonly string[];
}

export function lineChanges(
  name: string,
  committed: string,
  current: string,
): readonly LineChange[] {
  const diff = parseDiffFromFile({ name, contents: committed }, { name, contents: current });

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

export function revertChange(contents: string, change: LineChange): string {
  const carriage = contents.includes("\r\n") ? "\r" : "";
  const lines = contents.split("\n");

  lines.splice(
    change.start - 1,
    change.added.length,
    ...change.removed.map((text) => `${text}${carriage}`),
  );

  return lines.join("\n");
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
