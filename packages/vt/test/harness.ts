import { readFile } from "node:fs/promises";

import { createTerminal, loadEngine } from "../src/index.ts";

import type { ColorScheme, Frame, KeyInput, Terminal, TerminalOptions } from "../src/index.ts";

export const wasmBytes = await readFile(new URL("../ghostty-vt.wasm", import.meta.url));

const engine = await loadEngine(wasmBytes);

const encoder = new TextEncoder();

const decoder = new TextDecoder();

export interface Recorded {
  readonly terminal: Terminal;
  readonly replies: string[];
  readonly titles: string[];
  readonly write: (text: string) => void;
  readonly onReply: (handler: (reply: string) => void) => void;
}

export async function openTerminal(
  options: Partial<Omit<TerminalOptions, "effects">> & { readonly scheme?: ColorScheme } = {},
): Promise<Recorded> {
  const replies: string[] = [];
  const titles: string[] = [];
  const handlers: ((reply: string) => void)[] = [];

  const terminal = await createTerminal(engine, {
    cols: 80,
    rows: 24,
    cell: { width: 8, height: 16 },
    scrollback: 10_000,
    palette: { foreground: 0xdddddd, background: 0x101010, cursor: 0xffffff, ansi: [] },
    cursor: { style: "block", blink: false },
    newlineMode: false,
    ...options,
    effects: {
      reply: (bytes) => {
        const reply = decoder.decode(bytes);

        replies.push(reply);
        handlers.forEach((handler) => handler(reply));
      },
      title: (title) => titles.push(title),
      colorScheme: () => options.scheme ?? "dark",
    },
  });

  return {
    terminal,
    replies,
    titles,
    write: (text) => terminal.write(encoder.encode(text)),
    onReply: (handler) => handlers.push(handler),
  };
}

export function screenText(frame: Frame) {
  return frame.rows.map((row) =>
    row.cells
      .filter((cell) => cell.width !== 0)
      .map((cell) => cell.text || " ")
      .join("")
      .trimEnd(),
  );
}

export function decode(bytes: Uint8Array) {
  return decoder.decode(bytes);
}

export function key(code: string, text: string, modifiers: Partial<KeyInput> = {}): KeyInput {
  return {
    action: "press",
    code,
    key: text,
    shift: false,
    ctrl: false,
    alt: false,
    meta: false,
    composing: false,
    optionAsAlt: false,
    ...modifiers,
  };
}
