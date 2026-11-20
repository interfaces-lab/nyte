import { platformRamps } from "@nyte-ai/ui/platform-ramps";
import { arcLengths, distance, mix, pathLength, resample } from "./markup-geometry.ts";
import type { Point } from "./markup-geometry.ts";

export const INKS = ["black", "red", "amber", "green", "blue", "purple"] as const;

export type Ink = (typeof INKS)[number];

const RAMPS = {
  black: platformRamps.gray,
  red: platformRamps.red,
  amber: platformRamps.yellow,
  green: platformRamps.green,
  blue: platformRamps.blue,
  purple: platformRamps.purple,
} as const;

export function inkColor(ink: Ink): string {
  return ink === "black" ? RAMPS.black.opaque["130"] : RAMPS[ink].opaque["80"];
}

export function highlighterColor(ink: Ink): string {
  return RAMPS[ink].opaque["40"];
}

export function poolColor(ink: Ink): string {
  return RAMPS[ink].opaque["50"];
}

export const INSTRUMENTS = ["pen", "highlight"] as const;

export type Instrument = (typeof INSTRUMENTS)[number];

export type Marker = Instrument | "circle" | "arrow" | "box";

export type Tool = Marker | "eraser" | "move";

export const WIDTHS = {
  pen: 4,
  highlight: 22,
  eraser: 24,
  circle: 4.5,
  arrow: 4.5,
  box: 4.5,
} as const satisfies Record<Exclude<Tool, "move">, number>;

export function laysInk(tool: Tool): tool is Marker {
  return tool !== "eraser" && tool !== "move";
}

export interface Sample extends Point {
  readonly pressure: number;
}

export interface Frame {
  readonly center: Point;
  readonly rx: number;
  readonly ry: number;
  readonly rotation: number;
}

interface Base {
  readonly id: number;
  readonly ink: Ink;
  readonly width: number;
}

export type Stroke<Kind extends Instrument = Instrument> = Base & {
  readonly kind: Kind;
  readonly points: readonly Sample[];
  readonly axis: number;
};

export type Mark =
  | Stroke<"pen">
  | Stroke<"highlight">
  | (Base & {
      readonly kind: "circle";
      readonly frame: Frame;
      readonly start: number;
      readonly turn: number;
    })
  | (Base & { readonly kind: "box"; readonly frame: Frame })
  | (Base & { readonly kind: "arrow"; readonly from: Point; readonly to: Point });

const CIRCLE_POINTS = 96;

const PROFILES = {
  pen: { speed: 0.42, pressure: 0.9, start: 3, startTip: 0.45, end: 3, endTip: 0.35 },
  highlight: { speed: 0, pressure: 0, start: 0, startTip: 1, end: 0, endTip: 1 },
} as const satisfies Record<Instrument, Profile>;

interface Profile {
  readonly speed: number;
  readonly pressure: number;
  readonly start: number;
  readonly startTip: number;
  readonly end: number;
  readonly endTip: number;
}

export interface Sweep {
  readonly body: string;
  readonly start: string;
  readonly end: string;
}

export interface ArrowArt {
  readonly shaft: string;
  readonly head: string | undefined;
}

export interface Body {
  readonly points: readonly Point[];
  readonly radii: readonly number[];
}

export function strokeBody(
  samples: readonly Sample[],
  width: number,
  instrument: Instrument,
): Body {
  const profile: Profile = PROFILES[instrument];

  const kept = samples.filter((sample, index) => {
    const previous = samples[index - 1];

    return (
      previous === undefined ||
      index === samples.length - 1 ||
      distance(previous, sample) > width * 0.18
    );
  });

  const points = soften(soften(kept));
  const pressured = kept.some((sample) => sample.pressure !== kept[0]?.pressure);
  const lengths = arcLengths(points);
  const total = lengths.at(-1) ?? 0;
  const startTaper = Math.min(total * 0.3, width * profile.start);
  const endTaper = Math.min(total * 0.5, width * profile.end);

  const speed = points.map((point, index) => {
    const previous = points[index - 1];
    const step = previous === undefined ? 0 : distance(previous, point);

    return 1 - profile.speed * Math.min(1, step / (width * 2.4));
  });

  const radii = points.map((_, index) => {
    const along = lengths[index] ?? 0;

    const force = pressured
      ? 1 + ((kept[Math.min(index, kept.length - 1)]?.pressure ?? 0.5) - 0.5) * profile.pressure
      : mix(speed[index - 1] ?? speed[index] ?? 1, speed[index] ?? 1, 0.5);

    const head = startTaper === 0 ? 1 : mix(profile.startTip, 1, smooth(along / startTaper));
    const tail = endTaper === 0 ? 1 : mix(profile.endTip, 1, smooth((total - along) / endTaper));

    return (width / 2) * force * Math.min(head, tail);
  });

  return { points, radii };
}

