import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

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

const catalog = ["export const CANVAS_LIBRARIES = {", ...entries, "} as const;", ""].join("\n");

if (process.argv.includes("--check")) {
  if ((await readFile(target, "utf8")) !== catalog) {
    process.stderr.write(
      `${target} is stale for the installed libraries. Run: pnpm --dir packages/canvas libraries\n`,
    );
    process.exit(1);
  }
} else {
  await writeFile(target, catalog);
  process.stdout.write(`${target}: ${LIBRARIES.join(", ")}\n`);
}
