import { mkdir, writeFile } from "node:fs/promises";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { IconBuildingBlocks } from "central-icons/IconBuildingBlocks";
import { IconChanges } from "central-icons/IconChanges";
import { IconCmd } from "central-icons/IconCmd";
import { IconFolder1 } from "central-icons/IconFolder1";

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
