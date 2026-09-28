import { readFile, writeFile } from "node:fs/promises";
import { registerHooks } from "node:module";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const outputPath = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "platform-colors.ts");

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

const { palette } = await import("../src/tokens.stylex.ts");

// A token that carries an oklch value also carries the same colour in `rgb()`
// as its default; that is the one this resolver reads.
const declared = Object.fromEntries(
  Object.entries(palette).map(([name, value]) => [
    name,
    typeof value === "string" ? value : value.default,
  ]),
);

// Palette entries that are not a colour: the tint inputs, the material's
// filter, the gradient layers, and the interactive cursor.
const nonColors = new Set([
  "--nyte-tint-hue",
  "--nyte-tint-intensity",
  "--nyte-tint-swatch",
  "--nyte-material-filter",
  "--nyte-layer-hover",
  "--nyte-layer-pressed",
  "--nyte-button-secondary-bg",
  "--nyte-cursor-interactive",
]);

const colorKey = (name) =>
  name
    .slice("--nyte-".length)
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

/** `rgb(r g b)` or `rgb(r g b / a)`, the fallback syntax the palette writes. */
const parseRgb = (value) => {
  const match = value.match(/^rgb\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)\s*(?:\/\s*([\d.]+)\s*)?\)$/);

  if (!match) return undefined;

  const [red, green, blue] = match.slice(1, 4).map(Number.parseFloat);

  return { red, green, blue, alpha: match[4] === undefined ? 1 : Number.parseFloat(match[4]) };
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

  if (value.startsWith("rgb(")) {
    const color = parseRgb(value);

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

// React Native cannot evaluate `light-dark()`, `color-mix()`, or `var()`, so
// every colour token reduces here to one concrete value per appearance, with
// the workspace tint at its default. A token that fails to reduce has no value
// to ship and fails the run.
const colorNames = Object.keys(declared).filter((name) => !nonColors.has(name));

const scheme = (mode) =>
  colorNames
    .map((name) => `    ${colorKey(name)}: "${formatHex(resolve(declared[name], mode, [name]))}",`)
    .join("\n");

const notice = "Generated from tokens.stylex.ts. Run pnpm --filter @nyte-ai/ui sync:tokens.";

const generated = `// ${notice}\nexport const platformColors = {\n  light: {\n${scheme("light")}\n  },\n  dark: {\n${scheme("dark")}\n  },\n} as const;\n`;

if (check) {
  const current = await readFile(outputPath, "utf8");

  if (current !== generated) {
    throw new Error("platform-colors.ts is stale; run pnpm --filter @nyte-ai/ui sync:tokens");
  }
} else {
  await writeFile(outputPath, generated);
}
