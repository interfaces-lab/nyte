/**
 * Reads token files through StyleX's own compiler, so checks and generators see
 * exactly what ships: `readGroups(path)` maps each exported `defineVars` or
 * `createTheme` to its declarations, keyed by custom property. A value with
 * at-rule variants is `{ default, "@media …": … }`.
 */
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createRequire } from "node:module";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "../../..");

const require = createRequire(createRequire(import.meta.url).resolve("@stylexjs/unplugin"));

const babel = require("@babel/core");

const stylex = require("@stylexjs/babel-plugin");

function declarations(body) {
  const out = {};
  let depth = 0;
  let start = 0;

  for (let index = 0; index <= body.length; index += 1) {
    const character = body[index];

    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (index === body.length || (character === ";" && depth === 0)) {
      const declaration = body.slice(start, index);
      const colon = declaration.indexOf(":");

      if (colon > 0) out[declaration.slice(0, colon).trim()] = declaration.slice(colon + 1).trim();
      start = index + 1;
    }
  }

  return out;
}

/** `[{ condition, className, values }]` for every rule StyleX emits from the file. */
function rules(metadata) {
  return metadata.flatMap(([, { ltr }]) => {
    const nested = ltr.match(/^(@[^{]+)\{(.*?)\{(.*)\}\}$/s);
    const flat = ltr.match(/^([^@{][^{]*)\{(.*)\}$/s);

    const [condition, selector, body] = nested
      ? [nested[1].trim(), nested[2], nested[3]]
      : flat
        ? ["default", flat[1], flat[2]]
        : [];

    if (selector === undefined) return [];

    return [
      { condition, className: selector.match(/\.([\w-]+)/)?.[1], values: declarations(body) },
    ];
  });
}

export async function readGroups(path) {
  const { code, metadata } = babel.transformSync(readFileSync(path, "utf8"), {
    filename: path,
    babelrc: false,
    configFile: false,
    parserOpts: { plugins: ["typescript", "jsx"] },
    plugins: [
      [
        stylex,
        {
          dev: false,
          runtimeInjection: false,
          unstable_moduleResolution: { type: "commonJS", rootDir: root },
        },
      ],
    ],
  });

  const emitted = rules(metadata.stylex ?? []);
  const directory = mkdtempSync(join(tmpdir(), "nyte-tokens-"));

  try {
    const module = join(directory, "tokens.ts");
    writeFileSync(module, code.replace(/^import\s[^;]*;$/gm, ""));
    const exports = await import(pathToFileURL(module).href);
    const groups = new Map();

    for (const [name, value] of Object.entries(exports)) {
      const className =
        value.__varGroupHash__ ??
        (value.$$css === true
          ? String(Object.entries(value).find(([key]) => key !== "$$css")?.[1]).split(" ")[0]
          : undefined);

      if (className === undefined) {
        groups.set(name, { values: value, constants: true });
        continue;
      }

      const values = {};

      for (const rule of emitted.filter((entry) => entry.className === className)) {
        for (const [property, declared] of Object.entries(rule.values)) {
          if (rule.condition === "default") values[property] ??= declared;
          else values[property] = { default: values[property], [rule.condition]: declared };
        }
      }

      groups.set(name, { values });
    }

    return groups;
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
}
