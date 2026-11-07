import type { EditorSelection, Range } from "@pierre/diffs/edit";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { ADD_TO_CHAT_LABEL, addToChatShortcut } from "../../references/add-to-chat.ts";

export const SELECTION_ACTION_CSS = `
[data-add-selection] {
  appearance: none;
  display: flex;
  align-items: center;
  gap: 6px;
  margin: 0;
  padding: 2px 8px;
  border: 0;
  border-radius: 5px;
  background: none;
  color: ${role.contentPrimary};
  font: inherit;
  font-size: 12px;
  cursor: pointer;
}
@media (hover: hover) and (pointer: fine) {
  [data-add-selection]:hover {
    background-color: ${role.fillTertiary};
  }
}
[data-add-selection] kbd {
  font: inherit;
  color: ${role.contentTertiary};
}
`;

export function selectedLines(
  selection: EditorSelection | undefined,
): { readonly start: number; readonly end: number } | undefined {
  if (selection === undefined) return undefined;
  const { start, end } = selection;

  if (start.line === end.line && start.character === end.character) return undefined;
  const last = end.character === 0 && end.line > start.line ? end.line - 1 : end.line;

  return { start: start.line + 1, end: last + 1 };
}

/**
 * Selects whole lines `start` to `end` of `text`, one-based and inclusive, clamped to the file: up to
 * the next line's start, or the last line's end at the end of the file. Backward, so the caret stays
 * on the first line.
 */
export function wholeLineSelection(
  text: string,
  lines: { readonly start: number; readonly end: number },
): Range & { readonly direction: "backward" } {
  const rows = text.split("\n");
  const last = rows.length - 1;
  const start = Math.min(Math.max(lines.start, 1), rows.length) - 1;
  const end = Math.min(Math.max(lines.end, lines.start), rows.length) - 1;

  return {
    start: { line: start, character: 0 },
    end:
      end < last
        ? { line: end + 1, character: 0 }
        : { line: last, character: rows[last]?.length ?? 0 },
    direction: "backward",
  };
}

export function selectionAction(mac: boolean, add: () => void): HTMLElement {
  const button = document.createElement("button");
  button.type = "button";
  button.dataset.addSelection = "";
  button.append(ADD_TO_CHAT_LABEL);
  const keys = document.createElement("kbd");
  keys.textContent = addToChatShortcut(mac);
  button.append(keys);
  button.addEventListener("pointerdown", (event) => event.preventDefault());
  button.addEventListener("click", add);

  return button;
}