export function chiselSweep(
  points: readonly Point[],
  width: number,
  axis: number,
  seed: number,
): Sweep {
  const kept = soften(
    soften(
      points.filter((point, index) => {
        const previous = points[index - 1];

        return (
          previous === undefined ||
          index === points.length - 1 ||
          distance(previous, point) > width * 0.12
        );
      }),
    ),
  );

  const spine =
    kept.length === 1 && kept[0] !== undefined
      ? [kept[0], { x: kept[0].x + 0.01, y: kept[0].y }]
      : kept;

  const slant = axis + Math.PI / 2 - 0.34;

  const nib = spine.map((point, index) => {
    const wave = 1 + 0.035 * Math.sin(index * 0.9 + seed) + 0.02 * Math.sin(index * 2.7 + seed * 2);
    const half = (width / 2) * wave;

    return {
      top: { x: point.x + Math.cos(slant) * half, y: point.y + Math.sin(slant) * half },
      bottom: { x: point.x - Math.cos(slant) * half, y: point.y - Math.sin(slant) * half },
    };
  });

  const quads = nib.slice(1).map((after, index) => {
    const before = nib[index] ?? after;
    const corners = [before.top, after.top, after.bottom, before.bottom];

    return polygon(signedArea(corners) < 0 ? corners.reverse() : corners);
  });

  const end = (at: (typeof nib)[number] | undefined) => {
    if (at === undefined) return "";
    const thickness = width * 0.16;

    const along = {
      x: Math.cos(slant - Math.PI / 2) * thickness,
      y: Math.sin(slant - Math.PI / 2) * thickness,
    };

    return polygon([
      { x: at.top.x - along.x, y: at.top.y - along.y },
      { x: at.top.x + along.x, y: at.top.y + along.y },
      { x: at.bottom.x + along.x, y: at.bottom.y + along.y },
      { x: at.bottom.x - along.x, y: at.bottom.y - along.y },
    ]);
  };

  return { body: quads.join(" "), start: end(nib[0]), end: end(nib.at(-1)) };
}

function signedArea(points: readonly Point[]): number {
  return points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length] ?? point;

    return sum + point.x * next.y - next.x * point.y;
  }, 0);
}

function polygon(points: readonly Point[]): string {
  return `M ${points.map((point) => `${point.x} ${point.y}`).join(" L ")} Z`;
}

export function circleSpine(mark: Extract<Mark, { kind: "circle" }>): Point[] {
  const cos = Math.cos(mark.frame.rotation);
  const sin = Math.sin(mark.frame.rotation);

  return Array.from({ length: CIRCLE_POINTS }, (_, index) => {
    const t = index / (CIRCLE_POINTS - 1);
    const theta = mark.start + mark.turn * (Math.PI * 2 + 0.5) * t;
    const grow = 0.975 + 0.075 * t + 0.012 * Math.sin(theta * 2 + mark.start);
    const u = mark.frame.rx * grow * Math.cos(theta);
    const v = mark.frame.ry * grow * Math.sin(theta);

    return {
      x: mark.frame.center.x + u * cos - v * sin,
      y: mark.frame.center.y + u * sin + v * cos,
    };
  });
}

export function circleTaper(t: number): number {
  return Math.min(0.3 + 0.7 * smooth(t / 0.14), 0.25 + 0.75 * smooth((1 - t) / 0.2));
}

