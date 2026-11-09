import { readFile, writeFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";

const target = fileURLToPath(
  new URL("../../plugin/src/canvas/canvas-libraries.ts", import.meta.url),
);

const { dependencies } = JSON.parse(
  await readFile(new URL("../package.json", import.meta.url), "utf8"),
);

const LIBRARIES = [
  "three",
  "d3-array",
  "d3-scale",
  "d3-shape",
  "d3-hierarchy",
  "d3-force",
  ...Object.keys(dependencies).filter((name) => name.startsWith("@nivo/")),
];

const versions = [];

const exports = [];

for (const name of LIBRARIES) {
  const key = /^[a-z]+$/.test(name) ? name : `"${name}"`;
  const names = `"${Object.keys(await import(name))
    .toSorted()
    .join(" ")}"`;
  versions.push(`  ${key}: "${dependencies[name]}",`);
  exports.push(
    key.length + names.length + 5 > 100 ? `  ${key}:\n    ${names},` : `  ${key}: ${names},`,
  );
}

const catalog = [
  "export const CANVAS_LIBRARY_VERSIONS = {",
  ...versions,
  "} as const;",
  "",
  "export const CANVAS_LIBRARY_EXPORTS = {",
  ...exports,
  "} satisfies Record<keyof typeof CANVAS_LIBRARY_VERSIONS, string>;",
  "",
].join("\n");

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
