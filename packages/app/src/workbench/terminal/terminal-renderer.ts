import type { Cell, Cursor, CursorStyle, Frame, Rgb, Row } from "@nyte-ai/vt";
import type { TerminalFont } from "./terminal-appearance.ts";
import type { TerminalLink } from "./terminal-links.ts";
import { drawGlyph } from "./terminal-glyphs.ts";

export interface CellMetrics {
  readonly ratio: number;
  readonly width: number;
  readonly height: number;
  readonly baseline: number;
  readonly thickness: number;
  readonly underline: number;
  readonly strike: number;
}

export interface Scene {
  readonly cursor: "focused" | "unfocused" | "hidden";
  readonly selection: Rgb;
  /** The link under the pointer while the open-link modifier is held, drawn underlined. */
  readonly link: TerminalLink | null;
}

export interface Renderer {
  readonly canvas: HTMLCanvasElement;
  setFont(font: TerminalFont, metrics: CellMetrics): void;
  resize(width: number, height: number): void;
  release(): void;
  paint(frame: Frame, scene: Scene): void;
  /** The row last painted at viewport row `y`. */
  row(y: number): Row | undefined;
}

function fontString(font: TerminalFont, ratio: number, bold: boolean, italic: boolean): string {
  return (
    (italic ? "italic " : "") +
    (bold ? "bold " : "") +
    String(font.size * ratio) +
    "px " +
    font.family
  );
}

export function measureCell(font: TerminalFont, ratio: number): CellMetrics {
  const context = document.createElement("canvas").getContext("2d");

  if (context === null) throw new Error("Canvas rendering is unavailable");
  const name = fontString(font, ratio, false, false);
  void document.fonts.load(name);
  context.font = name;
  const glyph = context.measureText("M");
  const ascent = glyph.fontBoundingBoxAscent;
  const descent = glyph.fontBoundingBoxDescent;
  const width = Math.max(1, Math.round(glyph.width));
  const height = Math.max(1, Math.ceil(ascent + descent));
  const baseline = Math.round((height - ascent - descent) / 2 + ascent);
  const thickness = Math.max(1, Math.round((font.size * ratio) / 15));
  const below = height - baseline;
  const xHeight = context.measureText("x").actualBoundingBoxAscent;

  return {
    ratio,
    width,
    height,
    baseline,
    thickness,
    underline: Math.min(
      height - thickness,
      baseline + Math.max(thickness, Math.round((below - thickness) / 2)),
    ),
    strike: baseline - Math.round(xHeight / 2) - Math.floor(thickness / 2),
  };
}

function css(color: Rgb): string {
  return "#" + color.toString(16).padStart(6, "0");
}

/** Device pixels on each side of the atlas edge. 1024 holds a few thousand glyphs at 2x. */
const ATLAS_SIZE = 1024;

