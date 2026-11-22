export interface Point {
  readonly x: number;
  readonly y: number;
}

export interface Size {
  readonly width: number;
  readonly height: number;
}

export interface Crop {
  readonly cx: number;
  readonly cy: number;
  readonly w: number;
  readonly h: number;
}

export interface Edit {
  readonly turns: number;
  readonly flip: boolean;
  readonly angle: number;
  readonly crop: Crop;
}

export interface Camera {
  readonly x: number;
  readonly y: number;
  readonly scale: number;
  readonly angle: number;
  readonly squash: number;
}

export const MAX_ANGLE = 45;

export function orientedSize(image: Size, turns: number): Size {
  return turns % 2 === 0 ? image : { width: image.height, height: image.width };
}

export function wholeImage(image: Size): Edit {
  return {
    turns: 0,
    flip: false,
    angle: 0,
    crop: { cx: image.width / 2, cy: image.height / 2, w: image.width, h: image.height },
  };
}

export function orientation(image: Size, edit: Edit): DOMMatrix {
  const size = orientedSize(image, edit.turns);

  return new DOMMatrix()
    .translate(size.width / 2, size.height / 2)
    .scale(edit.flip ? -1 : 1, 1)
    .rotate(edit.turns * 90)
    .translate(-image.width / 2, -image.height / 2);
}

export function cameraMatrix(viewport: Size, camera: Camera): DOMMatrix {
  return new DOMMatrix()
    .translate(viewport.width / 2, viewport.height / 2)
    .scale(camera.squash, 1)
    .scale(camera.scale)
    .rotate(camera.angle)
    .translate(-camera.x, -camera.y);
}

export function fitCamera(edit: Edit, viewport: Size, padding: number): Camera {
  return {
    x: edit.crop.cx,
    y: edit.crop.cy,
    angle: edit.angle,
    squash: 1,
    scale: Math.max(
      0.001,
      Math.min(
        (viewport.width - padding * 2) / edit.crop.w,
        (viewport.height - padding * 2) / edit.crop.h,
      ),
    ),
  };
}

export function mixCamera(from: Camera, to: Camera, t: number): Camera {
  return {
    x: mix(from.x, to.x, t),
    y: mix(from.y, to.y, t),
    scale: Math.exp(mix(Math.log(from.scale), Math.log(to.scale), t)),
    angle: mix(from.angle, to.angle, t),
    squash: mix(from.squash, to.squash, t),
  };
}

export function mixEdit(from: Edit, to: Edit, t: number): Edit {
  if (from.turns !== to.turns || from.flip !== to.flip) return to;

  return {
    ...to,
    angle: mix(from.angle, to.angle, t),
    crop: {
      cx: mix(from.crop.cx, to.crop.cx, t),
      cy: mix(from.crop.cy, to.crop.cy, t),
      w: mix(from.crop.w, to.crop.w, t),
      h: mix(from.crop.h, to.crop.h, t),
    },
  };
}

function reach(crop: Crop, angle: number): Point {
  const radians = (angle * Math.PI) / 180;
  const cos = Math.abs(Math.cos(radians));
  const sin = Math.abs(Math.sin(radians));

  return { x: (crop.w / 2) * cos + (crop.h / 2) * sin, y: (crop.w / 2) * sin + (crop.h / 2) * cos };
}

export function coverFactor(crop: Crop, angle: number, bounds: Size): number {
  const extent = reach(crop, angle);

  return Math.min(
    crop.cx / extent.x,
    (bounds.width - crop.cx) / extent.x,
    crop.cy / extent.y,
    (bounds.height - crop.cy) / extent.y,
  );
}

export function settle(crop: Crop, angle: number, bounds: Size): Crop {
  const extent = reach(crop, angle);
  const k = Math.min(1, bounds.width / 2 / extent.x, bounds.height / 2 / extent.y);

  return {
    w: crop.w * k,
    h: crop.h * k,
    cx: clamp(crop.cx, extent.x * k, bounds.width - extent.x * k),
    cy: clamp(crop.cy, extent.y * k, bounds.height - extent.y * k),
  };
}

export function straighten(start: Crop, angle: number, bounds: Size): Crop {
  const k = Math.min(1, coverFactor(start, angle, bounds));

  return { ...start, w: start.w * k, h: start.h * k };
}

export function turnLeft(edit: Edit, image: Size): Edit {
  const bounds = orientedSize(image, edit.turns);

  return {
    turns: (edit.turns + (edit.flip ? 1 : 3)) % 4,
    flip: edit.flip,
    angle: edit.angle,
    crop: { cx: edit.crop.cy, cy: bounds.width - edit.crop.cx, w: edit.crop.h, h: edit.crop.w },
  };
}

export function mirror(edit: Edit, image: Size): Edit {
  const bounds = orientedSize(image, edit.turns);

  return {
    ...edit,
    flip: !edit.flip,
    angle: edit.angle === 0 ? 0 : -edit.angle,
    crop: { ...edit.crop, cx: bounds.width - edit.crop.cx },
  };
}

export function fitAspect(crop: Crop, ratio: number): Crop {
  if (crop.w / crop.h > ratio) return { ...crop, w: crop.h * ratio };

  return { ...crop, h: crop.w / ratio };
}

export function resample(points: readonly Point[], count: number): Point[] {
  const first = points[0];

  if (first === undefined) return [];

  if (points.length === 1) return Array.from({ length: count }, () => first);

  const lengths = arcLengths(points);
  const total = lengths.at(-1) ?? 0;

  return Array.from({ length: count }, (_, index) => {
    const target = (total * index) / (count - 1);

    const after = Math.max(
      1,
      lengths.findIndex((length) => length >= target),
    );

    const a = points[after - 1] ?? first;
    const b = points[after] ?? a;
    const span = (lengths[after] ?? 0) - (lengths[after - 1] ?? 0);
    const t = span === 0 ? 0 : (target - (lengths[after - 1] ?? 0)) / span;

    return { x: mix(a.x, b.x, t), y: mix(a.y, b.y, t) };
  });
}

export function arcLengths(points: readonly Point[]): number[] {
  const lengths = [0];

  for (let index = 1; index < points.length; index += 1) {
    const a = points[index - 1];
    const b = points[index];

    lengths.push(
      (lengths[index - 1] ?? 0) + (a === undefined || b === undefined ? 0 : distance(a, b)),
    );
  }

  return lengths;
}

export function pathLength(points: readonly Point[]): number {
  return points.reduce((sum, point, index) => {
    const previous = points[index - 1];

    return previous === undefined ? sum : sum + distance(previous, point);
  }, 0);
}

export function distance(a: Point, b: Point): number {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

export function mix(a: number, b: number, t: number): number {
  return a + (b - a) * t;
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}
