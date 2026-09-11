import { glob, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { failure, formatSize, green, red, table } from "./terminal.mjs";

const KIB = 1_024;
// Grammars live in the worker, the terminal wasm is its own asset, and provider
// SDKs load on first request. Nothing else is allowed to defer.
const budgets = {
  main: 700 * KIB,
  preload: 16 * KIB,
  renderer: 4_200 * KIB,
};
const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const problems = [];

for await (const path of glob("src/**/*.{ts,tsx}", { cwd: desktopRoot })) {
  const source = await readFile(join(desktopRoot, path), "utf8");
  if (/(?:^|[^\w.])(?:import|lazy|lazyRouteComponent)\s*\(/m.test(source)) {
    problems.push(`${path} contains a deferred module import; use a static import`);
  }
}

// Workspace packages ship TypeScript source, which Node cannot load from node_modules.
for await (const path of glob("out/main/**/*.js", { cwd: desktopRoot })) {
  const source = await readFile(join(desktopRoot, path), "utf8");
  if (/(?:from\s*|import\s*\(?\s*|require\s*\(\s*)["']@nyte-ai\//u.test(source)) {
    problems.push(`${path} imports unbundled workspace TypeScript; bundle all @nyte-ai packages`);
  }
}

const rendererRoot = join(desktopRoot, "out", "renderer");
const html = await readFile(join(rendererRoot, "index.html"), "utf8");
const preloadPath = join(desktopRoot, "out", "preload", "index.js");
const preloadSource = await readFile(preloadPath, "utf8");
const rendererEntry = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
if (rendererEntry === undefined) {
  failure("Cannot find the renderer entry in out/renderer/index.html");
  process.exit(1);
}

// The sandboxed preload can only require "electron".
const unsupportedPreloadRequires = [
  ...new Set(
    [...preloadSource.matchAll(/\brequire\(["']([^"']+)["']\)/g)].map((match) => match[1]),
  ),
].filter((specifier) => specifier !== "electron");
if (unsupportedPreloadRequires.length > 0) {
  problems.push(
    `sandboxed preload contains external requires: ${unsupportedPreloadRequires.join(", ")}`,
  );
}

const sizes = {
  main: (await stat(join(desktopRoot, "out", "main", "index.js"))).size,
  preload: (await stat(preloadPath)).size,
  renderer: (await stat(join(rendererRoot, rendererEntry))).size,
};

const rows = [];
for (const [name, budget] of Object.entries(budgets)) {
  const size = sizes[name];
  const over = size > budget;
  if (over) problems.push(`${name} startup entry is over budget`);
  rows.push([
    name,
    formatSize(size),
    `of ${formatSize(budget)}`,
    over ? red(`over by ${formatSize(size - budget)}`) : green(`${formatSize(budget - size)} free`),
  ]);
}

process.stdout.write(table(rows, { align: ["left", "right", "left", "left"] }));
if (problems.length > 0) {
  for (const problem of problems) failure(problem);
  process.exit(1);
}