interface Slot {
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

const UNDERLINE_CODES = { none: 0, single: 1, double: 2, curly: 3, dotted: 4, dashed: 5 } as const;

/** A hash of everything a row draws, so a row that only moved can be recognised by value. */
function signature(row: Row): number {
  let hash = 2166136261;

  for (const cell of row.cells) {
    for (let index = 0; index < cell.text.length; index += 1)
      hash = Math.imul(hash ^ cell.text.charCodeAt(index), 16777619);
    hash = Math.imul(hash ^ (cell.fg ?? -1), 16777619);
    hash = Math.imul(hash ^ (cell.bg ?? -1), 16777619);
    hash = Math.imul(hash ^ (cell.underlineColor ?? -1), 16777619);
    hash = Math.imul(
      hash ^
        (Number(cell.bold) |
          (Number(cell.italic) << 1) |
          (Number(cell.faint) << 2) |
          (Number(cell.inverse) << 3) |
          (Number(cell.invisible) << 4) |
          (Number(cell.strikethrough) << 5) |
          (Number(cell.overline) << 6) |
          (cell.width << 7) |
          (UNDERLINE_CODES[cell.underline] << 9)),
      16777619,
    );
  }

  hash = Math.imul(hash ^ (row.selection?.[0] ?? -1), 16777619);

  return Math.imul(hash ^ (row.selection?.[1] ?? -1), 16777619);
}

/**
 * How many rows the content moved up (negative: down) between two screens, found from a row whose
 * signature appears once in `previous` and confirmed by at least half the rows lining up; 0 when
 * nothing moved or the screens don't line up.
 */
function findShift(previous: readonly number[], next: readonly number[]): number {
  const counts = new Map<number, number>();
  previous.forEach((value) => counts.set(value, (counts.get(value) ?? 0) + 1));

  const unique = new Map(
    previous.flatMap((value, y) => (counts.get(value) === 1 ? [[value, y] as const] : [])),
  );

  const anchor = next.findIndex((value, y) => unique.has(value) && unique.get(value) !== y);

  if (anchor === -1) return 0;
  const shift = (unique.get(next[anchor] ?? 0) ?? anchor) - anchor;
  const aligned = next.filter((value, y) => previous[y + shift] === value).length;

  return aligned * 2 >= next.length ? shift : 0;
}

/** Frames between atlas resets, so output in more colours than it holds draws direct instead of thrashing. */
const ATLAS_RESET_FRAMES = 120;

/** Glyphs added to the atlas per frame; past it they draw directly, so a screen of new glyphs costs one direct paint, not two. */
const ATLAS_ADDS_PER_FRAME = 256;

/**
 * Each glyph in a colour and style, rasterized once and copied with `drawImage`, which costs far
 * less than shaping it again with `fillText` every frame. When the atlas fills it starts over, at
 * most once every `ATLAS_RESET_FRAMES`; until then, and past `ATLAS_ADDS_PER_FRAME` in a frame,
 * glyphs that miss draw directly. `startFrame` sizes a released atlas again and returns true when
 * that reset its context's fill and font.
 */
function createAtlas() {
  const canvas = document.createElement("canvas");
  canvas.width = 0;
  canvas.height = 0;
  const context = canvas.getContext("2d");

  if (context === null) throw new Error("Canvas rendering is unavailable");
  const slots = new Map<string, Slot>();
  let shelfX = 0;
  let shelfY = 0;
  let framesSinceReset = ATLAS_RESET_FRAMES;
  let addsThisFrame = 0;

  const clear = (): void => {
    slots.clear();
    shelfX = 0;
    shelfY = 0;
    context.clearRect(0, 0, canvas.width, canvas.height);
  };

  const place = (width: number, height: number): Slot | null => {
    if (shelfX + width > ATLAS_SIZE) {
      shelfX = 0;
      shelfY += height;
    }

    if (shelfY + height > ATLAS_SIZE) {
      if (framesSinceReset < ATLAS_RESET_FRAMES) return null;
      framesSinceReset = 0;
      clear();
    }

    const slot = { x: shelfX, y: shelfY, width };
    shelfX += width;

    return slot;
  };

  return {
    canvas,
    context,
    clear,
    release() {
      slots.clear();
      canvas.width = 0;
      canvas.height = 0;
    },
    startFrame(): boolean {
      framesSinceReset += 1;
      addsThisFrame = 0;

      if (canvas.width !== 0) return false;
      canvas.width = ATLAS_SIZE;
      canvas.height = ATLAS_SIZE;
      context.textBaseline = "alphabetic";
      context.textAlign = "left";
      shelfX = 0;
      shelfY = 0;

      return true;
    },
    find: (key: string) => slots.get(key),
    add(key: string, width: number, height: number): Slot | null {
      if (addsThisFrame >= ATLAS_ADDS_PER_FRAME) return null;
      addsThisFrame += 1;
      const slot = place(width, height);

      if (slot !== null) slots.set(key, slot);

      return slot;
    },
  };
}

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const context = canvas.getContext("2d", { alpha: false });