export function fitCircle(
  points: readonly Point[],
  axis: number,
  width: number,
): Pick<Extract<Mark, { kind: "circle" }>, "frame" | "start" | "turn"> {
  const first = points[0] ?? { x: 0, y: 0 };
  const last = points.at(-1) ?? first;
  const minimum = width * 3;

  if (pathLength(points) < distance(first, last) * 1.3) {
    const local = toFrame(last, first, axis);

    return {
      frame: {
        center: fromFrame({ x: local.x / 2, y: local.y / 2 }, first, axis),
        rx: Math.max(minimum, Math.abs(local.x) / 2),
        ry: Math.max(minimum, Math.abs(local.y) / 2),
        rotation: axis,
      },
      start: -2.4,
      turn: 1,
    };
  }

  const mean = {
    x: points.reduce((sum, point) => sum + point.x, 0) / points.length,
    y: points.reduce((sum, point) => sum + point.y, 0) / points.length,
  };

  const spread = points.reduce(
    (sum, point) => ({
      xx: sum.xx + (point.x - mean.x) ** 2,
      yy: sum.yy + (point.y - mean.y) ** 2,
      xy: sum.xy + (point.x - mean.x) * (point.y - mean.y),
    }),
    { xx: 0, yy: 0, xy: 0 },
  );

  const principal = 0.5 * Math.atan2(2 * spread.xy, spread.xx - spread.yy);
  const fitted = extent(points, mean, principal);
  const quarter = Math.PI / 2;
  const off = ((((principal - axis) % quarter) + quarter * 1.5) % quarter) - quarter / 2;
  const round = Math.max(fitted.rx, fitted.ry) / Math.min(fitted.rx, fitted.ry) < 1.15;
  const rotation = round || Math.abs(off) < (12 * Math.PI) / 180 ? axis : principal;
  const box = rotation === principal ? fitted : extent(points, mean, rotation);
  const start = toFrame(first, box.center, rotation);

  const area = points.reduce((sum, point, index) => {
    const next = points[(index + 1) % points.length] ?? point;
    const a = toFrame(point, box.center, rotation);
    const b = toFrame(next, box.center, rotation);

    return sum + a.x * b.y - b.x * a.y;
  }, 0);

  return {
    frame: {
      center: box.center,
      rx: Math.max(minimum, box.rx),
      ry: Math.max(minimum, box.ry),
      rotation,
    },
    start: Math.atan2(start.y / Math.max(box.ry, 1), start.x / Math.max(box.rx, 1)),
    turn: area >= 0 ? 1 : -1,
  };
}

function extent(points: readonly Point[], origin: Point, rotation: number) {
  const local = points.map((point) => toFrame(point, origin, rotation));
  const xs = local.map((point) => point.x);
  const ys = local.map((point) => point.y);
  const minX = Math.min(...xs);
  const maxX = Math.max(...xs);
  const minY = Math.min(...ys);
  const maxY = Math.max(...ys);

  return {
    center: fromFrame({ x: (minX + maxX) / 2, y: (minY + maxY) / 2 }, origin, rotation),
    rx: (maxX - minX) / 2,
    ry: (maxY - minY) / 2,
  };
}

export function settleHighlight(points: readonly Sample[], axis: number, width: number): Sample[] {
  const first = points[0];
  const last = points.at(-1);

  if (first === undefined || last === undefined || distance(first, last) < width)
    return [...points];

  const chord = Math.atan2(last.y - first.y, last.x - first.x);
  const wander = Math.max(...points.map((point) => Math.abs(toFrame(point, first, chord).y)));

  if (wander > width * 0.55) return [...points];

  const tilt = ((((chord - axis) % Math.PI) + Math.PI * 1.5) % Math.PI) - Math.PI / 2;

  if (Math.abs(tilt) > (8 * Math.PI) / 180) return [first, last];

  const local = points.map((point) => toFrame(point, first, axis));
  const level = local.reduce((sum, point) => sum + point.y, 0) / local.length;
  const along = local.map((point) => point.x);

  return [
    { ...fromFrame({ x: along[0] ?? 0, y: level }, first, axis), pressure: 0.5 },
    { ...fromFrame({ x: along.at(-1) ?? 0, y: level }, first, axis), pressure: 0.5 },
  ];
}

