import type { DraftSnapshot } from "./draft.ts";

export interface ComposerPort {
  set(draft: DraftSnapshot): void;
  insert(text: string, at: "cursor" | "start"): void;
  replaceRange(from: number, to: number, text: string): void;
  clear(): void;
  focus(): void;
  cursor(to: "start" | "end"): void;
}

export interface ScrollPort {
  page(direction: -1 | 1): void;
  by(lines: number): void;
  latest(): void;
  row(key: string): void;
  keepViewport(): void;
  turn(direction: -1 | 1): void;
}
