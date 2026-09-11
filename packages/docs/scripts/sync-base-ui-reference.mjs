#!/usr/bin/env node
/*
 * Vendors Base UI's component documentation into content/cloud/headless.
 *
 * Every `@nyte-ai/ui/<name>` subpath is a one-line re-export of a Base UI
 * namespace, so the accessibility rules, anatomy, and props tables that
 * matter are Base UI's own. This script copies them word for word (MIT,
 * (c) Material-UI SAS) and prepends a Nyte header that says which subpath
 * to import and which desktop files consume it.
 *
 *   node scripts/sync-base-ui-reference.mjs           # rewrite pages
 *   node scripts/sync-base-ui-reference.mjs --check   # fail if pages are stale
 *
 * Pin BASE_UI_REF to the tag matching packages/ui's @base-ui/react version.
 */
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execSync } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";

const BASE_UI_REF = "master";
const RAW = `https://raw.githubusercontent.com/mui/base-ui/${BASE_UI_REF}/docs/src/app/(docs)/react/components`;

const here = path.dirname(fileURLToPath(import.meta.url));
const docsRoot = path.resolve(here, "..");
const workspaceRoot = path.resolve(docsRoot, "../..");
const outDir = path.join(docsRoot, "content/cloud/headless");
// Per-part reference tables. Primitive pages `<include>` the parts they wrap.
const partsDir = path.join(docsRoot, "content/base-ui-reference");

/** Subpath → Base UI docs slug. Order is the sidebar order. */
const subpaths = [
  "alert-dialog",
  "autocomplete",
  "button",
  "collapsible",
  "context-menu",
  "dialog",
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

/** Wrapped by a styled primitive but not re-exported headless: parts only, no page. */
const partsOnly = ["avatar", "input"];

const check = process.argv.includes("--check");

async function fetchText(url) {
  const response = await fetch(url);
  if (!response.ok) throw new Error(`${response.status} ${url}`);
  return response.text();
}

function consumers(subpath) {
  const needle = `"@nyte-ai/ui/${subpath}"`;
  try {
    const out = execSync(
      `grep -rl --include=*.ts --include=*.tsx -F '${needle}' packages/desktop/src packages/demo 2>/dev/null || true`,
      { cwd: workspaceRoot, encoding: "utf8" },
    );
    return out
      .split("\n")
      .filter(Boolean)
      .map((file) => file.replace(/^packages\//, ""))
      .sort();
  } catch {
    return [];
  }
}

/** Keep the prose above "## API reference"; drop the docs site's own JSX. */
function prose(pageMdx) {
  const [head] = pageMdx.split(/^## API reference$/m);
  const lines = head.split("\n");
  const kept = [];
  let subtitle = "";
  let skippingMeta = false;
  let inSubtitle = false;
  for (const line of lines) {
    if (line.startsWith("# ")) continue;
    if (line.startsWith("<Subtitle>")) {
      const rest = line.replace("<Subtitle>", "");
      inSubtitle = !rest.includes("</Subtitle>");
      subtitle = rest.replace("</Subtitle>", "").trim();
      continue;
    }
    if (inSubtitle) {
      if (line.includes("</Subtitle>")) inSubtitle = false;
      else subtitle = `${subtitle} ${line.trim()}`.trim();
      continue;
    }
    if (line.startsWith("<Meta")) {
      skippingMeta = !line.endsWith("/>");
      continue;
    }
    if (skippingMeta) {
      if (line.includes("/>")) skippingMeta = false;
      continue;
    }
    if (/^import .* from '\.{1,2}\//.test(line)) continue;
    if (/^<Demo[A-Za-z]* \/>$/.test(line)) continue;
    if (line.startsWith("[//]: #")) continue;
    kept.push(line);
  }
  return {
    subtitle,
    body: kept
      .join("\n")
      .replace(/\n{3,}/g, "\n\n")
      .trim(),
  };
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

function title(subpath) {
  return subpath
    .split("-")
    .map((word) => word[0].toUpperCase() + word.slice(1))
    .join(" ");
}

function page(subpath, pageMdx, typesMd) {
  const { subtitle, body } = prose(pageMdx);
  const used = consumers(subpath);
  const consumerList =
    used.length === 0
      ? "_No consumer in the repo yet._"
      : used.map((file) => `- \`${file}\``).join("\n");

  return `---
title: ${title(subpath)}
description: "${subtitle.replace(/"/g, '\\"')}"
---

{/* Generated by scripts/sync-base-ui-reference.mjs. Edit the script, not this file. */}

## In Nyte

\`\`\`ts title="Import"
import { ${title(subpath).replace(/ /g, "")} } from "@nyte-ai/ui/${subpath}";
\`\`\`

\`@nyte-ai/ui/${subpath}\` re-exports the Base UI namespace unchanged. There is no Nyte styling on
this subpath; the consumer owns every class, StyleX style, and layout decision. Base UI owns the
interaction model, keyboard handling, focus management, and ARIA below.

Consumed by:

${consumerList}

The rest of this page is Base UI's documentation for \`@base-ui/react/${subpath}\`, reproduced
verbatim under the MIT license, © Material-UI SAS. Component paths in examples refer to the Base UI
package; in Nyte, import from the subpath above.

${body}

${reference(typesMd)}
`;
}

async function main() {
  await mkdir(outDir, { recursive: true });
  let stale = 0;
  for (const subpath of subpaths) {
    const [pageMdx, typesMd] = await Promise.all([
      fetchText(`${RAW}/${subpath}/page.mdx`),
      fetchText(`${RAW}/${subpath}/types.md`),
    ]);
    const outputs = [[path.join(outDir, `${subpath}.mdx`), page(subpath, pageMdx, typesMd)]];
    const partDir = path.join(partsDir, subpath);
    await mkdir(partDir, { recursive: true });
    for (const [name, body] of parts(typesMd)) {
      outputs.push([path.join(partDir, `${name}.md`), `${body}\n`]);
    }
    for (const [file, next] of outputs) {
      if (!(await writeIfChanged(file, next))) continue;
      stale += 1;
      console[check ? "error" : "log"](
        `${check ? "stale" : "wrote"}: ${path.relative(docsRoot, file)}`,
      );
    }
  }
  for (const slug of partsOnly) {
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
