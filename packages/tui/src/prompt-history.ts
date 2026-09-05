/**
 * Up and Down over the composer, shell-style but wrap-aware. The caret walks
 * the rows the terminal draws, and history only takes over once the caret has
 * nowhere further to go: earlier prompts from the start of the draft, later
 * ones from its end.
 *
 * Based on OpenCode v2's prompt history and its Up/Down handling:
 * https://github.com/anomalyco/opencode/blob/v2/packages/tui/src/prompt/history.tsx
 */
import type { TextareaRenderable } from "@opentui/core";

const MAX_HISTORY = 100;

export class PromptHistory {
  private entries: string[] = [];
  private index: number | undefined;
  private draft = "";

  replace(entries: readonly string[]): void {
    this.entries = entries.filter((entry) => entry.trim() !== "").slice(-MAX_HISTORY);
    this.index = undefined;
  }

  record(entry: string): void {
    if (entry.trim() === "") return;
    if (this.entries.at(-1) !== entry) this.entries.push(entry);
    if (this.entries.length > MAX_HISTORY) this.entries.shift();
    this.index = undefined;
  }

  previous(current: string): string | undefined {
    if (this.entries.length === 0) return undefined;
    if (this.index === undefined) {
      this.draft = current;
      this.index = this.entries.length - 1;
    } else if (this.index === 0) {
      return undefined;
    } else {
      this.index -= 1;
    }
    return this.entries[this.index];
  }

  next(): string | undefined {
    if (this.index === undefined) return undefined;
    if (this.index === this.entries.length - 1) {
      this.index = undefined;
      const draft = this.draft;
      this.draft = "";
      return draft;
    }
    this.index += 1;
    return this.entries[this.index];
  }

  resetBrowse(): void {
    this.index = undefined;
    this.draft = "";
  }
}

type HistoryDirection = "previous" | "next";

function caretRow(input: TextareaRenderable): number {
  return input.scrollY + input.visualCursor.visualRow;
}

function lastRow(input: TextareaRenderable): number {
  return Math.max(0, input.editorView.getTotalVirtualLineCount() - 1);
}

function atEnd(input: TextareaRenderable): boolean {
  return (
    input.logicalCursor.row === input.lineCount - 1 &&
    input.cursorOffset === input.editorView.getEOL().offset
  );
}

/**
 * One Up or Down press over the composer. False hands the key to the textarea:
 * every press that moves the caret between rows, and every press history has
 * no answer for.
 */
export function browseHistory(
  input: TextareaRenderable,
  history: PromptHistory,
  direction: HistoryDirection,
): boolean {
  if (direction === "previous") {
    if (input.cursorOffset !== 0) {
      if (caretRow(input) !== 0) return false;
      input.gotoBufferHome();
      return true;
    }
    const entry = history.previous(input.plainText);
    if (entry === undefined) return false;
    input.setText(entry);
    input.gotoBufferHome();
    return true;
  }
  if (!atEnd(input)) {
    if (caretRow(input) !== lastRow(input)) return false;
    input.gotoBufferEnd();
    return true;
  }
  const entry = history.next();
  if (entry === undefined) return false;
  input.setText(entry);
  input.gotoBufferEnd();
  return true;
}
