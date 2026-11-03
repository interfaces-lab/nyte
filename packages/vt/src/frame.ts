import {
  CellContentTag,
  CellWide,
  CursorVisualStyle,
  PointTag,
  RenderStateData,
  RenderStateDirty,
  Result,
  RowCellsData,
  RowData,
  SgrUnderline,
  StyleColorTag,
} from "./constants.ts";
import { check } from "./memory.ts";

import type { Context } from "./context.ts";
import type { Cell, Cursor, CursorStyle, Frame, Rgb, Row, Underline } from "./index.ts";
import type { Bits } from "./manifest.ts";

type Style = Omit<Cell, "text" | "width">;

const defaultStyle: Style = {
  fg: null,
  bg: null,
  bold: false,
  italic: false,
  faint: false,
  blink: false,
  inverse: false,
  invisible: false,
  strikethrough: false,
  overline: false,
  underline: "none",
  underlineColor: null,
};

const blank: Cell = Object.freeze({ ...defaultStyle, text: "", width: 1 });

const cursorStyles = new Map<number, CursorStyle>([
  [CursorVisualStyle.BAR, "bar"],
  [CursorVisualStyle.BLOCK, "block"],
  [CursorVisualStyle.UNDERLINE, "underline"],
  [CursorVisualStyle.BLOCK_HOLLOW, "block-hollow"],
]);

const underlines = new Map<number, Underline>([
  [SgrUnderline.NONE, "none"],
  [SgrUnderline.SINGLE, "single"],
  [SgrUnderline.DOUBLE, "double"],
  [SgrUnderline.CURLY, "curly"],
  [SgrUnderline.DOTTED, "dotted"],
  [SgrUnderline.DASHED, "dashed"],
]);

interface Frames {
  readonly frame: (full: boolean, live: boolean) => Frame;
  readonly capture: () => void;
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

  const readRgb = (view: DataView, pointer: number): Rgb =>
    (view.getUint8(pointer + layout.rgb.r) << 16) |
    (view.getUint8(pointer + layout.rgb.g) << 8) |
    view.getUint8(pointer + layout.rgb.b);

  const readColor = (view: DataView, pointer: number, palette: readonly Rgb[]): Rgb | null => {
    const tag = view.getInt32(pointer + layout.styleColor.tag, true);

    if (tag === StyleColorTag.PALETTE)
      return palette[view.getUint8(pointer + layout.styleColor.palette)] ?? null;

    if (tag === StyleColorTag.RGB) return readRgb(view, pointer + layout.styleColor.rgb);

    return null;
  };

  const readStyle = (x: number, palette: readonly Rgb[]): Style => {
    check(native.ghostty_render_state_row_cells_select(cells, x), "cell select");
    check(
      native.ghostty_render_state_row_cells_get(
        cells,
        RowCellsData.STYLE,
        memory.sized(style, layout.style),
      ),
      "cell style",
    );
    const view = memory.view();
    const flag = (offset: number) => view.getUint8(style + offset) !== 0;

    return {
      fg: readColor(view, style + layout.style.foreground, palette),
      bg: readColor(view, style + layout.style.background, palette),
      bold: flag(layout.style.bold),
      italic: flag(layout.style.italic),
      faint: flag(layout.style.faint),
      blink: flag(layout.style.blink),
      inverse: flag(layout.style.inverse),
      invisible: flag(layout.style.invisible),
      strikethrough: flag(layout.style.strikethrough),
      overline: flag(layout.style.overline),
      underline: underlines.get(view.getInt32(style + layout.style.underline, true)) ?? "single",
      underlineColor: readColor(view, style + layout.style.underlineColor, palette),
    };
  };

  const readGrapheme = (x: number) => {
    check(native.ghostty_render_state_row_cells_select(cells, x), "cell select");
    check(
      native.ghostty_render_state_row_cells_get(cells, RowCellsData.GRAPHEMES_LEN, out),
      "grapheme length",
    );
    const length = memory.view().getUint32(out, true);
    const buffer = graphemes.reserve(length * 4);

    check(
      native.ghostty_render_state_row_cells_get(cells, RowCellsData.GRAPHEMES_BUF, buffer),
      "graphemes",
    );
    const view = memory.view();

    return String.fromCodePoint(
      ...Array.from({ length }, (_, index) => view.getUint32(buffer + index * 4, true)),
    );
  };

