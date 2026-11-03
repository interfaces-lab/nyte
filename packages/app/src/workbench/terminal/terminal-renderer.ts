import type { Cell, Cursor, CursorStyle, Frame, Rgb, Row } from "@nyte-ai/vt";
import type { TerminalFont } from "./terminal-appearance.ts";
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
}

export interface Renderer {
  readonly canvas: HTMLCanvasElement;
  setFont(font: TerminalFont, metrics: CellMetrics): void;
  resize(width: number, height: number): void;
  release(): void;
  paint(frame: Frame, scene: Scene): void;
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

export function createRenderer(canvas: HTMLCanvasElement): Renderer {
  const context = canvas.getContext("2d", { alpha: false });

  if (context === null) throw new Error("Canvas rendering is unavailable");
  let font: TerminalFont = { family: "monospace", size: 13 };
  let metrics: CellMetrics | null = null;
  let rows: (Row | undefined)[] = [];
  let currentFont = "";
  let foreground = -1;
  let background = -1;
  let cursorRow: number | null = null;

  const setFill = (color: Rgb): void => {
    context.fillStyle = css(color);
  };

  const applyFont = (cell: Cell, m: CellMetrics): void => {
    const next = fontString(font, m.ratio, cell.bold, cell.italic);

    if (next === currentFont) return;
    currentFont = next;
    context.font = next;
  };

  const drawText = (cell: Cell, x: number, top: number, color: Rgb, m: CellMetrics): void => {
    if (cell.invisible || cell.text === "" || cell.text === " ") return;
    setFill(color);
    context.globalAlpha = cell.faint ? 0.5 : 1;

    const box = {
      x,
      y: top,
      width: m.width * Math.max(1, cell.width),
      height: m.height,
      thickness: m.thickness,
    };

    if (!drawGlyph(context, cell.text, box)) {
      applyFont(cell, m);
      context.fillText(cell.text, x, top + m.baseline);
    }

    context.globalAlpha = 1;
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

  const paintRow = (y: number, frame: Frame, scene: Scene, m: CellMetrics): void => {
    const top = y * m.height;
    const row = rows[y];
    context.save();
    context.beginPath();
    context.rect(0, top, canvas.width, m.height);
    context.clip();
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

    context.restore();
    currentFont = "";
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
      currentFont = "";
    },
    resize(width, height) {
      const ratio = metrics?.ratio ?? 1;
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = String(width / ratio) + "px";
      canvas.style.height = String(height / ratio) + "px";
      currentFont = "";
      rows = [];
      cursorRow = null;
    },
    release() {
      canvas.width = 0;
      canvas.height = 0;
      currentFont = "";
      rows = [];
      cursorRow = null;
    },
    paint(frame, scene) {
      const m = metrics;

      if (m === null || canvas.width === 0) return;
      context.textBaseline = "alphabetic";
      context.textAlign = "left";
      const cursor = scene.cursor === "hidden" ? null : frame.cursor;

      const all = frame.full || frame.foreground !== foreground || frame.background !== background;

      if (frame.full) rows = [];
      frame.rows.forEach((row) => {
        rows[row.y] = row;
      });
      foreground = frame.foreground;
      background = frame.background;
      const count = Math.ceil(canvas.height / m.height);

      const painted = all
        ? Array.from({ length: count }, (_, y) => y)
        : [
            ...new Set([
              ...frame.rows.map((row) => row.y),
              ...(cursorRow === null ? [] : [cursorRow]),
              ...(cursor === null ? [] : [cursor.y]),
            ]),
          ];

      if (all) {
        setFill(frame.background);
        context.fillRect(0, 0, canvas.width, canvas.height);
      }

      painted.forEach((y) => paintRow(y, frame, scene, m));

      if (cursor !== null) drawCursor(cursor, frame, scene, m);
      cursorRow = cursor?.y ?? null;
    },
  };
}