  if (context === null) throw new Error("Canvas rendering is unavailable");
  let font: TerminalFont = { family: "monospace", size: 13 };
  let metrics: CellMetrics | null = null;
  let rows: (Row | undefined)[] = [];
  let foreground = -1;
  let background = -1;
  let cursorRow: number | null = null;
  let signatures: number[] = [];
  let linked: TerminalLink | null = null;
  const atlas = createAtlas();
  const screen = { context, fill: -1, font: "" };
  const glyphs = { context: atlas.context, fill: -1, font: "" };

  const setFill = (color: Rgb): void => {
    if (color === screen.fill) return;
    screen.fill = color;
    context.fillStyle = css(color);
  };

  const prepare = (target: typeof screen, cell: Cell, color: Rgb, m: CellMetrics): void => {
    if (target.fill !== color) {
      target.fill = color;
      target.context.fillStyle = css(color);
    }

    const name = fontString(font, m.ratio, cell.bold, cell.italic);

    if (target.font === name) return;
    target.font = name;
    target.context.font = name;
  };

  const rasterize = (
    target: CanvasRenderingContext2D,
    cell: Cell,
    x: number,
    top: number,
    m: CellMetrics,
  ): void => {
    if (cell.faint) target.globalAlpha = 0.5;

    const box = {
      x,
      y: top,
      width: m.width * Math.max(1, cell.width),
      height: m.height,
      thickness: m.thickness,
    };

    if (!drawGlyph(target, cell.text, box)) target.fillText(cell.text, x, top + m.baseline);

    if (cell.faint) target.globalAlpha = 1;
  };

  const drawText = (cell: Cell, x: number, top: number, color: Rgb, m: CellMetrics): void => {
    if (cell.invisible || cell.text === "" || cell.text === " ") return;
    const key = `${cell.text}\u0000${String(color)}\u0000${cell.bold ? "b" : ""}${cell.italic ? "i" : ""}${cell.faint ? "f" : ""}`;
    const pad = Math.ceil(m.width / 2);
    const found = atlas.find(key);

    if (found !== undefined) {
      context.drawImage(
        atlas.canvas,
        found.x,
        found.y,
        found.width,
        m.height,
        x - pad,
        top,
        found.width,
        m.height,
      );

      return;
    }

    const width = m.width * Math.max(1, cell.width) + 2 * pad;
    const slot = atlas.add(key, width, m.height);

    if (slot === null) {
      prepare(screen, cell, color, m);
      rasterize(context, cell, x, top, m);

      return;
    }

    prepare(glyphs, cell, color, m);
    atlas.context.save();
    atlas.context.beginPath();
    atlas.context.rect(slot.x, slot.y, width, m.height);
    atlas.context.clip();
    rasterize(atlas.context, cell, slot.x + pad, slot.y, m);
    atlas.context.restore();
    context.drawImage(atlas.canvas, slot.x, slot.y, width, m.height, x - pad, top, width, m.height);
  };

  const drawUnderline = (
    cell: Cell,
    x: number,
    top: number,
    width: number,
    color: Rgb,
    m: CellMetrics,
  ): void => {
    const t = m.thickness;
    const y = top + m.underline;
    setFill(cell.underlineColor ?? color);

    if (cell.underline === "single") context.fillRect(x, y, width, t);

    if (cell.underline === "double") {
      const lower = Math.min(top + m.height - t, y + 2 * t);
      context.fillRect(x, lower - 2 * t, width, t);
      context.fillRect(x, lower, width, t);
    }

    if (cell.underline === "dotted") {
      for (let dot = 0; dot < width; dot += 2 * t) context.fillRect(x + dot, y, t, t);
    }

    if (cell.underline === "dashed") {
      for (let dash = 0; dash < width; dash += m.width)
        context.fillRect(x + dash + Math.floor(m.width / 4), y, Math.ceil(m.width / 2), t);
    }

    if (cell.underline === "curly") {
      const amplitude = Math.max(1, t);
      const middle = Math.min(y, top + m.height - amplitude - t);
      context.strokeStyle = context.fillStyle;
      context.lineWidth = t;
      context.beginPath();
      context.moveTo(x, middle);

      for (let step = 1; step <= width; step += 1)
        context.lineTo(x + step, middle + amplitude * Math.sin((step / m.width) * 2 * Math.PI));
      context.stroke();
    }
  };

