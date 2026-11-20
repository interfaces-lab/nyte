import { createElement } from "react";

import type { Glyph } from "../icon-names.ts";

const MOON = [" ##. ", "##.#.", "###..", ".#...", " ... "];

const squares = (mark: string): string =>
  MOON.flatMap((row, y) =>
    row.split("").flatMap((cell, x) => (cell === mark ? [`M${x * 3} ${y * 3}h2v2h-2z`] : [])),
  ).join("");

const LIT = squares("#");

const EARTHSHINE = squares(".");

export const NyteGlyph: Glyph = (glyphProps) =>
  createElement(
    "svg",
    {
      width: glyphProps.size,
      height: glyphProps.size,
      viewBox: "0 0 14 14",
      fill: "currentColor",
      // oxlint-disable-next-line anti-slop/no-shape-in-symbol-names -- React's name for the SVG shape-rendering attribute
      shapeRendering: "crispEdges",
      "aria-hidden": true,
      xmlns: "http://www.w3.org/2000/svg",
    },
    createElement("path", { d: EARTHSHINE, opacity: 0.22 }),
    createElement("path", { d: LIT }),
  );
