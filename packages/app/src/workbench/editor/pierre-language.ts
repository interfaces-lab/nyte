import type { TokenEventBase } from "@nyte-ai/ui/diffs";
import type { EditorChange, EditorSelection, Range } from "@nyte-ai/ui/diffs/edit";
import type { TextChange, TextPosition, TextRange } from "@nyte-ai/sdk";
import type { PointedWord } from "./use-declarations.ts";

export function caretPosition(selection: EditorSelection | undefined): TextPosition | undefined {
  if (selection === undefined) return undefined;
  const caret = selection.direction === -1 ? selection.start : selection.end;

  return { line: caret.line, utf16Column: caret.character };
}

export function selectionRange(selection: EditorSelection | undefined): TextRange | undefined {
  if (selection === undefined) return undefined;

  return {
    start: { line: selection.start.line, utf16Column: selection.start.character },
    end: { line: selection.end.line, utf16Column: selection.end.character },
  };
}

export function editorRange(range: TextRange): Range {
  return {
    start: { line: range.start.line, character: range.start.utf16Column },
    end: { line: range.end.line, character: range.end.utf16Column },
  };
}

/** Pierre's changes are all against the text before the edit; LSP applies each to the text the one before left, so the last goes first. */
export function textChanges(changes: readonly EditorChange[]): readonly TextChange[] {
  return changes
    .toSorted((first, second) => second.start - first.start)
    .map((change) => ({
      range: {
        start: { line: change.range.start.line, utf16Column: change.range.start.character },
        end: { line: change.range.end.line, utf16Column: change.range.end.character },
      },
      text: change.text,
    }));
}

function pointedWord(token: TokenEventBase): PointedWord {
  const offset = Math.max(0, token.tokenText.search(/[\p{L}\p{N}_$]/u));

  return {
    position: { line: token.lineNumber - 1, utf16Column: token.lineCharStart + offset },
    element: token.tokenElement,
  };
}

/** Pierre's token hooks wired to a pointer over words. */
export function tokenHooks(pointer: {
  enter(word: PointedWord, event: PointerEvent): void;
  leave(element: HTMLElement): void;
  click(word: PointedWord, event: MouseEvent): void;
}) {
  return {
    onTokenEnter: (token: TokenEventBase, event: PointerEvent): void =>
      pointer.enter(pointedWord(token), event),
    onTokenLeave: (token: TokenEventBase): void => pointer.leave(token.tokenElement),
    onTokenClick: (token: TokenEventBase, event: MouseEvent): void =>
      pointer.click(pointedWord(token), event),
  };
}
