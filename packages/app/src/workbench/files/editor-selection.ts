import type { EditorSelection } from "@pierre/diffs/edit";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { ADD_TO_CHAT_LABEL, addToChatShortcut } from "../../references/add-to-chat.ts";

/** The popover's look, for the editor's shadow root, which the app's styles don't reach. */
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

/** The lines a selection covers, one-based; a selection that ends at the start of a line leaves that line out. */
export function selectedLines(
  selection: EditorSelection | undefined,
): { readonly start: number; readonly end: number } | undefined {
  if (selection === undefined) return undefined;
  const { start, end } = selection;

  if (start.line === end.line && start.character === end.character) return undefined;
  const last = end.character === 0 && end.line > start.line ? end.line - 1 : end.line;

  return { start: start.line + 1, end: last + 1 };
}

/** The popover a fresh selection opens, offering to add its lines to the chat. */
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
