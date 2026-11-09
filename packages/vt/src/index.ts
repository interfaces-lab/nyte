import type { Layout } from "./layout.ts";

export type Rgb = number;

export type ColorScheme = "light" | "dark";

export type CursorStyle = "bar" | "block" | "underline" | "block-hollow";

export interface Palette {
  readonly foreground: Rgb;
  readonly background: Rgb;
  readonly cursor: Rgb;
  readonly ansi: readonly Rgb[];
}

export interface TerminalEffects {
  readonly reply: (bytes: Uint8Array) => void;
  readonly title: (title: string) => void;
  readonly colorScheme: () => ColorScheme;
}

export interface CellSize {
  readonly width: number;
  readonly height: number;
}

export interface TerminalOptions {
  readonly cols: number;
  readonly rows: number;
  readonly cell: CellSize;
  readonly scrollback: number;
  readonly palette: Palette;
  readonly cursor: { readonly style: CursorStyle; readonly blink: boolean };
  readonly newlineMode: boolean;
  readonly effects: TerminalEffects;
}

export interface Screen {
  readonly cols: number;
  readonly rows: number;
  readonly glyph: Uint32Array;
  readonly width: Uint8Array;
  readonly fg: Int32Array;
  readonly bg: Int32Array;
  readonly underlineColor: Int32Array;
  readonly flags: Uint8Array;
  readonly underline: Uint8Array;
  readonly wrapped: Uint8Array;
  readonly selectionStart: Int32Array;
  readonly selectionEnd: Int32Array;
  readonly hash: Uint32Array;
  text(index: number): string;
}

export interface Cursor {
  readonly x: number;
  readonly y: number;
  readonly style: CursorStyle;
  readonly blinking: boolean;
  readonly wide: boolean;
}

export interface Frame {
  readonly full: boolean;
  readonly held: boolean;
  readonly dirty: readonly number[];
  readonly cursor: Cursor | null;
  readonly foreground: Rgb;
  readonly background: Rgb;
  readonly cursorColor: Rgb | null;
}

export interface Scrollbar {
  readonly total: number;
  readonly offset: number;
  readonly length: number;
}

export interface Modifiers {
  readonly shift: boolean;
  readonly ctrl: boolean;
  readonly alt: boolean;
  readonly meta: boolean;
}

export interface KeyInput extends Modifiers {
  readonly action: "press" | "repeat" | "release";
  readonly code: string;
  readonly key: string;
  readonly composing: boolean;
  readonly optionAsAlt: boolean;
}

export type MouseButton =
  | "left"
  | "middle"
  | "right"
  | "wheel-up"
  | "wheel-down"
  | "wheel-left"
  | "wheel-right";

export interface MouseInput extends Modifiers {
  readonly action: "press" | "release" | "motion";
  readonly button: MouseButton | null;
  readonly x: number;
  readonly y: number;
}

export interface SelectionInput {
  readonly action: "press" | "drag" | "release";
  readonly col: number;
  readonly row: number;
  readonly x: number;
  readonly y: number;
  readonly time: number;
  readonly rectangle: boolean;
}

export interface Mark {
  readonly text: string;
  row(): number | null;
  dispose(): void;
}

export interface Terminal {
  readonly cols: number;
  readonly rows: number;
  readonly screen: Screen;
  write(bytes: Uint8Array): void;
  resize(cols: number, rows: number, cell: CellSize): void;
  reset(): void;
  setPalette(palette: Palette): void;
  setScrollback(lines: number): void;
  setCursor(cursor: { readonly style: CursorStyle; readonly blink: boolean }): void;
  colorSchemeChanged(scheme: ColorScheme): void;
  frame(full: boolean): Frame;
  scrollbar(): Scrollbar;
  scroll(delta: number): void;
  scrollToBottom(): void;
  key(input: KeyInput): Uint8Array;
  mouseTracking(): boolean;
  alternateScroll(): boolean;
  mouse(input: MouseInput): Uint8Array;
  focus(focused: boolean): Uint8Array;
  paste(text: string): Uint8Array;
  select(input: SelectionInput): void;
  clearSelection(): void;
  hasSelection(): boolean;
  selectionText(): string;
  selectionTop(): number | null;
  hyperlink(col: number, row: number): string | null;
  markCursorLine(): Mark | null;
  dispose(): void;
}

export interface Engine {
  readonly module: WebAssembly.Module;
  readonly layout: Layout;
  readonly keys: ReadonlyMap<string, number>;
  readonly trampolines: WebAssembly.Module;
}

export { loadEngine } from "./engine.ts";

export { createTerminal } from "./terminal.ts";

export { CellFlag, NO_COLOR, UnderlineStyle } from "./screen.ts";
