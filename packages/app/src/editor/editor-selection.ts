import type { Editor, EditorSelection, Range } from "@nyte-ai/ui/diffs/edit";
import type { CodeViewHandle } from "@nyte-ai/ui/diffs/react";
import { role } from "@nyte-ai/ui/styles/vars.stylex";
import { Value } from "typebox/value";
import { currentLights, shine } from "../light/light.ts";
import type { Subject } from "../light/light.ts";
import { ADD_TO_CHAT_LABEL, addToChatShortcut } from "../references/add-to-chat.ts";
import type { FileTarget } from "./file-store.ts";

const SURFACE = "editor";

interface TextPosition {
  readonly line: number;
  readonly character: number;
}

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

/**
 * Moves the person's light to what they selected in a file, or to the file when the selection is a bare caret. Offsets
 * come from the editor's document, which counts them without building the file's text.
 */
export function shineSelection(
  path: string,
  text: { readonly eol: string; offsetAt(position: TextPosition): number },
  selection: EditorSelection,
): void {
  const collapsed =
    selection.start.line === selection.end.line &&
    selection.start.character === selection.end.character;

  const start = collapsed ? 0 : fileOffset(text, selection.start);
  const end = collapsed ? 0 : fileOffset(text, selection.end);

  const subject: Subject = collapsed
    ? { kind: "file", path }
    : { kind: "span", path, start: Math.min(start, end), end: Math.max(start, end) };

  if (Value.Equal(currentLights().you?.subject, subject)) return;
  shine(subject, SURFACE);
}

/** Where the editor lands for a span of a file's text: from its first character to the one after its last. */
export function spanTarget(
  text: string,
  start: number,
  end: number,
): Extract<FileTarget, { readonly kind: "range" }> {
  const from = textPosition(text, start);
  const to = textPosition(text, end);

  return {
    kind: "range",
    line: from.line + 1,
    column: from.character + 1,
    endLine: to.line + 1,
    endColumn: to.character + 1,
  };
}

function fileOffset(
  text: { readonly eol: string; offsetAt(position: TextPosition): number },
  position: TextPosition,
): number {
  return text.offsetAt(position) + position.line * (text.eol.length - 1);
}

function textPosition(text: string, offset: number): TextPosition {
  const rows = text.slice(0, offset).split("\n");

  return { line: rows.length - 1, character: rows.at(-1)?.length ?? 0 };
}

/** Puts the selection in the editor and shows it: unmoved when its line is already in view, centred otherwise. */
export function revealSelection(
  viewer: Pick<CodeViewHandle<undefined, undefined>, "scrollTo">,
  editor: Pick<Editor, "focus" | "getRangeRect" | "setSelections">,
  input: {
    readonly path: string;
    readonly selection: Range & { readonly direction: "none" | "forward" | "backward" };
    readonly box: HTMLElement | null;
  },
): void {
  const head = input.selection.start;
  const shown = inView(editor.getRangeRect({ start: head, end: head }), input.box);

  editor.setSelections([input.selection]);
  editor.focus({ preventScroll: true });

  if (!shown) {
    viewer.scrollTo({ type: "line", id: input.path, lineNumber: head.line + 1, align: "center" });
  }
}

function inView(caret: DOMRect | undefined, box: HTMLElement | null): boolean {
  const bounds = box?.getBoundingClientRect();

  return (
    caret !== undefined &&
    bounds !== undefined &&
    caret.top >= bounds.top &&
    caret.bottom <= bounds.bottom
  );
}

/**
 * Keeps a selection that went to chat but takes its Add to Chat action down. Collapsing it closes the action, and a
 * selection the app sets stays without one until the person selects again.
 */
export function settleAddedSelection(
  editor: Pick<Editor, "setViewState">,
  selection: EditorSelection,
): void {
  editor.setViewState({ selections: [{ ...selection, end: selection.start }] });
  editor.setViewState({ selections: [selection] });
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