  const cellBackground = (low: number, high: number, tag: number, palette: readonly Rgb[]) => {
    if (tag === CellContentTag.BG_COLOR_PALETTE)
      return palette[bits(low, high, layout.cell.paletteIndex)] ?? null;

    if (tag !== CellContentTag.BG_COLOR_RGB) return undefined;

    return (
      (bits(low, high, layout.cell.red) << 16) |
      (bits(low, high, layout.cell.green) << 8) |
      bits(low, high, layout.cell.blue)
    );
  };

  const readRow = (y: number, palette: readonly Rgb[]): Row => {
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
    const view = memory.view();
    const pointer = view.getUint32(cellsView + layout.cellsView.pointer, true);
    const count = view.getUint32(cellsView + layout.cellsView.length, true);
    const raw = new DataView(memory.copy(pointer, count * layout.cell.size).buffer);
    const styles = new Map<number, Style>([[0, defaultStyle]]);

    return {
      y,
      selection:
        selected === Result.SUCCESS
          ? [
              view.getUint16(rowSelection + layout.rowSelection.start, true),
              view.getUint16(rowSelection + layout.rowSelection.end, true),
            ]
          : null,
      cells: Array.from({ length: count }, (_, x): Cell => {
        const low = raw.getUint32(x * layout.cell.size, true);
        const high = raw.getUint32(x * layout.cell.size + 4, true);
        const tag = bits(low, high, layout.cell.contentTag);
        const wide = bits(low, high, layout.cell.wide);
        const styleId = bits(low, high, layout.cell.styleId);
        const background = cellBackground(low, high, tag, palette);
        const codepoint = background === undefined ? bits(low, high, layout.cell.codepoint) : 0;
        const width = wide === CellWide.WIDE ? 2 : wide === CellWide.SPACER_TAIL ? 0 : 1;

        if (styleId === 0 && codepoint === 0 && background === undefined && width === 1)
          return blank;
        const resolved = styles.get(styleId) ?? readStyle(x, palette);

        styles.set(styleId, resolved);

        return {
          ...resolved,
          text:
            tag === CellContentTag.CODEPOINT_GRAPHEME
              ? readGrapheme(x)
              : codepoint === 0
                ? ""
                : String.fromCodePoint(codepoint),
          width,
          bg: background ?? resolved.bg,
        };
      }),
    };
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

  const viewportCellWide = (x: number, y: number) => {
    const view = memory.view();

    view.setInt32(point + layout.point.tag, PointTag.VIEWPORT, true);
    view.setUint16(point + layout.point.x, x, true);
    view.setUint32(point + layout.point.y, y, true);

    if (
      native.ghostty_terminal_grid_ref(
        context.terminal,
        point,
        memory.sized(gridRef, layout.gridRef),
      ) !== Result.SUCCESS
    )
      return false;
    check(native.ghostty_grid_ref_cell(gridRef, out), "cursor cell");
    const after = memory.view();

    return (
      bits(after.getUint32(out, true), after.getUint32(out + 4, true), layout.cell.wide) ===
      CellWide.WIDE
    );
  };

  const allRows = (palette: readonly Rgb[]) => {
    const rows: Row[] = [];

    while (native.ghostty_render_state_row_iterator_next(iterator))
      rows.push(readRow(rows.length, palette));

    return rows;
  };

  const dirtyRows = (palette: readonly Rgb[]) => {
    const rows: Row[] = [];

    while (native.ghostty_render_state_row_iterator_next_dirty(iterator, out)) {
      rows.push(readRow(memory.view().getUint16(out, true), palette));
    }

    return rows;
  };

  const capture = () =>
    check(native.ghostty_render_state_update(state, context.terminal), "render state update");

  return {
    capture,
    frame: (full, live) => {
      if (live) capture();
      check(native.ghostty_render_state_get(state, RenderStateData.DIRTY, out), "dirty state");
      const everything = full || memory.view().getInt32(out, true) === RenderStateDirty.FULL;

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
      const rows = everything ? allRows(palette) : dirtyRows(palette);

      check(native.ghostty_render_state_clean(state), "render state clean");

      return {
        full: everything,
        held: !live,
        rows,
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
