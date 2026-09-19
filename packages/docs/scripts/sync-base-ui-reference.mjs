#!/usr/bin/env node
/*
 * Vendors Base UI's generated API tables into content/base-ui-reference.
 *
 * Every `@nyte-ai/ui` component that wraps or re-exports Base UI gets one
 * markdown file per part, copied word for word (MIT, (c) Material-UI SAS).
 * The hand-written pages under content/cloud/components pull the parts they
 * document in with `<include>`.
 *
 *   node scripts/sync-base-ui-reference.mjs           # rewrite the parts files
 *   node scripts/sync-base-ui-reference.mjs --check   # fail if they are stale
 *
 * Pin BASE_UI_REF to the tag matching packages/ui's @base-ui/react version.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE_UI_REF = "master";
const RAW = `https://raw.githubusercontent.com/mui/base-ui/${BASE_UI_REF}/docs/src/app/(docs)/react/components`;

const here = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(here, "..");
// Per-part reference tables. Component pages `<include>` the parts they wrap.
const partsDir = path.join(docsRoot, "content/base-ui-reference");

/** Base UI docs slugs. Avatar and Input have a styled wrapper but no subpath. */
const slugs = [
  "alert-dialog",
  "autocomplete",
  "avatar",
  "button",
  "collapsible",
  "context-menu",
  "dialog",
  "input",
  "menu",
  "number-field",
  "popover",
  "preview-card",
  "select",
  "slider",
  "switch",
  "tabs",
  "toggle",
  "toggle-group",
  "toolbar",
  "tooltip",
];

const check = process.argv.includes("--check");

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

/** The generated reference, minus its autogen banner. */
function reference(typesMd) {
  return typesMd
    .split("\n")
    .filter((line) => !line.startsWith("# ") && !line.startsWith("[//]: types.ts"))
    .join("\n")
    .replace(/^## API Reference$/m, "## API reference")
    .trim();
}

/** Split the reference into `### Part` sections keyed by part name. */
function parts(typesMd) {
  const result = new Map();
  const sections = reference(typesMd).split(/^(?=### )/m);
  for (const section of sections) {
    const match = /^### ([A-Za-z.]+)\n/.exec(section);
    if (!match) continue;
    const name = match[1];
    // "Root.Props", "Root.State" and friends are type aliases, not parts.
    if (name.includes(".")) continue;
    result.set(name, section.replace(/^### [A-Za-z.]+\n/, "").trim());
  }
  return result;
}

async function writeIfChanged(file, next) {
  const current = await readFile(file, "utf8").catch(() => null);
  if (current === next) return false;
  if (!check) await writeFile(file, next);
  return true;
}

async function main() {
  let stale = 0;
  for (const slug of slugs) {
    const typesMd = await fetchText(`${RAW}/${slug}/types.md`);
    const partDir = path.join(partsDir, slug);
    await mkdir(partDir, { recursive: true });
    for (const [name, body] of parts(typesMd)) {
      const file = path.join(partDir, `${name}.md`);
      if (!(await writeIfChanged(file, `${body}\n`))) continue;
      stale += 1;
      console[check ? "error" : "log"](
        `${check ? "stale" : "wrote"}: ${path.relative(docsRoot, file)}`,
      );
    }
  }
  if (check && stale > 0) process.exit(1);
}

await main();
