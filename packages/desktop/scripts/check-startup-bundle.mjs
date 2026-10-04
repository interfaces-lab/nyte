import { glob, readFile, stat } from "node:fs/promises";
import { join } from "node:path";
import { failure, formatSize, green, red, table } from "./terminal.mjs";

const KIB = 1_024;

// Grammars live in the worker, the terminal wasm is its own asset, and provider
// SDKs load on first request. Clerk has a separate entry loaded by an account command.
const budgets = {
  main: 700 * KIB,
  preload: 16 * KIB,
  renderer: 4_600 * KIB,
};

const desktopRoot = join(import.meta.dirname, "..");

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

const manifest = JSON.parse(await readFile(join(rendererRoot, ".vite", "manifest.json"), "utf8"));

const startupFiles = html
  .matchAll(/<(?:script|link)\b[^>]*>/gu)
  .filter(([tag]) => tag.startsWith("<script") || /rel="modulepreload"/u.test(tag))
  .map(([tag]) => tag.match(/(?:src|href)="([^"]+)"/u)?.[1]?.replace(/^\.?\//u, ""))
  .filter((file) => file !== undefined)
  .toArray();

if (startupFiles.length === 0) {
  failure("Cannot find the renderer entry in out/renderer/index.html");
  process.exit(1);
}

const startupChunks = new Set();

for (const file of startupFiles) {
  const entry = Object.entries(manifest).find(([, chunk]) => chunk.file === file);

  if (entry === undefined) throw new Error(`Missing renderer manifest entry for ${file}`);
  const pending = [entry[0]];

  for (const key of pending) {
    if (startupChunks.has(key)) continue;
    startupChunks.add(key);
    const chunk = manifest[key];

    if (chunk === undefined) throw new Error(`Missing renderer manifest chunk ${key}`);
    pending.push(...(chunk.imports ?? []));
  }
}

const rendererSizes = await Promise.all(
  [...startupChunks].map(async (key) => (await stat(join(rendererRoot, manifest[key].file))).size),
);

const sizes = {
  main: (await stat(join(desktopRoot, "out", "main", "index.js"))).size,
  preload: (await stat(preloadPath)).size,
  renderer: rendererSizes.reduce((total, size) => total + size, 0),
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
