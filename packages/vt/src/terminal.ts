import { createContext } from "./context.ts";
import {
  CursorStyle,
  Mode,
  ScrollViewportTag,
  SysOption,
  TerminalData,
  TerminalOption,
} from "./constants.ts";
import { createEffects } from "./effects.ts";
import { createFrames } from "./frame.ts";
import { createInput } from "./input.ts";
import { check, createMemory } from "./memory.ts";
import { requireNative } from "./native.ts";
import { createSelection } from "./selection.ts";
import { installTrampolines } from "./trampoline.ts";

import type { Geometry } from "./context.ts";
import type {
  CellSize,
  CursorStyle as CursorKind,
  Engine,
  Palette,
  Terminal,
  TerminalOptions,
} from "./index.ts";

const cursorStyles = {
  bar: CursorStyle.BAR,
  block: CursorStyle.BLOCK,
  underline: CursorStyle.UNDERLINE,
  "block-hollow": CursorStyle.BLOCK_HOLLOW,
} as const;

const writeChunk = 65_536;

const holdLimit = 1000;

const sizeMax = 0xffff_ffff;

export async function createTerminal(engine: Engine, options: TerminalOptions): Promise<Terminal> {
  let session: Terminal | null = await openSession(engine, options);
  let cols = options.cols;
  let rows = options.rows;

  const live = () => {
    if (session === null) throw new Error("terminal is disposed");

    return session;
  };

  return {
    get cols() {
      return cols;
    },
    get rows() {
      return rows;
    },
    get screen() {
      return live().screen;
    },
    write: (bytes) => live().write(bytes),
    resize: (nextCols, nextRows, cell) => {
      live().resize(nextCols, nextRows, cell);
      cols = nextCols;
      rows = nextRows;
    },
    reset: () => live().reset(),
    setPalette: (palette) => live().setPalette(palette),
    setScrollback: (lines) => live().setScrollback(lines),
    setCursor: (cursor) => live().setCursor(cursor),
    colorSchemeChanged: (scheme) => live().colorSchemeChanged(scheme),
    frame: (full) => live().frame(full),
    scrollbar: () => live().scrollbar(),
    scroll: (delta) => live().scroll(delta),
    scrollToBottom: () => live().scrollToBottom(),
    key: (input) => live().key(input),
    mouseTracking: () => live().mouseTracking(),
    alternateScroll: () => live().alternateScroll(),
    mouse: (input) => live().mouse(input),
    focus: (focused) => live().focus(focused),
    paste: (text) => live().paste(text),
    select: (input) => live().select(input),
    clearSelection: () => live().clearSelection(),
    hasSelection: () => live().hasSelection(),
    selectionText: () => live().selectionText(),
    selectionTop: () => live().selectionTop(),
    hyperlink: (col, row) => live().hyperlink(col, row),
    markCursorLine: () => live().markCursorLine(),
    dispose: () => {
      session?.dispose();
      session = null;
    },
  };
}