export function boxFrame(from: Point, to: Point, axis: number, width: number): Frame {
  const local = toFrame(to, from, axis);

  return {
    center: fromFrame({ x: local.x / 2, y: local.y / 2 }, from, axis),
    rx: Math.max(width, Math.abs(local.x) / 2),
    ry: Math.max(width, Math.abs(local.y) / 2),
    rotation: axis,
  };
}

export function settledSpine(mark: Mark, count: number): Point[] | undefined {
  if (mark.kind === "circle") return resample(circleSpine(mark), count);

  if (mark.kind === "highlight") return resample(mark.points, count);

  return undefined;
}

export function mixSpine(from: readonly Point[], to: readonly Point[], t: number): Point[] {
  return to.map((point, index) => {
    const start = from[index] ?? point;

    return { x: mix(start.x, point.x, t), y: mix(start.y, point.y, t) };
  });
}

function markPoints(mark: Mark): Point[] {
  if (mark.kind === "circle") return circleSpine(mark);

  if (mark.kind === "arrow") return resample([mark.from, mark.to], 24);

  if (mark.kind === "box")
    return [
      { x: -1, y: -1 },
      { x: 1, y: -1 },
      { x: 1, y: 1 },
      { x: -1, y: 1 },
      { x: -1, y: -1 },
    ].flatMap((corner, index, corners) => {
      const next = corners[index + 1];

      if (next === undefined) return [];

      return resample(
        [
          fromFrame(
            { x: corner.x * mark.frame.rx, y: corner.y * mark.frame.ry },
            mark.frame.center,
            mark.frame.rotation,
          ),
          fromFrame(
            { x: next.x * mark.frame.rx, y: next.y * mark.frame.ry },
            mark.frame.center,
            mark.frame.rotation,
          ),
        ],
        12,
      );
    });

  return mark.points.length === 2 ? resample(mark.points, 24) : [...mark.points];
}

export function touches(mark: Mark, from: Point, to: Point, radius: number): boolean {
  const reach = radius + mark.width / 2;

  return markPoints(mark).some((point) => segmentDistance(point, from, to) <= reach);
}

function segmentDistance(point: Point, a: Point, b: Point): number {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = dx * dx + dy * dy;

  const t =
    length === 0
      ? 0
      : Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / length));

  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

export function markBounds(mark: Mark, spine?: readonly Point[]) {
  const points = spine ?? markPoints(mark);
  const xs = points.map((point) => point.x);
  const ys = points.map((point) => point.y);
  const pad = mark.width * 3;
  const x = Math.min(...xs) - pad;
  const y = Math.min(...ys) - pad;

  return { x, y, width: Math.max(...xs) + pad - x, height: Math.max(...ys) + pad - y };
}

export function soften<T extends Point>(points: readonly T[]): Point[] {
  return points.map((point, index) => {
    const before = points[index - 1];
    const after = points[index + 1];

    if (before === undefined || after === undefined) return point;

    return { x: (before.x + point.x * 2 + after.x) / 4, y: (before.y + point.y * 2 + after.y) / 4 };
  });
}

export function outline(points: readonly Point[], radii: readonly number[]): string {
  const first = points[0];

  if (first === undefined) return "";

  const head = radii[0] ?? 0;

  if (points.length === 1 || pathLength(points) < head * 0.25)
    return `M ${first.x - head} ${first.y} a ${head} ${head} 0 1 0 ${head * 2} 0 a ${head} ${head} 0 1 0 ${-head * 2} 0 Z`;

  const normals = points.map((point, index) => {
    const before = points[Math.max(0, index - 1)] ?? point;
    const after = points[Math.min(points.length - 1, index + 1)] ?? point;
    const length = Math.hypot(after.x - before.x, after.y - before.y) || 1;

    return { x: -(after.y - before.y) / length, y: (after.x - before.x) / length };
  });

  const side = (sign: number) =>
    points.map((point, index) => {
      const normal = normals[index] ?? { x: 0, y: 0 };
      const radius = radii[index] ?? 0;

      return { x: point.x + normal.x * radius * sign, y: point.y + normal.y * radius * sign };
    });

  const cap = (index: number) => {
    const center = points[index] ?? first;
    const normal = normals[index] ?? { x: 0, y: 1 };
    const radius = radii[index] ?? 0;
    const from = Math.atan2(normal.y, normal.x);

    return Array.from({ length: 7 }, (_, step) => {
      const angle = from - (Math.PI * (step + 1)) / 8;

      return { x: center.x + Math.cos(angle) * radius, y: center.y + Math.sin(angle) * radius };
    });
  };

  const ring = [
    ...side(1),
    ...cap(points.length - 1),
    ...side(-1).reverse(),
    ...cap(0).map((point) => ({ x: first.x * 2 - point.x, y: first.y * 2 - point.y })),
  ];

  return closedPath(ring);
}

