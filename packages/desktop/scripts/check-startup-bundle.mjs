import { glob, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KIB = 1_024;
// The renderer entry carries React, the router, StyleX output, and Base UI's
// menu and dialog machinery, plus all desktop components. Syntax grammars stay in the worker.
// Component navigation never fetches a JavaScript chunk.
const budgets = {
  main: 900 * KIB,
  preload: 16 * KIB,
  rendererEntry: 4_100 * KIB,
};
const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
// Keep desktop-owned code static even when a new component is added later.
for await (const path of glob("src/**/*.{ts,tsx}", { cwd: desktopRoot })) {
  const source = await readFile(join(desktopRoot, path), "utf8");
  if (/(?:^|[^\w.])(?:import|lazy|lazyRouteComponent)\s*\(/m.test(source)) {
    throw new Error(`${path} contains a deferred module import; use a static import`);
  }
}

// Workspace packages export TypeScript source. Node cannot strip types inside
// packaged node_modules, so none may remain external in the main bundle.
for await (const path of glob("out/main/**/*.js", { cwd: desktopRoot })) {
  const source = await readFile(join(desktopRoot, path), "utf8");
  if (/(?:from\s*|import\s*\(?\s*|require\s*\(\s*)["']@nyte-ai\//u.test(source)) {
    throw new Error(`${path} imports unbundled workspace TypeScript; bundle all @nyte-ai packages`);
  }
}

const rendererRoot = join(desktopRoot, "out", "renderer");
const html = await readFile(join(rendererRoot, "index.html"), "utf8");
const preloadPath = join(desktopRoot, "out", "preload", "index.js");
const preloadSource = await readFile(preloadPath, "utf8");
const rendererEntry = html.match(/<script[^>]+src="([^"]+)"/)?.[1];
if (rendererEntry === undefined) throw new Error("Cannot find the renderer entry in index.html");

// Electron's sandboxed preload only exposes its limited `require` polyfill.
// Catch dependency externalization here instead of shipping another blank UI.
const unsupportedPreloadRequires = [
  ...new Set(
    [...preloadSource.matchAll(/\brequire\(["']([^"']+)["']\)/g)].map((match) => match[1]),
  ),
].filter((specifier) => specifier !== "electron");
if (unsupportedPreloadRequires.length > 0) {
  throw new Error(
    `sandboxed preload contains external requires: ${unsupportedPreloadRequires.join(", ")}`,
  );
}

const sizes = {
  main: (await stat(join(desktopRoot, "out", "main", "index.js"))).size,
  preload: (await stat(preloadPath)).size,
  rendererEntry: (await stat(join(rendererRoot, rendererEntry))).size,
};

for (const name of Object.keys(budgets)) {
  if (sizes[name] > budgets[name]) {
    throw new Error(
      `${name} startup entry is ${formatSize(sizes[name])}; budget is ${formatSize(budgets[name])}`,
    );
  }
}

process.stdout.write(
  `startup entries: main ${formatSize(sizes.main)}, preload ${formatSize(sizes.preload)}, renderer ${formatSize(sizes.rendererEntry)}\n`,
);

function formatSize(bytes) {
  return `${(bytes / KIB).toFixed(1)} KiB`;
}
