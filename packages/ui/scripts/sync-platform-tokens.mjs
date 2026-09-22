import { readFile, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const check = process.argv.includes("--check");

// `defineVars` and `defineConsts` are compile-time markers that throw when they
// run. This generator wants what they were handed, so it imports the token
// module with both replaced by the identity function.
const identityMarkers =
  "data:text/javascript,const i = (values) => values;export const defineVars = i;export const defineConsts = i;";

registerHooks({
  resolve(specifier, context, next) {
    if (specifier !== "@stylexjs/stylex") return next(specifier, context);

    return { url: identityMarkers, shortCircuit: true };
  },
});

const { tokens } = await import("../src/platform-tokens.stylex.ts");

const declared = Object.assign({}, ...Object.values(tokens));

const colorKey = (name) =>
  name
    .slice("--nyte-color-".length)
    .split("-")
    .map((part, index) => (index === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join("");

/** Splits `a, color-mix(b, c)` on its top-level commas only. */
const splitArguments = (source) => {
  const parts = [];
  let depth = 0;
  let start = 0;

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];

    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === "," && depth === 0) {
      parts.push(source.slice(start, index));
      start = index + 1;
    }
  }

  parts.push(source.slice(start));

  return parts.map((part) => part.trim());
};

const callArguments = (value, name) => {
  if (!value.startsWith(`${name}(`) || !value.endsWith(")")) return undefined;

  return splitArguments(value.slice(name.length + 1, -1));
};

const parseHex = (value) => {
  const digits = value.slice(1);
  const expand = (pair) => Number.parseInt(pair.length === 1 ? pair + pair : pair, 16);
  const sizes = { 3: 1, 4: 1, 6: 2, 8: 2 };
  const size = sizes[digits.length];

  if (size === undefined || !/^[0-9a-f]+$/i.test(digits)) return undefined;
  const channel = (index) => expand(digits.slice(index * size, index * size + size));
  const alpha = digits.length === 4 || digits.length === 8 ? channel(3) / 255 : 1;

  return { red: channel(0), green: channel(1), blue: channel(2), alpha };
};

// CSS mixes in premultiplied alpha, which is why mixing a color with
// `transparent` keeps the color and only drops its alpha.
const mixColors = (first, firstWeight, second, secondWeight) => {
  const total = firstWeight + secondWeight;
  const [share, rest] = [firstWeight / total, secondWeight / total];
  const alpha = first.alpha * share + second.alpha * rest;

  const channel = (from, to) =>
    alpha === 0 ? 0 : (from * first.alpha * share + to * second.alpha * rest) / alpha;

  return {
    red: channel(first.red, second.red),
    green: channel(first.green, second.green),
    blue: channel(first.blue, second.blue),
    alpha,
  };
};

/** A `color-mix()` operand: a color with an optional percentage after it. */
const parseOperand = (operand) => {
  const match = operand.match(/^(.*?)\s+([\d.]+)%$/);

  if (!match) return { color: operand, weight: undefined };

  return { color: match[1], weight: Number.parseFloat(match[2]) };
};

const resolve = (expression, mode, trail) => {
  const value = expression.trim();

  if (value === "transparent") return { red: 0, green: 0, blue: 0, alpha: 0 };

  if (value.startsWith("#")) {
    const color = parseHex(value);

    if (color === undefined) throw new Error(`${trail.at(-1)}: ${value} is not a color`);

    return color;
  }

  const reference = callArguments(value, "var");

  if (reference !== undefined) {
    const [name] = reference;

    if (reference.length !== 1 || declared[name] === undefined) {
      throw new Error(`${trail.at(-1)}: ${value} names no declared token`);
    }

    if (trail.includes(name)) throw new Error(`${name} refers back to itself`);

    return resolve(declared[name], mode, [...trail, name]);
  }

  const appearances = callArguments(value, "light-dark");

  if (appearances !== undefined) {
    if (appearances.length !== 2) throw new Error(`${trail.at(-1)}: ${value} needs two colors`);

    return resolve(mode === "light" ? appearances[0] : appearances[1], mode, trail);
  }

  const mix = callArguments(value, "color-mix");

  if (mix !== undefined) {
    const [space, ...operands] = mix;

    if (space !== "in srgb" || operands.length !== 2) {
      throw new Error(`${trail.at(-1)}: ${value} is not an srgb mix of two colors`);
    }

    const [first, second] = operands.map(parseOperand);
    // CSS fills an omitted percentage with the remainder of the other.
    const firstWeight = first.weight ?? (second.weight === undefined ? 50 : 100 - second.weight);
    const secondWeight = second.weight ?? 100 - firstWeight;

    return mixColors(
      resolve(first.color, mode, trail),
      firstWeight,
      resolve(second.color, mode, trail),
      secondWeight,
    );
  }

  throw new Error(`${trail.at(-1)}: ${value} does not resolve to a color`);
};

const formatHex = (color) => {
  const byte = (value) => Math.round(value).toString(16).padStart(2, "0");
  const opaque = `#${byte(color.red)}${byte(color.green)}${byte(color.blue)}`;

  return color.alpha === 1 ? opaque : `${opaque}${byte(color.alpha * 255)}`;
};

// Anchors carry the literals and everything else mixes from them, so the rule
// that keeps native whole is no longer "declared in both palettes" but "reduces
// to a concrete color in both appearances": React Native cannot evaluate
// `color-mix` or `light-dark`, so an expression that fails here has no value to
// ship. The focus ring is a CSS-only alias and stays out of the native output.
const colorNames = Object.keys(declared).filter((name) => name.startsWith("--nyte-color-"));

const resolved = { light: {}, dark: {} };

for (const mode of ["light", "dark"]) {
  for (const name of colorNames) {
    resolved[mode][colorKey(name)] = formatHex(resolve(declared[name], mode, [name]));
  }
}

const notice =
  "Generated from platform-tokens.stylex.ts. Run pnpm --filter @nyte-ai/ui sync:tokens.";

const declarations = Object.entries(declared)
  .map(([name, value]) => `  ${name}: ${value};`)
  .join("\n");

const css = `/* ${notice} */\n:root {\n  color-scheme: light dark;\n${declarations}\n}\n`;

const scheme = (mode) =>
  Object.entries(resolved[mode])
    .filter(([key]) => key !== colorKey("--nyte-color-focus-ring"))
    .map(([key, value]) => `    ${key}: "${value}",`)
    .join("\n");

const platformColors = `// ${notice}\nexport const platformColors = {\n  light: {\n${scheme("light")}\n  },\n  dark: {\n${scheme("dark")}\n  },\n} as const;\n`;

for (const [name, generated] of [
  ["platform-tokens.css", css],
  ["platform-colors.ts", platformColors],
]) {
  const outputPath = join(packageRoot, "src", name);

  if (check) {
    const current = await readFile(outputPath, "utf8");

    if (current !== generated) {
      throw new Error(`${name} is stale; run pnpm --filter @nyte-ai/ui sync:tokens`);
    }
  } else {
    await writeFile(outputPath, generated);
  }
}
