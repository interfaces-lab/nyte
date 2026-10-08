import { mkdir, writeFile } from "node:fs/promises";
import { createElement } from "../../ui/node_modules/react/index.js";
import { renderToStaticMarkup } from "../../ui/node_modules/react-dom/server.node.js";
import { IconBuildingBlocks } from "../../ui/node_modules/central-icons/IconBuildingBlocks/index.mjs";
import { IconChanges } from "../../ui/node_modules/central-icons/IconChanges/index.mjs";
import { IconCmd } from "../../ui/node_modules/central-icons/IconCmd/index.mjs";
import { IconFolder1 } from "../../ui/node_modules/central-icons/IconFolder1/index.mjs";

const glyphs = {
  file: IconChanges,
  folder: IconFolder1,
  command: IconCmd,
  skill: IconBuildingBlocks,
};

const markup = Object.fromEntries(
  Object.entries(glyphs).map(([name, Glyph]) => [
    name,
    renderToStaticMarkup(createElement(Glyph, { mode: "raw", ariaHidden: true })),
  ]),
);

const directory = new URL("../build/", import.meta.url);

await mkdir(directory, { recursive: true });

await writeFile(
  new URL("completion-icons.json", directory),
  `${JSON.stringify(markup, null, 2)}\n`,
);
