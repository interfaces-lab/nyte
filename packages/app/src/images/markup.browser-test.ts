import { platformColors } from "@nyte-ai/ui/platform-colors";
import { platformRamps } from "@nyte-ai/ui/platform-ramps";
import { exportMarkup, imageTone } from "./markup-export.tsx";
import { turnLeft, wholeImage } from "./markup-geometry.ts";
import type { Edit } from "./markup-geometry.ts";
import type { Mark } from "./markup.ts";

const SIZE = 128;

const line = (corners: readonly (readonly [number, number])[]) =>
  corners.slice(1).flatMap((corner, index) => {
    const from = corners[index] ?? corner;
    const steps = Math.max(1, Math.ceil(Math.hypot(corner[0] - from[0], corner[1] - from[1]) / 2));

    return Array.from({ length: steps }, (_, step) => ({
      x: from[0] + ((corner[0] - from[0]) * (step + 1)) / steps,
      y: from[1] + ((corner[1] - from[1]) * (step + 1)) / steps,
      pressure: 0.5,
    }));
  });

const marks = [
  {
    name: "pen",
    mark: {
      id: 1,
      ink: "red",
      width: 6,
      kind: "pen",
      axis: 0,
      points: line([
        [20, 20],
        [50, 20],
        [80, 20],
        [80, 50],
        [80, 80],
      ]),
    },
    on: [
      [50, 20],
      [80, 50],
    ],
    off: [[20, 100]],
  },
  {
    name: "straight highlight",
    mark: {
      id: 2,
      ink: "amber",
      width: 16,
      kind: "highlight",
      axis: 0,
      points: line([
        [20, 64],
        [108, 64],
      ]),
    },
    on: [[64, 64]],
    off: [[64, 104]],
  },
  {
    name: "circle",
    mark: {
      id: 3,
      ink: "blue",
      width: 6,
      kind: "circle",
      frame: { center: { x: 64, y: 64 }, rx: 40, ry: 28, rotation: 0 },
      start: -2.4,
      turn: 1,
    },
    on: [
      [64, 35],
      [64, 93],
    ],
    off: [[64, 64]],
  },
  {
    name: "box",
    mark: {
      id: 4,
      ink: "red",
      width: 4,
      kind: "box",
      frame: { center: { x: 64, y: 64 }, rx: 40, ry: 30, rotation: 0 },
    },
    on: [
      [24, 64],
      [104, 64],
      [64, 34],
      [64, 94],
    ],
    off: [[64, 64]],
  },
  {
    name: "arrow",
    mark: {
      id: 5,
      ink: "green",
      width: 6,
      kind: "arrow",
      from: { x: 20, y: 64 },
      to: { x: 108, y: 64 },
    },
    on: [
      [44, 64],
      [100, 64],
    ],
    off: [[64, 108]],
  },
] as const satisfies readonly {
  readonly name: string;
  readonly mark: Mark;
  readonly on: readonly (readonly [number, number])[];
  readonly off: readonly (readonly [number, number])[];
}[];

const placements = [
  {
    name: "whole image",
    edit: (whole: Edit) => whole,
    size: [SIZE, SIZE],
    at: [
      [10, 10, true],
      [100, 100, false],
    ],
  },
  {
    name: "crop",
    edit: (whole: Edit) => ({ ...whole, crop: { cx: 48, cy: 48, w: 64, h: 64 } }),
    size: [64, 64],
    at: [
      [4, 4, true],
      [60, 60, false],
    ],
  },
  {
    name: "quarter turn left",
    edit: (whole: Edit) => turnLeft(whole, { width: SIZE, height: SIZE }),
    size: [SIZE, SIZE],
    at: [
      [10, 118, true],
      [10, 10, false],
    ],
  },
] as const satisfies readonly {
  readonly name: string;
  readonly edit: (whole: Edit) => Edit;
  readonly size: readonly [number, number];
  readonly at: readonly (readonly [number, number, boolean])[];
}[];

