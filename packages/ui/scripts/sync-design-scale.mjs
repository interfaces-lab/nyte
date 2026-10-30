/**
 * Writes the design-scale lint's tables from the tokens, so the lint can never
 * suggest a step the tokens don't declare: every `space` handle, and every
 * handle that sizes a box, as px at the default size and a fine pointer.
 * `--check` fails when the written tables are stale.
 */
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readGroups } from "./tokens.mjs";

const packages = join(dirname(fileURLToPath(import.meta.url)), "../..");

const outputPath = join(packages, "app/lint/design-scale.tokens.json");

const tokenFiles = ["ui/src/styles/theme.stylex.ts", "ui/src/styles/tokens.stylex.ts"];

/** The handles that size a box: whole groups, or the named keys of one. */
const boxHandles = {
  glyph: "all",
  control: "all",
  avatar: "all",
  target: ["min"],
  checkbox: ["sizeMd", "sizeLg"],
  row: ["heightMd", "heightLg"],
};

const declared = new Map();

for (const file of tokenFiles) {
  for (const [, { values }] of await readGroups(join(packages, file))) {
    for (const [property, value] of Object.entries(values))
      declared.set(property, value.default ?? value);
  }
}

const schema = await readGroups(join(packages, "ui/src/styles/schema.stylex.ts"));

const handles = (group) => Object.entries(schema.get(group).values);

const space = handles("space").map(([key, value]) => [px(value), key]);

const boxes = Object.entries(boxHandles).flatMap(([group, keys]) =>
  handles(group)
    .filter(([key]) => keys === "all" || keys.includes(key))
    .map(([key, value]) => [px(value), `${group}.${key}`]),
);

const unresolved = [...space, ...boxes].filter(([size]) => size === undefined);

if (unresolved.length > 0) {
  console.error(
    `Not a px length at the default size: ${unresolved.map(([, name]) => name).join(", ")}`,
  );
  process.exit(1);
}

const tables = {
  space: space.sort(([a], [b]) => a - b),
  boxes: boxes.sort(([a, first], [b, second]) => a - b || first.localeCompare(second)),
};

if (process.argv.includes("--check")) {
  if (JSON.stringify(JSON.parse(readFileSync(outputPath, "utf8"))) !== JSON.stringify(tables)) {
    console.error(
      "The design-scale lint's tables are stale. Run `pnpm --dir packages/ui sync:tokens`.",
    );
    process.exit(1);
  }
} else {
  const rows = (pairs) =>
    pairs.map(([size, name]) => `    [${size}, ${JSON.stringify(name)}]`).join(",\n");

  writeFileSync(
    outputPath,
    `{\n  "space": [\n${rows(tables.space)}\n  ],\n  "boxes": [\n${rows(tables.boxes)}\n  ]\n}\n`,
  );
}

/** A length in px at the default size, or undefined for anything that isn't one. */
function px(value) {
  const tokens = expand(String(value)).match(/\d*\.?\d+(?:px)?|[a-z-]+\(|\S/g) ?? [];
  let index = 0;

  const peek = () => tokens[index];
  const next = () => tokens[index++];

  const sum = () => {
    let total = product();

    while (peek() === "+" || peek() === "-")
      total = next() === "+" ? total + product() : total - product();

    return total;
  };

  const product = () => {
    let total = unit();

    while (peek() === "*" || peek() === "/")
      total = next() === "*" ? total * unit() : total / unit();

    return total;
  };

  const unit = () => {
    const token = next();

    if (token === "(" || token === "calc(") {
      const inner = sum();
      next();

      return inner;
    }

    if (token === "max(" || token === "min(") {
      const values = [sum()];

      while (next() === ",") values.push(sum());

      return token === "max(" ? Math.max(...values) : Math.min(...values);
    }

    return Number.parseFloat(token);
  };

  const result = sum();

  return index === tokens.length && Number.isFinite(result) ? result : undefined;
}

/** Replaces every `var(--nyte-…)` with its declared default, recursively. */
function expand(value) {
  return value.replace(/var\((--nyte-[\w-]+)\)/g, (_, property) =>
    declared.has(property) ? `(${expand(declared.get(property))})` : "?",
  );
}
