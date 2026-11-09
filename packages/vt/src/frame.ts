import {
  CellContentTag,
  CellWide,
  CursorStyle,
  PointTag,
  RenderStateData,
  RenderStateDirty,
  Result,
  ScreenRowData,
  RowCellsData,
  RowData,
  SgrUnderline,
  StyleColorTag,
} from "./constants.ts";
import { check } from "./memory.ts";
import { CellFlag, NO_COLOR, UnderlineStyle, createGrid } from "./screen.ts";

import type { Context } from "./context.ts";
import type { Cursor, CursorStyle as CursorKind, Frame, Rgb, Screen } from "./index.ts";
import type { Bits } from "./manifest.ts";

interface Style {
  readonly fg: Rgb;
  readonly bg: Rgb;
  readonly underlineColor: Rgb;
  readonly flags: number;
  readonly underline: number;
}

const defaultStyle: Style = {
  fg: NO_COLOR,
  bg: NO_COLOR,
  underlineColor: NO_COLOR,
  flags: 0,
  underline: UnderlineStyle.NONE,
};

const hashPrime = 16777619;

const cursorStyles = new Map<number, CursorKind>([
  [CursorStyle.BAR, "bar"],
  [CursorStyle.BLOCK, "block"],
  [CursorStyle.UNDERLINE, "underline"],
  [CursorStyle.BLOCK_HOLLOW, "block-hollow"],
]);

const underlines = new Map<number, number>([
  [SgrUnderline.NONE, UnderlineStyle.NONE],
  [SgrUnderline.SINGLE, UnderlineStyle.SINGLE],
  [SgrUnderline.DOUBLE, UnderlineStyle.DOUBLE],
  [SgrUnderline.CURLY, UnderlineStyle.CURLY],
  [SgrUnderline.DOTTED, UnderlineStyle.DOTTED],
  [SgrUnderline.DASHED, UnderlineStyle.DASHED],
]);

interface Frames {
  readonly frame: (full: boolean, live: boolean) => Frame;
  readonly screen: () => Screen;
  readonly capture: () => void;
  readonly hyperlink: (x: number, y: number) => string | null;
  readonly dispose: () => void;
}