function closedPath(ring: readonly Point[]): string {
  const middle = (a: Point, b: Point) => `${(a.x + b.x) / 2} ${(a.y + b.y) / 2}`;
  const start = ring[0];
  const end = ring.at(-1);

  if (start === undefined || end === undefined) return "";

  const curves = ring.map((point, index) => {
    const next = ring[(index + 1) % ring.length] ?? point;

    return `Q ${point.x} ${point.y} ${middle(point, next)}`;
  });

  return `M ${middle(end, start)} ${curves.join(" ")} Z`;
}

export function openPath(points: readonly Point[]): string {
  const first = points[0];
  const last = points.at(-1);

  if (first === undefined || last === undefined) return "";

  if (points.length <= 2) return `M ${first.x} ${first.y} L ${last.x} ${last.y}`;

  const curves = points.slice(1, -1).map((point, index) => {
    const next = points[index + 2] ?? point;

    return `Q ${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`;
  });

  return `M ${first.x} ${first.y} ${curves.join(" ")} L ${last.x} ${last.y}`;
}

export function boxPath(frame: Frame, width: number): string {
  const corner = Math.min(width * 1.6, frame.rx, frame.ry);

  const corners = [
    { x: frame.rx - corner, y: -frame.ry + corner, from: -Math.PI / 2 },
    { x: frame.rx - corner, y: frame.ry - corner, from: 0 },
    { x: -frame.rx + corner, y: frame.ry - corner, from: Math.PI / 2 },
    { x: -frame.rx + corner, y: -frame.ry + corner, from: Math.PI },
  ];

  return polygon(
    corners.flatMap((center) =>
      Array.from({ length: 5 }, (_, step) => {
        const angle = center.from + (Math.PI / 2) * (step / 4);

        return fromFrame(
          { x: center.x + Math.cos(angle) * corner, y: center.y + Math.sin(angle) * corner },
          frame.center,
          frame.rotation,
        );
      }),
    ),
  );
}

export function arrowPaths(from: Point, to: Point, width: number): ArrowArt {
  const length = distance(from, to);

  if (length < width) return { shaft: outline([to], [width / 2]), head: undefined };

  const ux = (to.x - from.x) / length;
  const uy = (to.y - from.y) / length;
  const head = Math.min(length * 0.5, width * 4.2);
  const spread = head * 0.62;
  const back = { x: to.x - ux * head, y: to.y - uy * head };
  const notch = { x: to.x - ux * head * 0.7, y: to.y - uy * head * 0.7 };
  const tip = { x: to.x - ux * width * 0.35, y: to.y - uy * width * 0.35 };

  return {
    shaft: outline(
      resample([from, notch], 12),
      Array.from({ length: 12 }, (_, index) => mix(width * 0.18, width * 0.55, index / 11)),
    ),
    head: polygon([
      tip,
      { x: back.x - uy * spread, y: back.y + ux * spread },
      notch,
      { x: back.x + uy * spread, y: back.y - ux * spread },
    ]),
  };
}

function toFrame(point: Point, origin: Point, rotation: number): Point {
  const dx = point.x - origin.x;
  const dy = point.y - origin.y;
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  return { x: dx * cos + dy * sin, y: -dx * sin + dy * cos };
}

function fromFrame(point: Point, origin: Point, rotation: number): Point {
  const cos = Math.cos(rotation);
  const sin = Math.sin(rotation);

  return {
    x: origin.x + point.x * cos - point.y * sin,
    y: origin.y + point.x * sin + point.y * cos,
  };
}

function smooth(t: number): number {
  const clamped = Math.min(1, Math.max(0, t));

  return clamped * clamped * (3 - 2 * clamped);
}
