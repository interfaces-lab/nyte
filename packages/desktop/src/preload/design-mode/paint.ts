import type { ContrastMark } from "./inspect.ts";
import type { Redline, Spacing, TrackMap } from "./measure.ts";
import type { Box, Outline, Point } from "./picker.ts";

export const ACCENT_RGB = "56 132 255";

const LAYERS = {
  xray: { stroke: 0.3, fill: 0 },
  covered: { stroke: 0.5, fill: 0.08 },
  marquee: { stroke: 0.4, fill: 0.05 },
  hover: { stroke: 0.5, fill: 0.08 },
} as const;

const MEASURE_RGB = "242 72 34";

const SPACING = {
  margin: "246 178 107 / 0.4",
  padding: "147 196 125 / 0.45",
  gap: "168 85 247",
} as const;

export const RULER_SIZE = 18;

const RULER = {
  surface: "rgb(250 250 250 / 0.94)",
  edge: "rgb(0 0 0 / 0.14)",
  tick: "rgb(0 0 0 / 0.32)",
  text: "rgb(0 0 0 / 0.55)",
  extent: `rgb(${MEASURE_RGB} / 0.18)`,
} as const;

const TICK = 10;

const GLIDE = 0.95;

const FRAME_MS = 1000 / 60;

const SETTLED_PX = 0.5;

export interface Scene {
  readonly xray: readonly Outline[];
  readonly covered: readonly Outline[];
  readonly marquee: Box | undefined;
  readonly tracks: TrackMap | undefined;
  readonly spacing: Spacing | undefined;
  readonly measure: Measured | undefined;
  readonly rulers: Rulers | undefined;
  readonly contrast: readonly ContrastMark[];
}

export interface Measured {
  readonly from: Box;
  readonly to: Box;
  readonly lines: readonly Redline[];
}

export interface Guide {
  readonly axis: "x" | "y";
  readonly at: number;
}

export interface PlacedGuide extends Guide {
  readonly aligned: boolean;
}

export interface Rulers {
  readonly origin: Point;
  readonly cursor: Point | undefined;
  readonly extent: Box | undefined;
  readonly guides: readonly PlacedGuide[];
}

export interface Surface {
  readonly ratio: number;
  readonly width: number;
  readonly height: number;
}

export function glideOutline(from: Outline, to: Outline, elapsed: number): Outline {
  const step = 1 - (1 - GLIDE) ** (Math.max(elapsed, 1) / FRAME_MS);

  const next = {
    x: from.x + (to.x - from.x) * step,
    y: from.y + (to.y - from.y) * step,
    width: from.width + (to.width - from.width) * step,
    height: from.height + (to.height - from.height) * step,
    radius: to.radius,
  };

  return Math.abs(next.x - to.x) < SETTLED_PX &&
    Math.abs(next.y - to.y) < SETTLED_PX &&
    Math.abs(next.width - to.width) < SETTLED_PX &&
    Math.abs(next.height - to.height) < SETTLED_PX
    ? to
    : next;
}

export function paintScene(
  context: CanvasRenderingContext2D,
  surface: Surface,
  scene: Scene,
  hover: Outline | undefined,
): void {
  context.setTransform(surface.ratio, 0, 0, surface.ratio, 0, 0);
  context.clearRect(0, 0, surface.width, surface.height);

  if (scene.tracks !== undefined) paintTracks(context, scene.tracks);

  for (const outline of scene.xray) roundedBox(context, outline, LAYERS.xray);

  for (const outline of scene.covered) roundedBox(context, outline, LAYERS.covered);

  if (scene.marquee !== undefined) {
    roundedBox(context, { ...scene.marquee, radius: 0 }, LAYERS.marquee);
  }

  if (scene.spacing !== undefined) paintSpacing(context, scene.spacing);

  if (hover !== undefined) roundedBox(context, hover, LAYERS.hover);

  for (const mark of scene.contrast) paintContrast(context, mark);

  if (scene.measure !== undefined) paintMeasure(context, scene.measure, surface);

  if (scene.rulers !== undefined) paintRulers(context, surface, scene.rulers);
}

function paintTracks(context: CanvasRenderingContext2D, tracks: TrackMap): void {
  context.save();
  context.lineWidth = 1;
  context.setLineDash([4, 3]);
  context.strokeStyle = `rgb(${SPACING.gap} / 0.45)`;

  for (const box of tracks.containers) {
    context.strokeRect(box.x + 0.5, box.y + 0.5, box.width - 1, box.height - 1);
  }

  context.strokeStyle = `rgb(${SPACING.gap} / 0.7)`;

  for (const line of tracks.lines) {
    context.beginPath();
    context.moveTo(Math.round(line.from.x) + 0.5, Math.round(line.from.y) + 0.5);
    context.lineTo(Math.round(line.to.x) + 0.5, Math.round(line.to.y) + 0.5);
    context.stroke();
  }

  context.restore();
  hatch(context, tracks.gaps);
}

