import { platformColors, platformScopes } from "@nyte-ai/ui/platform-colors";

export interface Point {
  readonly x: number;
  readonly y: number;
  readonly pressure: number;
}

export type Ink = "red" | "orange" | "blue";

export type Mark =
  | { readonly kind: "pen"; readonly ink: Ink; readonly points: readonly [Point, ...Point[]] }
  | {
      readonly kind: "ellipse" | "box" | "arrow";
      readonly ink: Ink;
      readonly from: Point;
      readonly to: Point;
    };

export const markupInk = {
  red: platformScopes.light.red.bgInteractiveStrong,
  orange: platformScopes.light.orange.bgInteractiveStrong,
  blue: platformScopes.light.blue.bgInteractiveStrong,
} satisfies Readonly<Record<Ink, string>>;

export const markupLight = platformColors.light.bgBase;

export const markupOpacity = { core: 0.82, halo: 0.18, pool: 0.2, under: 0.32 } as const;

export function markPath(mark: Mark): string {
  if (mark.kind === "pen") {
    const first = mark.points[0];
    const last = mark.points.at(-1) ?? first;

    const segments = mark.points.slice(1).map((point, index) => {
      const next = mark.points[index + 2] ?? point;

      return `Q ${point.x} ${point.y} ${(point.x + next.x) / 2} ${(point.y + next.y) / 2}`;
    });

    return `M ${first.x} ${first.y} ${segments.join(" ")} L ${last.x} ${last.y}`;
  }

  if (mark.kind === "arrow") {
    const dx = mark.to.x - mark.from.x;
    const dy = mark.to.y - mark.from.y;
    const length = Math.hypot(dx, dy);
    const line = `M ${mark.from.x} ${mark.from.y} L ${mark.to.x} ${mark.to.y}`;

    if (length === 0) return line;

    const head = Math.min(length / 3, Math.max(12, length * 0.16));
    const backX = mark.to.x - (dx / length) * head;
    const backY = mark.to.y - (dy / length) * head;
    const wingX = (-dy / length) * head * 0.6;
    const wingY = (dx / length) * head * 0.6;

    return `${line} M ${backX + wingX} ${backY + wingY} L ${mark.to.x} ${mark.to.y} L ${backX - wingX} ${backY - wingY}`;
  }

  const left = Math.min(mark.from.x, mark.to.x);
  const top = Math.min(mark.from.y, mark.to.y);
  const width = Math.abs(mark.to.x - mark.from.x);
  const height = Math.abs(mark.to.y - mark.from.y);

  if (mark.kind === "box") return `M ${left} ${top} h ${width} v ${height} h ${-width} Z`;

  const centerY = top + height / 2;

  return `M ${left} ${centerY} a ${width / 2} ${height / 2} 0 1 0 ${width} 0 a ${width / 2} ${height / 2} 0 1 0 ${-width} 0 Z`;
}

export function markDot(mark: Mark): Point | undefined {
  if (mark.kind !== "pen") return undefined;
  const first = mark.points[0];

  return mark.points.every((point) => point.x === first.x && point.y === first.y)
    ? first
    : undefined;
}

/** Widths are source-image pixels, keeping the same marker weight when a large image is fitted. */
export function markWidth(mark: Mark, width: number, height: number): number {
  const base = Math.max(7, Math.max(width, height) / 160);

  if (mark.kind !== "pen") return base;

  const pressure = mark.points.reduce((sum, point) => sum + point.pressure, 0) / mark.points.length;

  return base * (4.8 / 7) * (0.7 + pressure * 0.6);
}

/** Sampling source pixels, rather than the UI theme, keeps the preview and exported ink identical. */
export function needsLightUnderstroke(image: HTMLImageElement): boolean {
  const sample = document.createElement("canvas");
  sample.width = 32;
  sample.height = 32;
  const context = sample.getContext("2d", { willReadFrequently: true });

  if (context === null)
    throw new Error("Image pixels are unavailable. Try opening the image again.");

  context.drawImage(image, 0, 0, sample.width, sample.height);
  const pixels = context.getImageData(0, 0, sample.width, sample.height).data;

  const totals = pixels.reduce(
    (sum, value, index) => {
      if (index % 4 !== 0) return sum;
      const alpha = (pixels[index + 3] ?? 0) / 255;

      return {
        luminance:
          sum.luminance +
          (value * 0.2126 + (pixels[index + 1] ?? 0) * 0.7152 + (pixels[index + 2] ?? 0) * 0.0722) *
            alpha,
        weight: sum.weight + alpha,
      };
    },
    { luminance: 0, weight: 0 },
  );

  return totals.weight > 0 && totals.luminance / totals.weight < 255 * 0.45;
}

export async function flattenMarkup(
  image: HTMLImageElement,
  marks: readonly Mark[],
  name: string,
): Promise<File> {
  await image.decode();
  const canvas = document.createElement("canvas");
  canvas.width = image.naturalWidth;
  canvas.height = image.naturalHeight;
  const context = canvas.getContext("2d");

  if (context === null) throw new Error("The marked image could not be created. Try again.");

  context.drawImage(image, 0, 0);
  const dark = needsLightUnderstroke(image);
  context.lineCap = "round";
  context.lineJoin = "round";

  for (const mark of marks) {
    const path = new Path2D(markPath(mark));
    const width = markWidth(mark, canvas.width, canvas.height);
    const dot = markDot(mark);

    const paint = (width: number): void => {
      if (dot === undefined) {
        context.lineWidth = width;
        context.stroke(path);

        return;
      }

      context.beginPath();
      context.arc(dot.x, dot.y, width / 2, 0, Math.PI * 2);
      context.fill();
    };

    context.globalCompositeOperation = "source-over";

    if (dark) {
      context.strokeStyle = markupLight;
      context.fillStyle = markupLight;
      context.globalAlpha = markupOpacity.under;
      paint(width * 1.6);
    }

    context.globalCompositeOperation = "multiply";
    context.strokeStyle = markupInk[mark.ink];
    context.fillStyle = markupInk[mark.ink];
    context.globalAlpha = markupOpacity.halo;
    paint(width * 1.4);
    context.globalAlpha = markupOpacity.core;
    paint(width);

    if (mark.kind !== "pen") continue;

    context.fillStyle = markupInk[mark.ink];
    context.globalAlpha = markupOpacity.pool;

    for (const point of [mark.points[0], mark.points.at(-1) ?? mark.points[0]]) {
      context.beginPath();
      context.arc(point.x, point.y, width / 2, 0, Math.PI * 2);
      context.fill();
    }
  }

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((encoded) => {
      if (encoded === null) {
        reject(new Error("The marked image could not be saved. Try again."));

        return;
      }

      resolve(encoded);
    }, "image/png"),
  );

  return new File([blob], name, { type: "image/png" });
}
