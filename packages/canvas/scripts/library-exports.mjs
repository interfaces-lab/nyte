import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

/** The libraries a canvas may import, in the order the tool lists them. */
const LIBRARIES = ["three", "d3-array", "d3-scale", "d3-shape", "d3-hierarchy", "d3-force"];

const target = fileURLToPath(
  new URL("../../plugin/src/canvas/canvas-libraries.ts", import.meta.url),
);

const { dependencies } = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

const entries = [];

for (const name of LIBRARIES) {
  const names = `"${Object.keys(await import(name))
    .toSorted()
    .join(" ")}"`;
  const exports = names.length > 84 ? `exports:\n      ${names}` : `exports: ${names}`;
  entries.push(
    `  ${/^[a-z]+$/.test(name) ? name : `"${name}"`}: {\n    version: "${dependencies[name]}",\n    ${exports},\n  },`,
  );
}

await writeFile(
  target,
  [
    "/**",
    " * The libraries a canvas may import, each pinned in packages/canvas and",
    " * served by the shell as its own chunk, with every name its module exports.",
    " * Written by `packages/canvas/scripts/library-exports.mjs`; a canvas test",
    " * checks it against the installed packages.",
    " */",
    "export const CANVAS_LIBRARIES = {",
    ...entries,
    "} as const;",
    "",
  ].join("\n"),
);
process.stdout.write(`${target}: ${LIBRARIES.join(", ")}\n`);
