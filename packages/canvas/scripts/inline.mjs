import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { CANVAS_RUNTIME } from "@nyte-ai/plugin/canvas/protocol";

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
  `script-src '${hash}' 'self' blob:`,
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

await writeFile(
  join(dist, "shell-inline.js"),
  `export const shell = ${JSON.stringify({ runtime: CANVAS_RUNTIME, html: inlined })};\n`,
);
await writeFile(
  join(dist, "shell-inline.d.ts"),
  "export declare const shell: { readonly runtime: number; readonly html: string };\n",
);
// The libraries beside the inline shell, by path from it, for a host that serves the shell at a URL of its own (a headless preview); a WebView without one cannot load them.
const libraries = Object.fromEntries(
  await Promise.all(
    (await readdir(join(shell, "libraries"), { recursive: true }))
      .filter((path) => path.endsWith(".js"))
      .toSorted()
      .map(async (path) => [
        `libraries/${path}`,
        await readFile(join(shell, "libraries", path), "utf8"),
      ]),
  ),
);

await writeFile(
  join(dist, "shell-libraries.js"),
  `export const libraries = ${JSON.stringify(libraries)};\n`,
);
await writeFile(
  join(dist, "shell-libraries.d.ts"),
  "export declare const libraries: Readonly<Record<string, string>>;\n",
);
process.stdout.write(
  `dist/shell-inline.js: ${String(Math.round(inlined.length / 1024))} KB, script ${hash}; dist/shell-libraries.js: ${Object.keys(libraries).length} files\n`,
);