  const drawDecorations = (
    cell: Cell,
    x: number,
    top: number,
    color: Rgb,
    m: CellMetrics,
  ): void => {
    if (cell.invisible) return;
    const width = m.width * Math.max(1, cell.width);

    if (cell.underline !== "none") drawUnderline(cell, x, top, width, color, m);
    setFill(color);

    if (cell.strikethrough) context.fillRect(x, top + m.strike, width, m.thickness);

    if (cell.overline) context.fillRect(x, top, width, m.thickness);
  };

  const cellColors = (row: Row, cell: Cell, column: number, frame: Frame, scene: Scene) => {
    const selected =
      row.selection !== null && column >= row.selection[0] && column <= row.selection[1];

    return {
      foreground: cell.inverse ? (cell.bg ?? frame.background) : (cell.fg ?? frame.foreground),
      background: selected
        ? scene.selection
        : cell.inverse
          ? (cell.fg ?? frame.foreground)
          : cell.bg,
    };
  };

  const colorAt = (row: Row | undefined, column: number, frame: Frame, scene: Scene): Rgb => {
    const cell = row?.cells[column];

    return row === undefined || cell === undefined
      ? frame.foreground
      : cellColors(row, cell, column, frame, scene).foreground;
  };

  const paintRow = (y: number, frame: Frame, scene: Scene, m: CellMetrics): void => {
    const top = y * m.height;
    const row = rows[y];
    setFill(frame.background);
    context.fillRect(0, top, canvas.width, m.height);

    if (row !== undefined) {
      const colors = row.cells.map((cell, column) => cellColors(row, cell, column, frame, scene));
      let start = 0;

      for (let column = 1; column <= row.cells.length; column += 1) {
        const run = colors[start]?.background ?? null;

        if (column < row.cells.length && colors[column]?.background === run) continue;

        if (run !== null) {
          setFill(run);
          context.fillRect(start * m.width, top, (column - start) * m.width, m.height);
        }

        start = column;
      }

      row.cells.forEach((cell, column) => {
        const color = colors[column]?.foreground ?? frame.foreground;

        if (cell.width === 0) return;
        drawText(cell, column * m.width, top, color, m);
        drawDecorations(cell, column * m.width, top, color, m);
      });
    }

    const link = scene.link;

    if (link === null || y < link.start.row || y > link.end.row) return;
    const first = y === link.start.row ? link.start.column : 0;
    const last = y === link.end.row ? link.end.column : (row?.cells.length ?? 1) - 1;
    setFill(colorAt(row, first, frame, scene));
    context.fillRect(first * m.width, top + m.underline, (last - first + 1) * m.width, m.thickness);
  };

  const drawCursor = (cursor: Cursor, frame: Frame, scene: Scene, m: CellMetrics): void => {
    const x = cursor.x * m.width;
    const top = cursor.y * m.height;
    const width = m.width * (cursor.wide ? 2 : 1);
    const t = m.thickness;
    const style: CursorStyle = scene.cursor === "focused" ? cursor.style : "block-hollow";
    const color = frame.cursorColor ?? frame.foreground;
    setFill(color);

    if (style === "bar") context.fillRect(x, top, Math.max(1, Math.round(m.ratio * 1.5)), m.height);

    if (style === "underline") context.fillRect(x, top + m.height - t, width, t);

    if (style === "block-hollow") {
      context.fillRect(x, top, width, t);
      context.fillRect(x, top + m.height - t, width, t);
      context.fillRect(x, top, t, m.height);
      context.fillRect(x + width - t, top, t, m.height);
    }

    if (style !== "block") return;
    context.fillRect(x, top, width, m.height);
    const cell = rows[cursor.y]?.cells[cursor.x];

    if (cell !== undefined) drawText(cell, x, top, cell.bg ?? frame.background, m);
  };