export async function run(): Promise<string> {
  for (const [tone, background] of [
    ["light", platformColors.light.bgBase],
    ["dark", platformColors.dark.bgBase],
  ] as const) {
    const source = await paint(background, undefined);

    check(imageTone(source) === tone, `Source pixels, not the UI theme, read as ${tone}`);

    for (const row of marks) {
      const output = await read(
        await exportMarkup(
          source,
          wholeImage({ width: SIZE, height: SIZE }),
          [row.mark],
          tone,
          "marked.png",
        ),
      );

      const base = await read(
        await exportMarkup(
          source,
          wholeImage({ width: SIZE, height: SIZE }),
          [],
          tone,
          "plain.png",
        ),
      );

      check(
        output.width === SIZE && output.height === SIZE,
        `${row.name}: the PNG keeps the source size`,
      );

      for (const point of row.on) {
        check(
          differs(output.pixel(point[0], point[1]), base.pixel(point[0], point[1]), 10),
          `${tone} ${row.name}: the PNG contains its mark at ${point.join(",")}`,
        );
      }

      for (const point of row.off) {
        check(
          !differs(output.pixel(point[0], point[1]), base.pixel(point[0], point[1]), 0),
          `${tone} ${row.name}: the PNG leaves unmarked pixels alone at ${point.join(",")}`,
        );
      }
    }
  }

  const quadrant = platformRamps.red.opaque["80"];
  const source = await paint(platformColors.light.bgBase, quadrant);

  const corner = (
    await read(
      await exportMarkup(source, wholeImage({ width: SIZE, height: SIZE }), [], "light", "a.png"),
    )
  ).pixel(10, 10);

  for (const row of placements) {
    const file = await exportMarkup(
      source,
      row.edit(wholeImage({ width: SIZE, height: SIZE })),
      [],
      "light",
      "cut.png",
    );

    const output = await read(file);

    check(file.type === "image/png" && file.name === "cut.png", `${row.name}: PNG file boundary`);
    check(
      output.width === row.size[0] && output.height === row.size[1],
      `${row.name}: the PNG is ${row.size.join(" × ")}, got ${output.width} × ${output.height}`,
    );

    for (const point of row.at) {
      check(
        !differs(output.pixel(point[0], point[1]), corner, 6) === point[2],
        `${row.name}: pixel ${point[0]},${point[1]} ${point[2] ? "comes from" : "is outside"} the coloured quadrant`,
      );
    }
  }

  return "passed";
}

async function paint(background: string, quadrant: string | undefined): Promise<HTMLImageElement> {
  const canvas = document.createElement("canvas");

  canvas.width = SIZE;
  canvas.height = SIZE;
  const context = canvas.getContext("2d");

  if (context === null) throw new Error("Missing the real Canvas renderer");
  context.fillStyle = background;
  context.fillRect(0, 0, SIZE, SIZE);

  if (quadrant !== undefined) {
    context.fillStyle = quadrant;
    context.fillRect(0, 0, SIZE / 2, SIZE / 2);
  }

  const image = new Image();

  image.src = canvas.toDataURL("image/png");
  await image.decode();

  return image;
}

async function read(file: File) {
  const bitmap = await createImageBitmap(file);
  const canvas = document.createElement("canvas");

  canvas.width = bitmap.width;
  canvas.height = bitmap.height;
  const context = canvas.getContext("2d", { willReadFrequently: true });

  if (context === null) throw new Error("Missing the real Canvas renderer");
  context.drawImage(bitmap, 0, 0);
  bitmap.close();

  return {
    width: canvas.width,
    height: canvas.height,
    pixel: (x: number, y: number) => context.getImageData(x, y, 1, 1).data,
  };
}

function differs(a: Uint8ClampedArray, b: Uint8ClampedArray, tolerance: number): boolean {
  return [0, 1, 2, 3].some(
    (channel) => Math.abs((a[channel] ?? 0) - (b[channel] ?? 0)) > tolerance,
  );
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
