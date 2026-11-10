#!/usr/bin/env node
/**
 * Vendors Base UI's generated API tables into content/base-ui-reference.
 *
 * Every `@nyte-ai/ui` component built on Base UI gets one
 * markdown file per part and supporting type (MIT, (c) Material-UI SAS).
 * Correct upstream wording here, not in the generated files.
 * The hand-written pages under content/design/components pull the parts they
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

const BASE_UI_REF = "v1.9.0";

const RAW = `https://raw.githubusercontent.com/mui/base-ui/${BASE_UI_REF}/docs/src/app/(docs)/react/components`;

const here = path.dirname(fileURLToPath(import.meta.url));

const docsRoot = path.resolve(here, "..");

const partsDir = path.join(docsRoot, "content/base-ui-reference");

const slugs = [
  "alert-dialog",
  "autocomplete",
  "avatar",
  "button",
  "checkbox",
  "collapsible",
  "combobox",
  "context-menu",
  "dialog",
  "input",
  "menu",
  "meter",
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

  if (!response.ok) {
    throw new Error(
      `Could not fetch Base UI reference (${response.status}): ${url}. Check your connection and the pinned BASE_UI_REF, then rerun sync:base-ui.`,
    );
  }

  return response.text();
}

function reference(typesMd) {
  const sections = typesMd.split(/^## /m);
  const api = sections.find((section) => section.startsWith("API Reference\n"));

  if (api === undefined) {
    throw new Error(
      `Base UI ${BASE_UI_REF} has no API Reference section. Check the release's types.md headings and update reference(), then rerun sync:base-ui.`,
    );
  }

  const additional = sections.find((section) => section.startsWith("Additional Types\n"));

  return `${api.replace(/^API Reference\n/, "")}\n${additional?.replace(/^Additional Types\n/, "") ?? ""}`
    .replace(
      "Whether the tooltip contents can be hovered without closing the tooltip.",
      "Whether to close the tooltip when the pointer moves onto its contents.",
    )
    .replace(
      "Whether the toggle button is currently pressed.&#xA;This is the uncontrolled counterpart of `pressed`.",
      "Whether the toggle button is initially pressed.&#xA;This is the uncontrolled counterpart of `pressed`.",
    )
    .replaceAll(
      "[developer.mozilla.org](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/autocomplete)",
      "[HTML autocomplete attribute reference](https://developer.mozilla.org/en-US/docs/Web/HTML/Reference/Attributes/autocomplete)",
    )
    .trim();
}

function parts(typesMd) {
  const result = new Map();
  const sections = reference(typesMd).split(/^(?=### )/m);

  for (const section of sections) {
    const match = /^### ([A-Za-z.]+)\n/.exec(section);

    if (!match) continue;
    const name = match[1];

    if (name.includes(".") || /(?:DataAttributes|CssVariables)$/.test(name)) continue;
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

  if (check && stale > 0) {
    console.error("Run pnpm --dir packages/docs sync:base-ui to refresh these references.");
    process.exitCode = 1;
  }
}

await main();
