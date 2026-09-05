import { readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const KIB = 1_024;
// The renderer entry carries React, the router, StyleX output, and Base UI's
// menu and dialog machinery; everything heavier (diffs, highlighting) is lazy.
const budgets = {
  main: 32 * KIB,
  preload: 16 * KIB,
  rendererEntry: 1_300 * KIB,
};
const desktopRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
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
