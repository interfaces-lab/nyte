import { parseDiffFromFile } from "@nyte-ai/ui/diffs";
import type { Editor, EditorChange, TextEdit } from "@nyte-ai/ui/diffs/edit";

/**
 * Brings the editor to `contents` with one edit per changed run of lines, so history, the caret, selections, scroll
 * and the rows around them survive a change made outside the editor: a save that formatted, a reload from disk, an
 * agent's edit, another editor of the same file catching up. Pierre remaps a caret inside an edit to its end, so
 * edits as small as the change keep every caret outside them where it was.
 */
export function replaceContents(
  editor: Pick<Editor, "getFile" | "getText" | "applyEdits">,
  contents: string,
): void {
  if (editor.getFile() === undefined) return;
  const previous = editor.getText();

  if (previous === contents) return;
  editor.applyEdits([...lineEdits(previous, contents)]);
}

/** The edits that turn `previous` into `next`, one per run of changed lines, in `previous`'s positions. */
export function lineEdits(previous: string, next: string): readonly TextEdit[] {
  const diff = parseDiffFromFile({ name: "a", contents: previous }, { name: "a", contents: next });
  const rows = previous.split(/\r\n|\r|\n/u);
  const last = rows.length - 1;
  const end = { line: last, character: rows[last]?.length ?? 0 };

  return diff.hunks.flatMap((hunk) =>
    hunk.hunkContent.flatMap((content) => {
      if (content.type === "context") return [];
      const from = content.deletionLineIndex;
      const through = from + content.deletions;

      return [
        {
          range: {
            start: { line: from, character: 0 },
            end: through > last ? end : { line: through, character: 0 },
          },
          newText: diff.additionLines
            .slice(content.additionLineIndex, content.additionLineIndex + content.additions)
            .join(""),
        },
      ];
    }),
  );
}

/** Pierre's changes as edits another editor of the same text can apply. */
export function changeEdits(changes: readonly EditorChange[]): readonly TextEdit[] {
  return changes.map((change) => ({ range: change.range, newText: change.text }));
}
