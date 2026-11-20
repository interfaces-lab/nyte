import { flushSync } from "react-dom";
import { createRoot } from "react-dom/client";
import { MarkedPhoto } from "./markup-art.tsx";
import type { Tone } from "./markup-art.tsx";
import { orientation } from "./markup-geometry.ts";
import type { Edit, Size } from "./markup-geometry.ts";
import type { Mark } from "./markup.ts";

export async function exportMarkup(
  image: HTMLImageElement,
  edit: Edit,
  marks: readonly Mark[],
  tone: Tone,
  name: string,
): Promise<File> {
  await image.decode();
  const size: Size = { width: image.naturalWidth, height: image.naturalHeight };
  const width = Math.max(1, Math.round(edit.crop.w));
  const height = Math.max(1, Math.round(edit.crop.h));

  const url = URL.createObjectURL(
    new Blob([drawing(await embed(image, size), size, edit, marks, tone, { width, height })], {
      type: "image/svg+xml",
    }),
  );

  const art = new Image();

  art.src = url;
  await art.decode().finally(() => URL.revokeObjectURL(url));

  const canvas = document.createElement("canvas");

  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");

  if (context === null) throw new Error("The marked image could not be created. Try again.");
  context.drawImage(art, 0, 0);

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

function drawing(
  photo: string,
  size: Size,
  edit: Edit,
  marks: readonly Mark[],
  tone: Tone,
  output: Size,
): string {
  const host = document.createElement("div");
  const root = createRoot(host);

  flushSync(() =>
    root.render(
      <svg
        xmlns="http://www.w3.org/2000/svg"
        width={output.width}
        height={output.height}
        viewBox={`0 0 ${output.width} ${output.height}`}
      >
        <MarkedPhoto
          src={photo}
          size={size}
          transform={outputTransform(size, edit)}
          marks={marks}
          tone={tone}
          prefix="x"
        />
      </svg>,
    ),
  );

  const markup = new XMLSerializer().serializeToString(host.firstElementChild ?? host);

  root.unmount();

  return markup;
}

export function outputTransform(size: Size, edit: Edit): DOMMatrix {
  return new DOMMatrix()
    .translate(Math.max(1, Math.round(edit.crop.w)) / 2, Math.max(1, Math.round(edit.crop.h)) / 2)
    .rotate(edit.angle)
    .translate(-edit.crop.cx, -edit.crop.cy)
    .multiply(orientation(size, edit));
}

async function embed(image: HTMLImageElement, size: Size): Promise<string> {
  const canvas = document.createElement("canvas");

  canvas.width = size.width;
  canvas.height = size.height;
  canvas.getContext("2d")?.drawImage(image, 0, 0);

  const blob = await new Promise<Blob>((resolve, reject) =>
    canvas.toBlob((encoded) => {
      if (encoded === null) {
        reject(new Error("The image could not be read. Try opening it again."));

        return;
      }

      resolve(encoded);
    }, "image/png"),
  );

  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();

    reader.onload = () => {
      if (typeof reader.result === "string") resolve(reader.result);
      else reject(new Error("The image could not be read. Try opening it again."));
    };

    reader.onerror = () => reject(reader.error ?? new Error("The image could not be read."));
    reader.readAsDataURL(blob);
  });
}

export function imageTone(image: HTMLImageElement): Tone {
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

  return totals.weight > 0 && totals.luminance / totals.weight < 255 * 0.45 ? "dark" : "light";
}
