import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { CANVAS_RUNTIME, LIBRARY_EXPORTS } from "@nyte-ai/plugin/canvas/protocol";
import { build } from "vite";

const dist = fileURLToPath(new URL("../dist/", import.meta.url));

const shell = join(dist, "shell");

const html = await readFile(join(shell, "index.html"), "utf8");

const scriptTag = /<script type="module"[^>]*src="\.\/(assets\/[^"]+)"><\/script>/;

const styleTag = /<link rel="stylesheet"[^>]*href="\.\/(assets\/[^"]+)">/;

const fontTag = /\s*<link rel="stylesheet" href="\.\/fonts\.css" \/>/;

const scriptMatch = scriptTag.exec(html);

const styleMatch = styleTag.exec(html);

if (scriptMatch === null || styleMatch === null)
  throw new Error("dist/shell/index.html has no module script or stylesheet to inline.");

const script = (await readFile(join(shell, scriptMatch[1]), "utf8")).replace(
  /<\/script/g,
  "<\\/script",
);

const css = (await readFile(join(shell, styleMatch[1]), "utf8")).replace(
  /@font-face\{[^}]*\}/g,
  "",
);

const hash = `sha256-${createHash("sha256").update(script).digest("base64")}`;

const csp = [
  "default-src 'none'",
  `script-src '${hash}' blob:`,
  "style-src 'unsafe-inline'",
  "img-src data: blob:",
  "connect-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

// Replacer functions: a plain replacement string would expand `$&` and `$'` inside the bundle.
const inlined = html
  .replace(fontTag, "")
  .replace(
    '<meta charset="UTF-8" />',
    () =>
      `<meta charset="UTF-8" />\n    <meta http-equiv="Content-Security-Policy" content="${csp}" />`,
  )
  .replace(styleMatch[0], () => `<style>${css}</style>`)
  .replace(scriptMatch[0], () => `<script type="module">${script}</script>`);

/**
 * Each library as one ES module with no imports, by its specifier: the inline
 * shell has no URL to import a shared chunk from, so it imports a library's
 * source from a blob its client hands it.
 */
const libraries = {};

for (const name of Object.keys(LIBRARY_EXPORTS)) {
  const output = await build({
    configFile: fileURLToPath(new URL("../vite.libraries.config.ts", import.meta.url)),
    logLevel: "warn",
    build: {
      write: false,
      emptyOutDir: false,
      rolldownOptions: { input: name, output: { codeSplitting: false } },
    },
  });

  const chunks = (Array.isArray(output) ? output : [output]).flatMap((result) => result.output);

  if (chunks.length !== 1 || chunks[0].type !== "chunk")
    throw new Error(`The ${name} library did not build to one module.`);
  libraries[name] = chunks[0].code;
}

await writeFile(
  join(dist, "shell-inline.js"),
  `export const shell = ${JSON.stringify({ runtime: CANVAS_RUNTIME, html: inlined, libraries })};\n`,
);
await writeFile(
  join(dist, "shell-inline.d.ts"),
  'import type { CanvasLibrary } from "@nyte-ai/plugin/canvas/protocol";\nexport declare const shell: { readonly runtime: number; readonly html: string; readonly libraries: Readonly<Record<CanvasLibrary, string>> };\n',
);
/** Every file of the shell directory, base64 by its path from it, for a host that serves the shell itself at a URL of its own (a headless preview), as the chat's clients serve dist/shell. */
const files = Object.fromEntries(
  await Promise.all(
    (await readdir(shell, { recursive: true, withFileTypes: true }))
      .filter((entry) => entry.isFile())
      .map((entry) => join(entry.parentPath, entry.name))
      .toSorted()
      .map(async (path) => [
        relative(shell, path).split(sep).join("/"),
        (await readFile(path)).toString("base64"),
      ]),
  ),
);

await writeFile(join(dist, "shell-files.js"), `export const files = ${JSON.stringify(files)};\n`);
await writeFile(
  join(dist, "shell-files.d.ts"),
  "export declare const files: Readonly<Record<string, string>>;\n",
);
process.stdout.write(
  `dist/shell-inline.js: ${String(Math.round(inlined.length / 1024))} KB, script ${hash}; dist/shell-files.js: ${Object.keys(files).length} files\n`,
);
