/**
 * The attach-only handles of the two native renderables the model drives:
 * the composer's textarea and the transcript's scrollbox. Plain interfaces,
 * so `ui/` (which attaches them) and `effects/` (which calls them) share one
 * definition without either importing the other.
 */
import type { DraftSnapshot } from "./draft.ts";

export interface ComposerPort {
  set(draft: DraftSnapshot): void;
  insert(text: string, at: "cursor" | "start"): void;
  replaceRange(from: number, to: number, text: string): void;
  clear(): void;
  focus(): void;
  /** Moves the cursor to the start or the end of the draft (Up/Down before history takes over). */
  cursor(to: "start" | "end"): void;
}

export interface ScrollPort {
  page(direction: -1 | 1): void;
  /** Scrolls by whole rows (the task inspector's ↑/↓). */
  by(lines: number): void;
  latest(): void;
  /** Reads the row's renderable position at call time (`getComputedLayout()`), never an estimate. */
  row(key: string): void;
  /** Captures `scrollHeight`, and on the content's next resize scrolls by the difference. */
  keepViewport(): void;
  /** Ctrl+Up/Down: scrolls to the previous/next turn from the one at the top of the viewport, read at call time. */
  turn(direction: -1 | 1): void;
}
