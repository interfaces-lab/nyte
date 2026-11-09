import { CellFlag, NO_COLOR, UnderlineStyle } from "@nyte-ai/vt";
import type { Cursor, CursorStyle, Frame, Rgb, Screen } from "@nyte-ai/vt";
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
  readonly link: TerminalLink | null;
}

export interface Renderer {
  readonly canvas: HTMLCanvasElement;
  setFont(font: TerminalFont, metrics: CellMetrics): void;
  resize(width: number, height: number): void;
  release(): void;
  paint(frame: Frame, screen: Screen, scene: Scene): void;
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

const ATLAS_SIZE = 1024;

interface Slot {
  readonly x: number;
  readonly y: number;
  readonly width: number;
}

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

const ATLAS_RESET_FRAMES = 120;

const ATLAS_ADDS_PER_FRAME = 256;

function createAtlas() {
  const canvas = document.createElement("canvas");
  canvas.width = 0;
  canvas.height = 0;
  const context = canvas.getContext("2d");

  if (context === null) throw new Error("Canvas rendering is unavailable");
  const slots = new Map<number | string, Slot>();
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
    find: (key: number | string) => slots.get(key),
    add(key: number | string, width: number, height: number): Slot | null {
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
  let foreground = -1;
  let background = -1;
  let cursorRow: number | null = null;
  let painted: number[] = [];
  let linked: TerminalLink | null = null;
  const atlas = createAtlas();
  const onscreen = { context, fill: -1, font: "" };
  const glyphs = { context: atlas.context, fill: -1, font: "" };

  const setFill = (color: Rgb): void => {
    if (color === onscreen.fill) return;
    onscreen.fill = color;
    context.fillStyle = css(color);
  };

  const prepare = (target: typeof onscreen, flags: number, color: Rgb, m: CellMetrics): void => {
    if (target.fill !== color) {
      target.fill = color;
      target.context.fillStyle = css(color);
    }

    const name = fontString(
      font,
      m.ratio,
      (flags & CellFlag.BOLD) !== 0,
      (flags & CellFlag.ITALIC) !== 0,
    );

    if (target.font === name) return;
    target.font = name;
    target.context.font = name;
  };

  const rasterize = (
    target: CanvasRenderingContext2D,
    text: string,
    columns: number,
    flags: number,
    x: number,
    top: number,
    m: CellMetrics,
  ): void => {
    const faint = (flags & CellFlag.FAINT) !== 0;

    if (faint) target.globalAlpha = 0.5;

    const box = {
      x,
      y: top,
      width: m.width * Math.max(1, columns),
      height: m.height,
      thickness: m.thickness,
    };

    if (!drawGlyph(target, text, box)) target.fillText(text, x, top + m.baseline);

    if (faint) target.globalAlpha = 1;
  };

  const drawText = (
    screen: Screen,
    index: number,
    x: number,
    top: number,
    color: Rgb,
    m: CellMetrics,
  ): void => {
    const flags = screen.flags[index] ?? 0;
    const glyph = screen.glyph[index] ?? 0;
    const cluster = (flags & CellFlag.CLUSTER) !== 0;

    if ((flags & CellFlag.INVISIBLE) !== 0 || glyph === 0 || (glyph === 32 && !cluster)) return;
    const face = flags & (CellFlag.BOLD | CellFlag.ITALIC | CellFlag.FAINT);

    const key = cluster
      ? `${screen.text(index)}\u0000${String(color)}\u0000${String(face)}`
      : (glyph * 8 + face) * 0x1000000 + color;

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

    const text = screen.text(index);
    const columns = screen.width[index] ?? 1;
    const width = m.width * Math.max(1, columns) + 2 * pad;
    const slot = atlas.add(key, width, m.height);

    if (slot === null) {
      prepare(onscreen, flags, color, m);
      rasterize(context, text, columns, flags, x, top, m);

      return;
    }

    prepare(glyphs, flags, color, m);
    atlas.context.save();
    atlas.context.beginPath();
    atlas.context.rect(slot.x, slot.y, width, m.height);
    atlas.context.clip();
    rasterize(atlas.context, text, columns, flags, slot.x + pad, slot.y, m);
    atlas.context.restore();
    context.drawImage(atlas.canvas, slot.x, slot.y, width, m.height, x - pad, top, width, m.height);
  };

  const drawUnderline = (
    screen: Screen,
    index: number,
    x: number,
    top: number,
    width: number,
    color: Rgb,
    m: CellMetrics,
  ): void => {
    const t = m.thickness;
    const y = top + m.underline;
    const style = screen.underline[index] ?? UnderlineStyle.NONE;
    const underlineColor = screen.underlineColor[index] ?? NO_COLOR;
    setFill(underlineColor === NO_COLOR ? color : underlineColor);

    if (style === UnderlineStyle.SINGLE) context.fillRect(x, y, width, t);

    if (style === UnderlineStyle.DOUBLE) {
      const lower = Math.min(top + m.height - t, y + 2 * t);
      context.fillRect(x, lower - 2 * t, width, t);
      context.fillRect(x, lower, width, t);
    }

    if (style === UnderlineStyle.DOTTED) {
      for (let dot = 0; dot < width; dot += 2 * t) context.fillRect(x + dot, y, t, t);
    }

    if (style === UnderlineStyle.DASHED) {
      for (let dash = 0; dash < width; dash += m.width)
        context.fillRect(x + dash + Math.floor(m.width / 4), y, Math.ceil(m.width / 2), t);
    }

    if (style === UnderlineStyle.CURLY) {
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
    screen: Screen,
    index: number,
    x: number,
    top: number,
    color: Rgb,
    m: CellMetrics,
  ): void => {
    const flags = screen.flags[index] ?? 0;

    if ((flags & CellFlag.INVISIBLE) !== 0) return;
    const width = m.width * Math.max(1, screen.width[index] ?? 1);

    if (screen.underline[index] !== UnderlineStyle.NONE)
      drawUnderline(screen, index, x, top, width, color, m);
    setFill(color);

    if ((flags & CellFlag.STRIKETHROUGH) !== 0)
      context.fillRect(x, top + m.strike, width, m.thickness);

    if ((flags & CellFlag.OVERLINE) !== 0) context.fillRect(x, top, width, m.thickness);
  };

  const foregroundAt = (screen: Screen, index: number, frame: Frame): Rgb => {
    const fg = screen.fg[index] ?? NO_COLOR;
    const bg = screen.bg[index] ?? NO_COLOR;

    if ((screen.flags[index] ?? 0) & CellFlag.INVERSE)
      return bg === NO_COLOR ? frame.background : bg;

    return fg === NO_COLOR ? frame.foreground : fg;
  };

  const backgroundAt = (screen: Screen, y: number, x: number, frame: Frame, scene: Scene): Rgb => {
    const index = y * screen.cols + x;
    const start = screen.selectionStart[y] ?? -1;

    if (start !== -1 && x >= start && x <= (screen.selectionEnd[y] ?? -1)) return scene.selection;

    if ((screen.flags[index] ?? 0) & CellFlag.INVERSE) {
      const fg = screen.fg[index] ?? NO_COLOR;

      return fg === NO_COLOR ? frame.foreground : fg;
    }

    return screen.bg[index] ?? NO_COLOR;
  };

  const paintRow = (
    y: number,
    frame: Frame,
    screen: Screen,
    scene: Scene,
    m: CellMetrics,
  ): void => {
    const top = y * m.height;
    setFill(frame.background);
    context.fillRect(0, top, canvas.width, m.height);

    if (y < screen.rows) {
      let start = 0;
      let run = backgroundAt(screen, y, 0, frame, scene);

      for (let column = 1; column <= screen.cols; column += 1) {
        const next =
          column < screen.cols ? backgroundAt(screen, y, column, frame, scene) : NO_COLOR;

        if (column < screen.cols && next === run) continue;

        if (run !== NO_COLOR) {
          setFill(run);
          context.fillRect(start * m.width, top, (column - start) * m.width, m.height);
        }

        start = column;
        run = next;
      }

      for (let column = 0; column < screen.cols; column += 1) {
        const index = y * screen.cols + column;

        if (screen.width[index] === 0) continue;
        const color = foregroundAt(screen, index, frame);
        drawText(screen, index, column * m.width, top, color, m);
        drawDecorations(screen, index, column * m.width, top, color, m);
      }
    }

    const link = scene.link;

    if (link === null || y < link.start.row || y > link.end.row) return;
    const first = y === link.start.row ? link.start.column : 0;
    const last = y === link.end.row ? link.end.column : screen.cols - 1;

    setFill(
      y < screen.rows && first < screen.cols
        ? foregroundAt(screen, y * screen.cols + first, frame)
        : frame.foreground,
    );
    context.fillRect(first * m.width, top + m.underline, (last - first + 1) * m.width, m.thickness);
  };

  const drawCursor = (
    cursor: Cursor,
    frame: Frame,
    screen: Screen,
    scene: Scene,
    m: CellMetrics,
  ): void => {
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

    if (style !== "block" || cursor.y >= screen.rows || cursor.x >= screen.cols) return;
    context.fillRect(x, top, width, m.height);
    const index = cursor.y * screen.cols + cursor.x;
    const bg = screen.bg[index] ?? NO_COLOR;

    drawText(screen, index, x, top, bg === NO_COLOR ? frame.background : bg, m);
  };

  return {
    canvas,
    setFont(next, nextMetrics) {
      font = next;
      metrics = nextMetrics;
      painted = [];
      atlas.clear();
    },
    resize(width, height) {
      const ratio = metrics?.ratio ?? 1;
      canvas.width = width;
      canvas.height = height;
      canvas.style.width = String(width / ratio) + "px";
      canvas.style.height = String(height / ratio) + "px";
      onscreen.fill = -1;
      onscreen.font = "";
      painted = [];
      cursorRow = null;
    },
    release() {
      canvas.width = 0;
      canvas.height = 0;
      painted = [];
      onscreen.fill = -1;
      onscreen.font = "";
      atlas.release();
      cursorRow = null;
    },
    paint(frame, screen, scene) {
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

      foreground = frame.foreground;
      background = frame.background;
      const next = Array.from(screen.hash);

      const whole = frame.dirty.length >= lines && painted.length >= lines && !recolored;
      const shift = whole ? findShift(painted.slice(0, lines), next.slice(0, lines)) : 0;

      if (shift !== 0) {
        const kept = (lines - Math.abs(shift)) * m.height;
        const from = Math.max(0, shift) * m.height;
        const to = Math.max(0, -shift) * m.height;
        context.drawImage(canvas, 0, from, canvas.width, kept, 0, to, canvas.width, kept);
      }

      const moved = painted.map((_, y) => painted[y + shift]);

      const rows =
        (frame.full || recolored) && shift === 0
          ? Array.from({ length: count }, (_, y) => y)
          : [
              ...new Set([
                ...frame.dirty.filter((y) => shift === 0 || moved[y] !== next[y]),
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

      rows.forEach((y) => paintRow(y, frame, screen, scene, m));
      painted = next;
      linked = scene.link;

      if (cursor !== null) drawCursor(cursor, frame, screen, scene, m);
      cursorRow = cursor?.y ?? null;
    },
  };
}