function paintSpacing(context: CanvasRenderingContext2D, spacing: Spacing): void {
  context.fillStyle = `rgb(${SPACING.margin})`;

  for (const band of spacing.margin) context.fillRect(band.x, band.y, band.width, band.height);

  context.fillStyle = `rgb(${SPACING.padding})`;

  for (const band of spacing.padding) context.fillRect(band.x, band.y, band.width, band.height);

  hatch(context, spacing.gaps);
}

function hatch(context: CanvasRenderingContext2D, gaps: readonly Box[]): void {
  for (const gap of gaps) {
    context.save();
    context.beginPath();
    context.rect(gap.x, gap.y, gap.width, gap.height);
    context.clip();
    context.fillStyle = `rgb(${SPACING.gap} / 0.1)`;
    context.fillRect(gap.x, gap.y, gap.width, gap.height);
    context.strokeStyle = `rgb(${SPACING.gap} / 0.45)`;
    context.lineWidth = 1;
    context.beginPath();

    for (let offset = -gap.height; offset < gap.width; offset += 6) {
      context.moveTo(gap.x + offset, gap.y + gap.height);
      context.lineTo(gap.x + offset + gap.height, gap.y);
    }

    context.stroke();
    context.restore();
  }
}

function paintContrast(context: CanvasRenderingContext2D, mark: ContrastMark): void {
  context.save();
  context.strokeStyle = `rgb(${MEASURE_RGB})`;
  context.lineWidth = 1;
  context.setLineDash([3, 2]);
  context.strokeRect(mark.box.x + 0.5, mark.box.y + 0.5, mark.box.width - 1, mark.box.height - 1);
  context.restore();
  const text = mark.contrast.ratio.toFixed(1);

  context.font = "500 11px system-ui, sans-serif";
  const width = context.measureText(text).width + 8;

  tag(
    context,
    text,
    mark.box.x + mark.box.width + 4 + width / 2,
    mark.box.y + 8,
    `rgb(${MEASURE_RGB})`,
    "white",
  );
}

function paintMeasure(
  context: CanvasRenderingContext2D,
  measured: Measured,
  surface: Surface,
): void {
  context.save();
  context.strokeStyle = `rgb(${MEASURE_RGB})`;
  context.lineWidth = 1;
  context.strokeRect(
    measured.from.x + 0.5,
    measured.from.y + 0.5,
    measured.from.width - 1,
    measured.from.height - 1,
  );
  context.setLineDash([3, 2]);
  context.strokeRect(
    measured.to.x + 0.5,
    measured.to.y + 0.5,
    measured.to.width - 1,
    measured.to.height - 1,
  );
  context.setLineDash([]);

  for (const line of measured.lines) {
    const flat = line.from.y === line.to.y;
    const cap = 3;

    context.beginPath();
    context.moveTo(Math.round(line.from.x) + 0.5, Math.round(line.from.y) + 0.5);
    context.lineTo(Math.round(line.to.x) + 0.5, Math.round(line.to.y) + 0.5);

    if (flat) {
      context.moveTo(Math.round(line.from.x) + 0.5, line.from.y - cap);
      context.lineTo(Math.round(line.from.x) + 0.5, line.from.y + cap);
      context.moveTo(Math.round(line.to.x) + 0.5, line.to.y - cap);
      context.lineTo(Math.round(line.to.x) + 0.5, line.to.y + cap);
    } else {
      context.moveTo(line.from.x - cap, Math.round(line.from.y) + 0.5);
      context.lineTo(line.from.x + cap, Math.round(line.from.y) + 0.5);
      context.moveTo(line.to.x - cap, Math.round(line.to.y) + 0.5);
      context.lineTo(line.to.x + cap, Math.round(line.to.y) + 0.5);
    }

    context.stroke();
    const visible = visibleSpan(line, surface);

    if (visible !== undefined) {
      tag(
        context,
        String(Math.round(line.length)),
        visible.x,
        visible.y,
        `rgb(${MEASURE_RGB})`,
        "white",
      );
    }
  }

  context.restore();
}

function visibleSpan(line: Redline, surface: Surface): Point | undefined {
  const fromX = Math.max(Math.min(line.from.x, line.to.x), 0);
  const toX = Math.min(Math.max(line.from.x, line.to.x), surface.width);
  const fromY = Math.max(Math.min(line.from.y, line.to.y), 0);
  const toY = Math.min(Math.max(line.from.y, line.to.y), surface.height);

  if (fromX > toX || fromY > toY) return undefined;

  return { x: (fromX + toX) / 2, y: (fromY + toY) / 2 };
}

function tag(
  context: CanvasRenderingContext2D,
  text: string,
  x: number,
  y: number,
  fill: string,
  ink: string,
): void {
  context.font = "500 11px system-ui, sans-serif";
  const width = context.measureText(text).width + 8;
  const height = 16;

  context.fillStyle = fill;
  context.beginPath();
  context.roundRect(x - width / 2, y - height / 2, width, height, 3);
  context.fill();
  context.fillStyle = ink;
  context.textAlign = "center";
  context.textBaseline = "middle";
  context.fillText(text, x, y + 0.5);
}

