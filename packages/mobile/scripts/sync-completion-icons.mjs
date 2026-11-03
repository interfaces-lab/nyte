import { mkdir, writeFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { glyphs } from "./icon-set/selected.generated.mjs";

const markup = Object.fromEntries(
  Object.entries(glyphs).map(([name, Glyph]) => [name, renderToStaticMarkup(createElement(Glyph))]),
);

const directory = new URL("../build/", import.meta.url);

await mkdir(directory, { recursive: true });

await writeFile(
  new URL("completion-icons.json", directory),
  `${JSON.stringify(markup, null, 2)}\n`,
);