export function createFrames(context: Context): Frames {
  const native = context.native;
  const layout = context.layout;
  const memory = context.memory;
  const state = memory.handle((slot) => native.ghostty_render_state_new(0, slot), "render state");

  const iterator = memory.handle(
    (slot) => native.ghostty_render_state_row_iterator_new(0, slot),
    "row iterator",
  );

  const cells = memory.handle(
    (slot) => native.ghostty_render_state_row_cells_new(0, slot),
    "row cells",
  );

  const out = memory.allocate(16);
  const cursor = memory.allocate(layout.cursor.size);
  const colors = memory.allocate(layout.colors.size);
  const rowSelection = memory.allocate(layout.rowSelection.size);
  const cellsView = memory.allocate(layout.cellsView.size);
  const style = memory.allocate(layout.style.size);
  const point = memory.allocate(layout.point.size);
  const gridRef = memory.allocate(layout.gridRef.size);
  const graphemes = memory.growable(64);
  const graphemeBuffer = memory.allocate(layout.buffer.size);
  const rowValue = memory.allocate(8);
  const uri = memory.growable(256);
  const decoder = new TextDecoder();
  const initial = context.geometry();
  let grid = createGrid(initial.cols, initial.rows);

  const readRgb = (view: DataView, pointer: number): Rgb =>
    (view.getUint8(pointer + layout.rgb.r) << 16) |
    (view.getUint8(pointer + layout.rgb.g) << 8) |
    view.getUint8(pointer + layout.rgb.b);

  const readColor = (view: DataView, pointer: number, palette: readonly Rgb[]): Rgb => {
    const tag = view.getUint8(pointer + layout.styleColor.tag);

    if (tag === StyleColorTag.PALETTE)
      return palette[view.getUint8(pointer + layout.styleColor.palette)] ?? NO_COLOR;

    if (tag === StyleColorTag.RGB) return readRgb(view, pointer + layout.styleColor.rgb);

    return NO_COLOR;
  };

  const readStyle = (x: number, palette: readonly Rgb[]): Style => {
    check(native.ghostty_render_state_row_cells_select(cells, x), "cell select");
    check(
      native.ghostty_render_state_row_cells_get(cells, RowCellsData.STYLE, style),
      "cell style",
    );
    const view = memory.view();
    const flags = view.getUint16(style + layout.style.flags, true);
    const flag = (field: Bits, value: number) => (bits(flags, 0, field) === 0 ? 0 : value);

    return {
      fg: readColor(view, style + layout.style.foreground, palette),
      bg: readColor(view, style + layout.style.background, palette),
      underlineColor: readColor(view, style + layout.style.underlineColor, palette),
      flags:
        flag(layout.style.bold, CellFlag.BOLD) |
        flag(layout.style.italic, CellFlag.ITALIC) |
        flag(layout.style.faint, CellFlag.FAINT) |
        flag(layout.style.inverse, CellFlag.INVERSE) |
        flag(layout.style.invisible, CellFlag.INVISIBLE) |
        flag(layout.style.strikethrough, CellFlag.STRIKETHROUGH) |
        flag(layout.style.overline, CellFlag.OVERLINE),
      underline: underlines.get(bits(flags, 0, layout.style.underline)) ?? UnderlineStyle.SINGLE,
    };
  };

  const readGrapheme = (x: number) => {
    check(native.ghostty_render_state_row_cells_select(cells, x), "cell select");

    const run = () => {
      const view = memory.view();

      view.setUint32(graphemeBuffer + layout.buffer.pointer, graphemes.pointer(), true);
      view.setUint32(graphemeBuffer + layout.buffer.capacity, graphemes.capacity(), true);

      return native.ghostty_render_state_row_cells_get(
        cells,
        RowCellsData.GRAPHEMES_UTF8,
        graphemeBuffer,
      );
    };

    const first = run();
    const length = () => memory.view().getUint32(graphemeBuffer + layout.buffer.length, true);

    if (first === Result.OUT_OF_SPACE) graphemes.reserve(length());
    check(first === Result.OUT_OF_SPACE ? run() : first, "graphemes");

    return memory.text(graphemes.pointer(), length());
  };

  const cellBackground = (low: number, high: number, tag: number, palette: readonly Rgb[]) => {
    if (tag === CellContentTag.BG_COLOR_PALETTE)
      return palette[bits(low, high, layout.cell.paletteIndex)] ?? NO_COLOR;

    if (tag !== CellContentTag.BG_COLOR_RGB) return undefined;

    return (
      (bits(low, high, layout.cell.red) << 16) |
      (bits(low, high, layout.cell.green) << 8) |
      bits(low, high, layout.cell.blue)
    );
  };

  const writeRow = (y: number, palette: readonly Rgb[]) => {
    memory.view().setUint32(out, cells, true);
    check(native.ghostty_render_state_row_get(iterator, RowData.CELLS, out), "row cells");
    check(native.ghostty_render_state_row_get(iterator, RowData.CELLS_RAW, cellsView), "raw cells");

    const selected = native.ghostty_render_state_row_get(
      iterator,
      RowData.SELECTION,
      memory.sized(rowSelection, layout.rowSelection),
    );

    if (selected !== Result.SUCCESS && selected !== Result.NO_VALUE)
      check(selected, "row selection");
    check(native.ghostty_render_state_row_get(iterator, RowData.RAW, rowValue), "raw row");
    check(
      native.ghostty_row_get(memory.view().getBigUint64(rowValue, true), ScreenRowData.WRAP, out),
      "row wrap",
    );
    const view = memory.view();
    const screen = grid.screen;
    const clusters = grid.clusters;
    const pointer = view.getUint32(cellsView + layout.cellsView.pointer, true);
    const count = Math.min(screen.cols, view.getUint32(cellsView + layout.cellsView.length, true));
    const raw = new DataView(memory.copy(pointer, count * layout.cell.size).buffer);
    const styles = new Map<number, Style>([[0, defaultStyle]]);
    const base = y * screen.cols;
    let hash = 2166136261;

    for (let x = 0; x < screen.cols; x += 1) {
      const index = base + x;
      const low = x < count ? raw.getUint32(x * layout.cell.size, true) : 0;
      const high = x < count ? raw.getUint32(x * layout.cell.size + 4, true) : 0;
      const tag = bits(low, high, layout.cell.contentTag);
      const wide = bits(low, high, layout.cell.wide);
      const styleId = bits(low, high, layout.cell.styleId);
      const background = cellBackground(low, high, tag, palette);
      const resolved = styles.get(styleId) ?? readStyle(x, palette);
      const width = wide === CellWide.WIDE ? 2 : wide === CellWide.SPACER_TAIL ? 0 : 1;
      const glyph = background === undefined ? bits(low, high, layout.cell.codepoint) : 0;
      const fill = background ?? resolved.bg;
      const grapheme = tag === CellContentTag.CODEPOINT_GRAPHEME;
      const flags = resolved.flags | (grapheme ? CellFlag.CLUSTER : 0);

      styles.set(styleId, resolved);
      screen.glyph[index] = glyph;
      screen.width[index] = width;
      screen.fg[index] = resolved.fg;
      screen.bg[index] = fill;
      screen.underlineColor[index] = resolved.underlineColor;
      screen.flags[index] = flags;
      screen.underline[index] = resolved.underline;
      hash = Math.imul(hash ^ glyph, hashPrime);
      hash = Math.imul(hash ^ (width | (flags << 2) | (resolved.underline << 10)), hashPrime);
      hash = Math.imul(hash ^ resolved.fg, hashPrime);
      hash = Math.imul(hash ^ fill, hashPrime);
      hash = Math.imul(hash ^ resolved.underlineColor, hashPrime);

      if (!grapheme) {
        clusters.delete(index);
        continue;
      }

      const cluster = readGrapheme(x);

      clusters.set(index, cluster);

      for (let unit = 0; unit < cluster.length; unit += 1)
        hash = Math.imul(hash ^ cluster.charCodeAt(unit), hashPrime);
    }

    const start =
      selected === Result.SUCCESS
        ? view.getUint16(rowSelection + layout.rowSelection.start, true)
        : -1;

    const end =
      selected === Result.SUCCESS
        ? view.getUint16(rowSelection + layout.rowSelection.end, true)
        : -1;

    screen.wrapped[y] = view.getUint8(out) === 0 ? 0 : 1;
    screen.selectionStart[y] = start;
    screen.selectionEnd[y] = end;
    hash = Math.imul(hash ^ start, hashPrime);
    screen.hash[y] = Math.imul(hash ^ end, hashPrime) >>> 0;
  };

  const readCursor = (): Cursor | null => {
    const view = memory.view();
    const visible = view.getUint8(cursor + layout.cursor.visible) !== 0;
    const inViewport = view.getUint8(cursor + layout.cursor.inViewport) !== 0;

    if (!visible || !inViewport) return null;
    const wideTail = view.getUint8(cursor + layout.cursor.wideTail) !== 0;
    const x = view.getUint16(cursor + layout.cursor.x, true) - (wideTail ? 1 : 0);
    const y = view.getUint16(cursor + layout.cursor.y, true);

    return {
      x,
      y,
      style: cursorStyles.get(view.getInt32(cursor + layout.cursor.style, true)) ?? "block",
      blinking: view.getUint8(cursor + layout.cursor.blinking) !== 0,
      wide: wideTail || viewportCellWide(x, y),
    };
  };

  const selectViewportCell = (x: number, y: number) => {
    const view = memory.view();

    view.setInt32(point + layout.point.tag, PointTag.VIEWPORT, true);
    view.setUint16(point + layout.point.x, x, true);
    view.setUint32(point + layout.point.y, y, true);

    return native.ghostty_terminal_grid_ref(context.terminal, point, gridRef) === Result.SUCCESS;
  };

  const viewportCellWide = (x: number, y: number) => {
    if (!selectViewportCell(x, y)) return false;
    check(native.ghostty_grid_ref_cell(gridRef, out), "cursor cell");
    const after = memory.view();

    return (
      bits(after.getUint32(out, true), after.getUint32(out + 4, true), layout.cell.wide) ===
      CellWide.WIDE
    );
  };

  const hyperlink = (x: number, y: number): string | null => {
    if (!selectViewportCell(x, y)) return null;
    const sized = native.ghostty_grid_ref_hyperlink_uri(gridRef, 0, 0, out);

    if (sized !== Result.OUT_OF_SPACE) {
      check(sized, "hyperlink length");

      return null;
    }

    const length = memory.view().getUint32(out, true);
    const buffer = uri.reserve(length);
    check(native.ghostty_grid_ref_hyperlink_uri(gridRef, buffer, length, out), "hyperlink");

    return decoder.decode(memory.copy(buffer, length));
  };

  const allRows = (palette: readonly Rgb[]) => {
    const dirty: number[] = [];

    while (native.ghostty_render_state_row_iterator_next(iterator)) {
      writeRow(dirty.length, palette);
      dirty.push(dirty.length);
    }

    return dirty;
  };

  const dirtyRows = (palette: readonly Rgb[]) => {
    const dirty: number[] = [];

    while (native.ghostty_render_state_row_iterator_next_dirty(iterator, out)) {
      const y = memory.view().getUint16(out, true);

      writeRow(y, palette);
      dirty.push(y);
    }

    return dirty;
  };

  const resizeGrid = () => {
    check(native.ghostty_render_state_get(state, RenderStateData.COLS, out), "columns");
    const cols = memory.view().getUint16(out, true);
    check(native.ghostty_render_state_get(state, RenderStateData.ROWS, out), "rows");
    const rows = memory.view().getUint16(out, true);

    if (cols === grid.screen.cols && rows === grid.screen.rows) return false;
    grid = createGrid(cols, rows);

    return true;
  };

  const capture = () =>
    check(native.ghostty_render_state_update(state, context.terminal), "render state update");

  return {
    capture,
    hyperlink,
    screen: () => grid.screen,
    frame: (full, live) => {
      if (live) capture();
      const resized = resizeGrid();
      check(native.ghostty_render_state_get(state, RenderStateData.DIRTY, out), "dirty state");

      const everything =
        full || resized || memory.view().getInt32(out, true) === RenderStateDirty.FULL;

      check(
        native.ghostty_render_state_get(
          state,
          RenderStateData.COLORS,
          memory.sized(colors, layout.colors),
        ),
        "colors",
      );
      check(
        native.ghostty_render_state_get(
          state,
          RenderStateData.CURSOR,
          memory.sized(cursor, layout.cursor),
        ),
        "cursor",
      );
      const view = memory.view();

      const palette = Array.from({ length: 256 }, (_, index) =>
        readRgb(view, colors + layout.colors.palette + index * layout.rgb.size),
      );

      const foreground = readRgb(view, colors + layout.colors.foreground);
      const background = readRgb(view, colors + layout.colors.background);

      const cursorColor =
        view.getUint8(colors + layout.colors.cursorHasValue) !== 0
          ? readRgb(view, colors + layout.colors.cursor)
          : null;

      view.setUint32(out, iterator, true);
      check(
        native.ghostty_render_state_get(state, RenderStateData.ROW_ITERATOR, out),
        "row iterator",
      );
      const dirty = everything ? allRows(palette) : dirtyRows(palette);

      check(native.ghostty_render_state_clean(state), "render state clean");

      return {
        full: everything,
        held: !live,
        dirty,
        cursor: readCursor(),
        foreground,
        background,
        cursorColor,
      };
    },
    dispose: () => {
      native.ghostty_render_state_row_cells_free(cells);
      native.ghostty_render_state_row_iterator_free(iterator);
      native.ghostty_render_state_free(state);
    },
  };
}

function bits(low: number, high: number, field: Bits) {
  const mask = field.width >= 32 ? 0xffffffff : (1 << field.width) - 1;

  if (field.lsb >= 32) return (high >>> (field.lsb - 32)) & mask;

  if (field.lsb + field.width <= 32) return (low >>> field.lsb) & mask;

  return ((low >>> field.lsb) | (high << (32 - field.lsb))) & mask;
}