  return {
    canvas,
    setFont(next, nextMetrics) {
      font = next;
      metrics = nextMetrics;
      signatures = [];
      atlas.clear();
    },
    resize(width, height) {
      const ratio = metrics?.ratio ?? 1;
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = String(width / ratio) + "px";
      canvas.style.height = String(height / ratio) + "px";
      screen.fill = -1;
      screen.font = "";
      rows = [];
      signatures = [];
      cursorRow = null;
    },
    release() {
      canvas.width = 0;
      canvas.height = 0;
      signatures = [];
      screen.fill = -1;
      screen.font = "";
      atlas.release();
      rows = [];
      cursorRow = null;
    },
    row: (y) => rows[y],
    paint(frame, scene) {
      const m = metrics;

      if (m === null || canvas.width === 0) return;
      context.textBaseline = "alphabetic";
      context.textAlign = "left";

      if (atlas.startFrame()) {
        glyphs.fill = -1;
        glyphs.font = "";
      }

      const cursor = scene.cursor === "hidden" ? null : frame.cursor;

      const recolored = frame.foreground !== foreground || frame.background !== background;
      const count = Math.ceil(canvas.height / m.height);
      const lines = Math.floor(canvas.height / m.height);

      if (frame.full) rows = [];
      frame.rows.forEach((row) => {
        rows[row.y] = row;
      });
      foreground = frame.foreground;
      background = frame.background;
      const next = [...signatures];
      frame.rows.forEach((row) => {
        next[row.y] = signature(row);
      });

      const whole = frame.rows.length >= lines && signatures.length >= lines && !recolored;
      const shift = whole ? findShift(signatures.slice(0, lines), next.slice(0, lines)) : 0;

      if (shift !== 0) {
        const kept = (lines - Math.abs(shift)) * m.height;
        const from = Math.max(0, shift) * m.height;
        const to = Math.max(0, -shift) * m.height;
        context.drawImage(canvas, 0, from, canvas.width, kept, 0, to, canvas.width, kept);
      }

      const moved = signatures.map((_, y) => signatures[y + shift]);

      const painted =
        (frame.full || recolored) && shift === 0
          ? Array.from({ length: count }, (_, y) => y)
          : [
              ...new Set([
                ...frame.rows
                  .map((row) => row.y)
                  .filter((y) => shift === 0 || next[y] === undefined || moved[y] !== next[y]),
                ...(shift === 0
                  ? []
                  : Array.from({ length: count - lines }, (_, index) => lines + index)),
                ...(cursorRow === null ? [] : [cursorRow - shift]).filter(
                  (y) => y >= 0 && y < count,
                ),
                ...(cursor === null ? [] : [cursor.y]),
                ...(linked === scene.link ? [] : [linked, scene.link]).flatMap((link) =>
                  link === null
                    ? []
                    : Array.from(
                        { length: link.end.row - link.start.row + 1 },
                        (_, offset) => link.start.row + offset,
                      ).filter((y) => y >= 0 && y < count),
                ),
              ]),
            ];

      if ((frame.full || recolored) && shift === 0) {
        setFill(frame.background);
        context.fillRect(0, 0, canvas.width, canvas.height);
      }

      painted.forEach((y) => paintRow(y, frame, scene, m));
      signatures = next;
      linked = scene.link;

      if (cursor !== null) drawCursor(cursor, frame, scene, m);
      cursorRow = cursor?.y ?? null;
    },
  };
}
