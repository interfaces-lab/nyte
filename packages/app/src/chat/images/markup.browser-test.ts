import { platformColors } from "@nyte-ai/ui/platform-colors";
import { flattenMarkup, needsLightUnderstroke, markPath, markWidth } from "./markup.ts";
import type { Mark } from "./markup.ts";

const cases = [
  {
    name: "pen endpoints",
    mark: {
      kind: "pen",
      ink: "red",
      points: [
        { x: 20, y: 20, pressure: 0.5 },
        { x: 80, y: 20, pressure: 0.5 },
        { x: 80, y: 80, pressure: 0.5 },
      ],
    },
    on: [
      [20, 20],
      [80, 80],
    ],
    off: [[10, 100]],
  },
  {
    name: "single pen point",
    mark: { kind: "pen", ink: "orange", points: [{ x: 40, y: 50, pressure: 0.5 }] },
    on: [[40, 50]],
    off: [[50, 50]],
    under: [[36, 50]],
  },
  {
    name: "ellipse",
    mark: {
      kind: "ellipse",
      ink: "red",
      from: { x: 20, y: 30, pressure: 0.5 },
      to: { x: 100, y: 90, pressure: 0.5 },
    },
    on: [
      [20, 60],
      [100, 60],
      [60, 30],
      [60, 90],
    ],
    off: [[60, 60]],
    under: [[14, 60]],
  },
  {
    name: "reverse ellipse",
    mark: {
      kind: "ellipse",
      ink: "blue",
      from: { x: 100, y: 90, pressure: 0.5 },
      to: { x: 20, y: 30, pressure: 0.5 },
    },
    on: [
      [20, 60],
      [100, 60],
      [60, 30],
      [60, 90],
    ],
    off: [[60, 60]],
  },
  {
    name: "box",
    mark: {
      kind: "box",
      ink: "orange",
      from: { x: 20, y: 30, pressure: 0.5 },
      to: { x: 100, y: 90, pressure: 0.5 },
    },
    on: [
      [20, 60],
      [100, 60],
      [60, 30],
      [60, 90],
    ],
    off: [[60, 60]],
  },
  {
    name: "reverse box",
    mark: {
      kind: "box",
      ink: "blue",
      from: { x: 100, y: 90, pressure: 0.5 },
      to: { x: 20, y: 30, pressure: 0.5 },
    },
    on: [
      [20, 60],
      [100, 60],
      [60, 30],
      [60, 90],
    ],
    off: [[60, 60]],
  },
  {
    name: "arrow points right",
    mark: {
      kind: "arrow",
      ink: "red",
      from: { x: 20, y: 60, pressure: 0.5 },
      to: { x: 100, y: 60, pressure: 0.5 },
    },
    on: [
      [20, 60],
      [100, 60],
      [87, 52],
      [87, 68],
    ],
    off: [[20, 52]],
  },
  {
    name: "arrow points left",
    mark: {
      kind: "arrow",
      ink: "orange",
      from: { x: 100, y: 60, pressure: 0.5 },
      to: { x: 20, y: 60, pressure: 0.5 },
    },
    on: [
      [20, 60],
      [100, 60],
      [33, 52],
      [33, 68],
    ],
    off: [[100, 52]],
  },
  {
    name: "arrow points up",
    mark: {
      kind: "arrow",
      ink: "blue",
      from: { x: 60, y: 100, pressure: 0.5 },
      to: { x: 60, y: 20, pressure: 0.5 },
    },
    on: [
      [60, 100],
      [60, 20],
      [52, 33],
      [68, 33],
    ],
    off: [[52, 100]],
  },
  {
    name: "arrow points down",
    mark: {
      kind: "arrow",
      ink: "red",
      from: { x: 60, y: 20, pressure: 0.5 },
      to: { x: 60, y: 100, pressure: 0.5 },
    },
    on: [
      [60, 20],
      [60, 100],
      [52, 87],
      [68, 87],
    ],
    off: [[52, 20]],
  },
] as const satisfies readonly {
  readonly name: string;
  readonly mark: Mark;
  readonly on: readonly (readonly [number, number])[];
  readonly off: readonly (readonly [number, number])[];
  readonly under?: readonly (readonly [number, number])[];
}[];

export async function run(): Promise<string> {
  for (const background of [platformColors.light.bgBase, platformColors.dark.bgBase]) {
    const canvas = document.createElement("canvas");
    canvas.width = 128;
    canvas.height = 128;
    const context = canvas.getContext("2d", { willReadFrequently: true });

    if (context === null) throw new Error("Missing the real Canvas renderer");

    context.fillStyle = background;
    context.fillRect(0, 0, 128, 128);
    const original = context.getImageData(0, 0, 1, 1).data;
    const image = new Image();
    image.src = canvas.toDataURL("image/png");
    await image.decode();
    check(
      needsLightUnderstroke(image) === (background === platformColors.dark.bgBase),
      "Source pixels, not the UI theme, choose the under-stroke",
    );

    for (const row of cases) {
      const path = new Path2D(markPath(row.mark));
      context.lineWidth = markWidth(row.mark, 128, 128);
      context.lineCap = "round";
      context.lineJoin = "round";

      for (const point of row.on)
        check(
          context.isPointInStroke(path, point[0], point[1]),
          `${row.name}: the path must pass through ${point.join(",")}`,
        );

      for (const point of row.off)
        check(
          !context.isPointInStroke(path, point[0], point[1]),
          `${row.name}: the path must not pass through ${point.join(",")}`,
        );

      const file = await flattenMarkup(image, [row.mark], "marked.png");
      check(
        file.type === "image/png" && file.name === "marked.png",
        `${row.name}: PNG file boundary`,
      );
      const bitmap = await createImageBitmap(file);
      check(
        bitmap.width === 128 && bitmap.height === 128,
        `${row.name}: source dimensions must not be fitted or cropped`,
      );
      context.drawImage(bitmap, 0, 0);
      bitmap.close();

      for (const point of row.on) {
        const pixel = context.getImageData(point[0], point[1], 1, 1).data;
        check(
          pixel.some((channel, index) => Math.abs(channel - (original[index] ?? 0)) > 10),
          `${row.name}: the file must contain its mark at ${point.join(",")}`,
        );
      }

      for (const point of row.off) {
        const pixel = context.getImageData(point[0], point[1], 1, 1).data;
        check(
          pixel.every((channel, index) => channel === original[index]),
          `${row.name}: the file must leave unmarked pixels alone`,
        );
      }

      if (background === platformColors.dark.bgBase && "under" in row) {
        for (const point of row.under) {
          const under = context.getImageData(point[0], point[1], 1, 1).data;
          check(
            [0, 1, 2].every((channel) => (under[channel] ?? 0) > (original[channel] ?? 0) + 4),
            `${row.name}: the PNG contains a faint light under-stroke outside the multiply ink`,
          );
        }
      }

      context.drawImage(image, 0, 0);
      check(
        context
          .getImageData(0, 0, 1, 1)
          .data.every((channel, index) => channel === original[index]),
        `${row.name}: the original image stays untouched`,
      );
    }
  }

  return "passed";
}

function check(condition: boolean, message: string): void {
  if (!condition) throw new Error(message);
}
