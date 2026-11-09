import { ColorScheme, TerminalData } from "./constants.ts";
import { check } from "./memory.ts";

import type { Geometry } from "./context.ts";
import type { ColorScheme as Scheme, TerminalEffects } from "./index.ts";
import type { Layout } from "./layout.ts";
import type { Memory } from "./memory.ts";
import type { Native } from "./native.ts";
import type { Callback, CallbackName } from "./trampoline.ts";

interface Effects {
  readonly handlers: Readonly<Record<CallbackName, Callback>>;
  readonly reply: (bytes: Uint8Array) => void;
  readonly flush: () => void;
  readonly capture: (run: () => number) => { readonly result: number; readonly output: Uint8Array };
  readonly scheme: (scheme: Scheme) => void;
}

const randomChunk = 65_536;

export function createEffects(
  native: Native,
  layout: Layout,
  memory: Memory,
  effects: TerminalEffects,
  geometry: () => Geometry,
  readMime: (writer: number) => number,
  hold: (held: boolean) => void,
): Effects {
  const title = memory.allocate(layout.string.size);
  const queue: (() => void)[] = [];
  const captured: Uint8Array[] = [];
  let capturing = false;
  let flushing = false;
  let scheme = effects.colorScheme();

  return {
    handlers: {
      writePty: (_terminal, _userdata, data, length) => {
        const bytes = memory.copy(data, length);

        if (capturing) captured.push(bytes);

        if (!capturing) queue.push(() => effects.reply(bytes));
      },
      titleChanged: (terminal) => {
        check(native.ghostty_terminal_get(terminal, TerminalData.TITLE, title), "title query");
        const view = memory.view();

        const text = memory.text(
          view.getUint32(title + layout.string.pointer, true),
          view.getUint32(title + layout.string.length, true),
        );

        queue.push(() => effects.title(text));
      },
      size: (_terminal, _userdata, out) => {
        const size = geometry();
        const view = memory.view();

        view.setUint16(out + layout.sizeReport.rows, size.rows, true);
        view.setUint16(out + layout.sizeReport.columns, size.cols, true);
        view.setUint32(out + layout.sizeReport.cellWidth, size.pixels.width, true);
        view.setUint32(out + layout.sizeReport.cellHeight, size.pixels.height, true);

        return 1;
      },
      colorScheme: (_terminal, _userdata, out) => {
        memory.view().setInt32(out, scheme === "dark" ? ColorScheme.DARK : ColorScheme.LIGHT, true);

        return 1;
      },
      renderHold: (_terminal, _userdata, held) => hold(held !== 0),
      randomSecure: (_userdata, buffer, length) => {
        Array.from(
          { length: Math.ceil(length / randomChunk) },
          (_, index) => index * randomChunk,
        ).forEach((start) => {
          const bytes = globalThis.crypto.getRandomValues(
            new Uint8Array(Math.min(randomChunk, length - start)),
          );

          memory.bytes().set(bytes, buffer + start);
        });

        return 1;
      },
      readMime: (_userdata, _mime, writer) => readMime(writer),
    },
    reply: (bytes) => {
      queue.push(() => effects.reply(bytes));
    },
    flush: () => {
      if (flushing) return;
      flushing = true;

      try {
        for (let next = queue.shift(); next !== undefined; next = queue.shift()) next();
      } finally {
        flushing = false;
      }
    },
    capture: (run) => {
      capturing = true;

      try {
        const result = run();
        const output = new Uint8Array(captured.reduce((total, chunk) => total + chunk.length, 0));

        captured.reduce((offset, chunk) => {
          output.set(chunk, offset);

          return offset + chunk.length;
        }, 0);

        return { result, output };
      } finally {
        capturing = false;
        captured.splice(0);
      }
    },
    scheme: (next) => {
      scheme = next;
    },
  };
}