function paintRulers(context: CanvasRenderingContext2D, surface: Surface, rulers: Rulers): void {
  const size = RULER_SIZE;
  const major = TICK * 10;
  const width = surface.width;
  const height = surface.height;
  const origin = rulers.origin;

  context.save();
  paintGuideLines(context, surface, rulers.guides);
  context.fillStyle = RULER.surface;
  context.fillRect(0, 0, width, size);
  context.fillRect(0, 0, size, height);

  if (rulers.extent !== undefined) {
    context.fillStyle = RULER.extent;
    context.fillRect(rulers.extent.x, 0, rulers.extent.width, size);
    context.fillRect(0, rulers.extent.y, size, rulers.extent.height);
  }

  context.strokeStyle = RULER.tick;
  context.fillStyle = RULER.text;
  context.lineWidth = 1;
  context.font = "9px system-ui, sans-serif";
  context.beginPath();

  for (let page = Math.ceil(-origin.x / TICK) * TICK; page + origin.x <= width; page += TICK) {
    const x = Math.round(page + origin.x) + 0.5;
    const long = page % major === 0;

    context.moveTo(x, size);
    context.lineTo(x, size - (long ? size * 0.6 : size * 0.25));

    if (long) {
      context.textAlign = "left";
      context.textBaseline = "top";
      context.fillText(String(page), x + 2, 2);
    }
  }

  for (let page = Math.ceil(-origin.y / TICK) * TICK; page + origin.y <= height; page += TICK) {
    const y = Math.round(page + origin.y) + 0.5;
    const long = page % major === 0;

    context.moveTo(size, y);
    context.lineTo(size - (long ? size * 0.6 : size * 0.25), y);

    if (long) {
      context.save();
      context.translate(2, y - 2);
      context.rotate(-Math.PI / 2);
      context.textAlign = "left";
      context.textBaseline = "top";
      context.fillText(String(page), 0, 0);
      context.restore();
    }
  }

  context.stroke();

  if (rulers.cursor !== undefined) {
    context.strokeStyle = `rgb(${MEASURE_RGB})`;
    context.beginPath();
    context.moveTo(Math.round(rulers.cursor.x) + 0.5, 0);
    context.lineTo(Math.round(rulers.cursor.x) + 0.5, size);
    context.moveTo(0, Math.round(rulers.cursor.y) + 0.5);
    context.lineTo(size, Math.round(rulers.cursor.y) + 0.5);
    context.stroke();
  }

  context.strokeStyle = RULER.edge;
  context.beginPath();
  context.moveTo(0, size + 0.5);
  context.lineTo(width, size + 0.5);
  context.moveTo(size + 0.5, 0);
  context.lineTo(size + 0.5, height);
  context.stroke();
  context.fillStyle = RULER.surface;
  context.fillRect(0, 0, size, size);

  for (const guide of rulers.guides) paintGuideTag(context, guide, origin, size);

  context.restore();
}

function paintGuideLines(
  context: CanvasRenderingContext2D,
  surface: Surface,
  guides: readonly PlacedGuide[],
): void {
  context.lineWidth = 1;

  for (const guide of guides) {
    const at = Math.round(guide.at) + 0.5;

    context.strokeStyle = `rgb(${MEASURE_RGB} / ${guide.aligned ? "1" : "0.55"})`;
    context.beginPath();

    if (guide.axis === "x") {
      context.moveTo(at, 0);
      context.lineTo(at, surface.height);
    } else {
      context.moveTo(0, at);
      context.lineTo(surface.width, at);
    }

    context.stroke();
  }
}

function paintGuideTag(
  context: CanvasRenderingContext2D,
  guide: PlacedGuide,
  origin: Point,
  size: number,
): void {
  const text = String(Math.round((guide.at - origin[guide.axis]) * 10) / 10);
  const fill = guide.aligned ? `rgb(${MEASURE_RGB})` : "white";
  const ink = guide.aligned ? "white" : `rgb(${MEASURE_RGB})`;

  if (guide.axis === "x") {
    tag(context, text, guide.at, size / 2, fill, ink);

    return;
  }

  context.save();
  context.translate(size / 2, guide.at);
  context.rotate(-Math.PI / 2);
  tag(context, text, 0, 0, fill, ink);
  context.restore();
}

function roundedBox(
  context: CanvasRenderingContext2D,
  outline: Outline,
  layer: { readonly stroke: number; readonly fill: number },
): void {
  if (outline.width <= 0 || outline.height <= 0) return;
  const radius = Math.min(outline.radius, outline.width / 2, outline.height / 2);

  context.beginPath();
  context.roundRect(
    outline.x + 0.5,
    outline.y + 0.5,
    outline.width - 1,
    outline.height - 1,
    radius,
  );

  if (layer.fill > 0) {
    context.fillStyle = `rgb(${ACCENT_RGB} / ${String(layer.fill)})`;
    context.fill();
  }

  context.strokeStyle = `rgb(${ACCENT_RGB} / ${String(layer.stroke)})`;
  context.lineWidth = 1;
  context.stroke();
}
