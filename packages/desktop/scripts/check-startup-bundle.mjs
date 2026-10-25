import { glob, readFile, stat } from "node:fs/promises";
import { dirname, join } from "node:path";
import { failure, formatSize, green, red, table } from "./terminal.mjs";

const KIB = 1_024;

const budgets = {
  main: 116 * KIB,
  host: 1_500 * KIB,
  preload: 8 * KIB,
  renderer: 3_225 * KIB,
  css: 290 * KIB,
};

const desktopRoot = join(import.meta.dirname, "..");

const problems = [];

for await (const path of glob("src/**/*.{ts,tsx}", { cwd: desktopRoot })) {
  const source = await readFile(join(desktopRoot, path), "utf8");

  if (/(?:^|[^\w.])(?:import|lazy|lazyRouteComponent)\s*\(/m.test(source)) {
    problems.push(`${path} contains a deferred module import; use a static import`);
  }
}

const workspaceImport = /(?:from\s*|import\s*\(?\s*|require\s*\(\s*)["']@nyte-ai\//u;

for await (const path of glob("out/main/**/*.js", { cwd: desktopRoot })) {
  const source = await readFile(join(desktopRoot, path), "utf8");

  if (workspaceImport.test(source)) {
    problems.push(`${path} imports unbundled workspace TypeScript; bundle all @nyte-ai packages`);
  }
}

async function staticGraph(entry) {
  const files = new Set([entry]);

  for (const file of files) {
    const source = await readFile(file, "utf8");

    for (const [, specifier] of source.matchAll(
      /(?:^|[;}\s])(?:import|export)\s*(?:[\w$*{},\s]+?\s*from\s*)?["'](\.{1,2}\/[^"']+)["']/gu,
    ))
      files.add(join(dirname(file), specifier));
  }

  return [...files];
}

async function graphSize(entry) {
  const files = await staticGraph(join(desktopRoot, "out", "main", entry));
  const sizes = await Promise.all(files.map(async (file) => (await stat(file)).size));

  return sizes.reduce((total, size) => total + size, 0);
}

const rendererRoot = join(desktopRoot, "out", "renderer");

const html = await readFile(join(rendererRoot, "index.html"), "utf8");

const preloadPath = join(desktopRoot, "out", "preload", "index.js");

for await (const path of glob("out/preload/**/*.js", { cwd: desktopRoot })) {
  const source = await readFile(join(desktopRoot, path), "utf8");

  const unsupported = [
    ...new Set([...source.matchAll(/\brequire\(["']([^"']+)["']\)/g)].map((match) => match[1])),
  ].filter((specifier) => specifier !== "electron");

  if (unsupported.length > 0) {
    problems.push(`${path} contains external requires: ${unsupported.join(", ")}`);
  }
}

const manifest = JSON.parse(await readFile(join(rendererRoot, ".vite", "manifest.json"), "utf8"));

const startupTags = html.matchAll(/<(?:script|link)\b[^>]*>/gu).toArray();

function startupAssets(test) {
  return startupTags
    .filter(([tag]) => test(tag))
    .map(([tag]) => tag.match(/(?:src|href)="([^"]+)"/u)?.[1]?.replace(/^\.?\//u, ""))
    .filter((file) => file !== undefined);
}

const startupFiles = startupAssets(
  (tag) => tag.startsWith("<script") || /rel="modulepreload"/u.test(tag),
);

const stylesheets = startupAssets((tag) => /rel="stylesheet"/u.test(tag));

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
  main: await graphSize("index.js"),
  host: await graphSize("host-entry.js"),
  preload: (await stat(preloadPath)).size,
  renderer: rendererSizes.reduce((total, size) => total + size, 0),
  css: (
    await Promise.all(stylesheets.map(async (file) => (await stat(join(rendererRoot, file))).size))
  ).reduce((total, size) => total + size, 0),
};

const rows = [];

for (const [name, budget] of Object.entries(budgets)) {
  const size = sizes[name];
  const over = size > budget;

  if (over && !process.argv.includes("--warn-budgets")) {
    problems.push(`${name} startup entry is over budget`);
  }

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