async function openSession(engine: Engine, options: TerminalOptions): Promise<Terminal> {
  const instance = await WebAssembly.instantiate(engine.module, {});
  const native = instance.exports;

  requireNative(native);
  const layout = engine.layout;
  const memory = createMemory(native);

  const effects = createEffects(
    native,
    layout,
    memory,
    options.effects,
    () => geometry,
    (writer) => input.readMime(writer),
    (held) => {
      if (held) frames.capture();
      heldSince = held ? performance.now() : null;
    },
  );

  const pointer = await installTrampolines(
    engine.trampolines,
    native.__indirect_function_table,
    effects.handlers,
  );

  const terminal = memory.handle(
    (slot) => native.ghostty_terminal_new(0, slot, options.cols, options.rows),
    "terminal create",
  );

  const value = memory.allocate(layout.rgb.size * 256);
  const scroll = memory.allocate(layout.scrollViewport.size);
  const modeConfig = memory.allocate(layout.modeConfig.size);
  const writeBuffer = memory.allocate(writeChunk);
  let geometry = measure(options.cols, options.rows, options.cell);
  let heldSince: number | null = null;

  const set = (option: number, pointer: number, what: string) =>
    check(native.ghostty_terminal_set(terminal, option, pointer), what);

  const vtWrite = (bytes: Uint8Array) => {
    for (let offset = 0; offset < bytes.length; offset += writeChunk) {
      const chunk = bytes.subarray(offset, offset + writeChunk);

      memory.bytes().set(chunk, writeBuffer);
      native.ghostty_terminal_vt_write(terminal, writeBuffer, chunk.length);
    }
  };

  const resize = (cols: number, rows: number, cell: CellSize) => {
    const next = measure(cols, rows, cell);

    check(
      native.ghostty_terminal_resize(terminal, cols, rows, next.pixels.width, next.pixels.height),
      "terminal resize",
    );
    geometry = next;
  };

  const setScrollback = (lines: number) => {
    memory.view().setUint32(value, lines, true);
    set(TerminalOption.SCROLLBACK_MAX_LINES, value, "scrollback lines");
    memory.view().setUint32(value, sizeMax, true);
    set(TerminalOption.SCROLLBACK_MAX_BYTES, value, "scrollback bytes");
  };

  const writeRgb = (offset: number, rgb: number) => {
    const view = memory.view();

    view.setUint8(value + offset + layout.rgb.r, (rgb >> 16) & 0xff);
    view.setUint8(value + offset + layout.rgb.g, (rgb >> 8) & 0xff);
    view.setUint8(value + offset + layout.rgb.b, rgb & 0xff);
  };

  const setPalette = (palette: Palette) => {
    writeRgb(0, palette.foreground);
    set(TerminalOption.COLOR_FOREGROUND, value, "foreground");
    writeRgb(0, palette.background);
    set(TerminalOption.COLOR_BACKGROUND, value, "background");
    writeRgb(0, palette.cursor);
    set(TerminalOption.COLOR_CURSOR, value, "cursor color");
    native.ghostty_color_palette_default(value);
    palette.ansi.slice(0, 16).forEach((rgb, index) => writeRgb(index * layout.rgb.size, rgb));
    set(TerminalOption.COLOR_PALETTE, value, "palette");
  };

  const setCursor = (cursor: { readonly style: CursorKind; readonly blink: boolean }) => {
    memory.view().setInt32(value, cursorStyles[cursor.style], true);
    set(TerminalOption.DEFAULT_CURSOR_STYLE, value, "cursor style");
    memory.view().setUint8(value, cursor.blink ? 1 : 0);
    set(TerminalOption.DEFAULT_CURSOR_BLINK, value, "cursor blink");
  };

  const scrollViewport = (tag: number, delta: number) => {
    const view = memory.view();

    view.setInt32(scroll + layout.scrollViewport.tag, tag, true);
    view.setInt32(scroll + layout.scrollViewport.delta, delta, true);
    check(native.ghostty_terminal_scroll_viewport(terminal, scroll), "scroll");
  };

  const context = createContext(native, layout, memory, terminal, () => geometry);

  set(TerminalOption.WRITE_PTY, pointer("writePty"), "write effect");
  set(TerminalOption.TITLE_CHANGED, pointer("titleChanged"), "title effect");
  set(TerminalOption.SIZE, pointer("size"), "size effect");
  set(TerminalOption.COLOR_SCHEME, pointer("colorScheme"), "color scheme effect");
  set(TerminalOption.RENDER_HOLD, pointer("renderHold"), "render hold effect");
  check(native.ghostty_sys_set(SysOption.RANDOM_SECURE, pointer("randomSecure")), "secure random");
  resize(options.cols, options.rows, options.cell);
  setScrollback(options.scrollback);
  setPalette(options.palette);
  setCursor(options.cursor);

  const setMode = (option: number, mode: number, enabled: boolean, what: string) => {
    memory.view().setUint16(modeConfig + layout.modeConfig.mode, mode, true);
    memory.view().setUint8(modeConfig + layout.modeConfig.value, enabled ? 1 : 0);
    set(option, modeConfig, what);
  };

  setMode(TerminalOption.MODE_DEFAULT, Mode.LINEFEED, options.newlineMode, "newline mode");
  setMode(TerminalOption.MODE_DEFAULT, Mode.GRAPHEME_CLUSTER, true, "grapheme clustering");

  const frames = createFrames(context);

  const showLive = () => {
    if (heldSince !== null) frames.capture();
  };

  const releaseExpiredHold = () => {
    if (heldSince === null || performance.now() - heldSince < holdLimit) return;
    setMode(TerminalOption.MODE, Mode.SYNC_OUTPUT, false, "synchronized output");
    heldSince = null;
  };

  const input = createInput(context, engine.keys, effects.capture, pointer("readMime"));
  const selection = createSelection(context);

  return {
    get cols() {
      return geometry.cols;
    },
    get rows() {
      return geometry.rows;
    },
    get screen() {
      return frames.screen();
    },
    write: (bytes) => {
      vtWrite(bytes);
      input.modesChanged();
      effects.flush();
    },
    resize: (cols, rows, cell) => {
      resize(cols, rows, cell);
      effects.flush();
    },
    reset: () => {
      native.ghostty_terminal_reset(terminal);
      input.modesChanged();
      effects.flush();
    },
    setPalette,
    setScrollback,
    setCursor,
    colorSchemeChanged: (scheme) => {
      effects.scheme(scheme);
      const report = input.colorSchemeReport(scheme);

      if (report.length > 0) effects.reply(report);
      effects.flush();
    },
    frame: (full) => {
      releaseExpiredHold();

      return frames.frame(full, heldSince === null);
    },
    scrollbar: () => {
      check(native.ghostty_terminal_get(terminal, TerminalData.SCROLLBAR, value), "scrollbar");
      const view = memory.view();

      return {
        total: Number(view.getBigUint64(value + layout.scrollbar.total, true)),
        offset: Number(view.getBigUint64(value + layout.scrollbar.offset, true)),
        length: Number(view.getBigUint64(value + layout.scrollbar.length, true)),
      };
    },
    scroll: (delta) => {
      scrollViewport(ScrollViewportTag.DELTA, Math.trunc(delta));
      showLive();
    },
    scrollToBottom: () => {
      scrollViewport(ScrollViewportTag.BOTTOM, 0);
      showLive();
    },
    key: input.key,
    mouseTracking: input.mouseTracking,
    alternateScroll: () =>
      context.mode(Mode.ALT_SCROLL) && context.flag(TerminalData.ACTIVE_SCREEN),
    mouse: input.mouse,
    focus: input.focus,
    paste: input.paste,
    select: (input) => {
      selection.select(input);
      showLive();
    },
    clearSelection: () => {
      selection.clear();
      showLive();
    },
    hasSelection: selection.active,
    selectionText: selection.text,
    selectionTop: selection.top,
    hyperlink: frames.hyperlink,
    markCursorLine: selection.markCursorLine,
    dispose: () => {
      selection.dispose();
      input.dispose();
      frames.dispose();
      native.ghostty_terminal_free(terminal);
    },
  };
}

function measure(cols: number, rows: number, cell: CellSize): Geometry {
  return {
    cols,
    rows,
    cell,
    pixels: {
      width: Math.max(1, Math.round(cell.width)),
      height: Math.max(1, Math.round(cell.height)),
    },
  };
}
