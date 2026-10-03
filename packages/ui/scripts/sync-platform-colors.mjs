import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { readGroups } from "./tokens.mjs";

const outputPath = join(dirname(fileURLToPath(import.meta.url)), "..", "src", "platform-colors.ts");

const check = process.argv.includes("--check");

const tokenDirectory = join(dirname(fileURLToPath(import.meta.url)), "..", "src");

const themeGroups = await readGroups(join(tokenDirectory, "theme.stylex.ts"));

const theme = themeGroups.get("theme").values;

const roleGroups = await readGroups(join(tokenDirectory, "roles.stylex.ts"));

const roles = roleGroups.get("roles").values;

const tinted = roleGroups.get("tinted").values;

const transparency = (await readGroups(join(tokenDirectory, "tokens.stylex.ts"))).get(
  "transparency",
).values;

const defaults = (group) =>
  Object.entries(group).map(([name, value]) => [name, value.default ?? value]);

// Every declaration a colour can reach, outside any scope and with the
// appearance inputs at their defaults.
const neutralDeclarations = Object.fromEntries([theme, roles, transparency].flatMap(defaults));

let declared = neutralDeclarations;

// Role-group and unscoped entries that are not a colour: the hover and press
// layers are images, the outlined shadow is a shadow, and the swatch follows
// the workspace tint, which a native app does not have.
const nonColors = new Set([
  "--nyte-layer-hover",
  "--nyte-layer-pressed",
  "--nyte-shadow-md-outline",
  "--nyte-tint-swatch",
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

// Colours travel as linear-light sRGB channels in 0–1 plus alpha, so mixing
// and conversion stay exact until the final 8-bit rounding.
const toLinear = (channel) =>
  channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;

const fromLinear = (channel) =>
  channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055;

const parseHex = (value) => {
  const match = value.match(/^#([\da-f]{6})([\da-f]{2})?$/i);

  if (!match) return undefined;

  const [red, green, blue] = [0, 2, 4].map((at) =>
    toLinear(Number.parseInt(match[1].slice(at, at + 2), 16) / 255),
  );

  return {
    red,
    green,
    blue,
    alpha: match[2] === undefined ? 1 : Number.parseInt(match[2], 16) / 255,
  };
};

/** CIE Lab (D50), as the ramps write it, to linear sRGB through a Bradford adaptation. */
const parseLab = (value) => {
  const match = value.match(
    /^lab\(\s*([\d.-]+)%\s+([\d.e-]+)\s+([\d.e-]+)\s*(?:\/\s*([\d.]+)\s*)?\)$/,
  );

  if (!match) return undefined;

  const [lightness, a, b] = match.slice(1, 4).map(Number.parseFloat);
  const fy = (lightness + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const epsilon = 216 / 24389;
  const kappa = 24389 / 27;
  const inverse = (f) => (f ** 3 > epsilon ? f ** 3 : (116 * f - 16) / kappa);
  const x = (inverse(fx) * 0.3457) / 0.3585;
  const y = lightness > kappa * epsilon ? fy ** 3 : lightness / kappa;
  const z = (inverse(fz) * (1 - 0.3457 - 0.3585)) / 0.3585;

  const d65 = [
    0.955473421488075 * x - 0.02309845494876471 * y + 0.06325924320057072 * z,
    -0.0283697093338637 * x + 1.0099953980813041 * y + 0.021041441191917323 * z,
    0.012314014864481998 * x - 0.020507649298898964 * y + 1.330365926242124 * z,
  ];

  return {
    red: 3.2409699419045226 * d65[0] - 1.537383177570094 * d65[1] - 0.4986107602930034 * d65[2],
    green:
      -0.9692436362808796 * d65[0] + 1.8759675015077202 * d65[1] + 0.04155505740717559 * d65[2],
    blue: 0.05563007969699366 * d65[0] - 0.20397695888897652 * d65[1] + 1.0569715142428786 * d65[2],
    alpha: match[4] === undefined ? 1 : Number.parseFloat(match[4]),
  };
};

const toOklch = ({ red, green, blue, alpha }) => {
  const cube = (value) => Math.cbrt(value);
  const l = cube(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = cube(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = cube(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;

  return {
    l: 0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s,
    c: Math.hypot(a, b),
    h: Math.atan2(b, a),
    alpha,
  };
};

const fromOklch = ({ l, c, h, alpha }) => {
  const a = c * Math.cos(h);
  const b = c * Math.sin(h);
  const long = (l + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const medium = (l - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const short = (l - 0.0894841775 * a - 1.291485548 * b) ** 3;

  return {
    red: 4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    green: -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    blue: -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
    alpha,
  };
};

/** `calc()` over numbers, percentages, and `var()`, as the roles write it. */
const evaluate = (expression, trail) => {
  const tokens = expression
    .replace(/var\((--[a-z0-9-]+)\)/g, (_, name) => {
      if (declared[name] === undefined) throw new Error(`${trail.at(-1)}: ${name} is undeclared`);

      return declared[name];
    })
    .replace(/%/g, "")
    .match(/[\d.]+|[-+*/()]/g);

  let at = 0;

  const primary = () => {
    const token = tokens[at++];

    if (token === "(") {
      const inner = sum();
      at += 1;

      return inner;
    }

    return Number.parseFloat(token);
  };

  const product = () => {
    let value = primary();

    while (tokens[at] === "*" || tokens[at] === "/") {
      value = tokens[at++] === "*" ? value * primary() : value / primary();
    }

    return value;
  };

  const sum = () => {
    let value = product();

    while (tokens[at] === "+" || tokens[at] === "-") {
      value = tokens[at++] === "+" ? value + product() : value - product();
    }

    return value;
  };

  return sum();
};

const numeric = (text, trail) => {
  const inner = callArguments(text, "calc");

  return inner === undefined ? Number.parseFloat(text) : evaluate(inner[0], trail);
};

/** `oklch(from X calc(l * n) c h)` and `oklch(from X l c h / calc(alpha + n))`. */
const relativeOklch = (value, mode, trail) => {
  if (!value.startsWith("oklch(from ") || !value.endsWith(")")) return undefined;
  const words = [];
  let depth = 0;
  let start = 0;
  const body = value.slice(6, -1);

  for (let index = 0; index < body.length; index += 1) {
    const character = body[index];

    if (character === "(") depth += 1;
    else if (character === ")") depth -= 1;
    else if (character === " " && depth === 0) {
      if (index > start) words.push(body.slice(start, index));
      start = index + 1;
    }
  }

  words.push(body.slice(start));

  if (words[0] !== "from" || words[3] !== "c" || words[4] !== "h") return undefined;
  const origin = toOklch(resolve(words[1], mode, trail));
  const cap = words[2].match(/^min\(l, ([\d.]+)\)$/);

  const lightness =
    words[2] === "l"
      ? origin.l
      : cap
        ? Math.min(origin.l, Number.parseFloat(cap[1]))
        : origin.l * Number.parseFloat(words[2].match(/\* ([\d.]+)/)[1]);

  const alpha =
    words[5] === undefined
      ? origin.alpha
      : Math.min(1, origin.alpha + Number.parseFloat(words[6].match(/\+ ([\d.]+)/)[1]));

  return fromOklch({ ...origin, l: lightness, alpha });
};

// CSS mixes in premultiplied alpha, which is why mixing a color with
// `transparent` keeps the color and only drops its alpha.
const mixColors = (first, firstWeight, second, secondWeight) => {
  const total = firstWeight + secondWeight;
  const [share, rest] = [firstWeight / total, secondWeight / total];
  const alpha = first.alpha * share + second.alpha * rest;

  const encode = (color) => ({
    red: fromLinear(color.red),
    green: fromLinear(color.green),
    blue: fromLinear(color.blue),
  });

  const [from, to] = [encode(first), encode(second)];

  const channel = (key) =>
    alpha === 0
      ? 0
      : toLinear((from[key] * first.alpha * share + to[key] * second.alpha * rest) / alpha);

  return { red: channel("red"), green: channel("green"), blue: channel("blue"), alpha };
};

/** A `color-mix()` operand: a color with an optional percentage after it. */
const parseOperand = (operand, trail) => {
  const match = operand.match(/^(.*?)\s+((?:calc\(.*\))|[\d.]+%)$/);

  if (!match) return { color: operand, weight: undefined };

  return { color: match[1], weight: numeric(match[2].replace(/%$/, ""), trail) };
};

/** `oklch(L% C H)` or `oklch(L% C H / A)`, with H in degrees, as the anchored ramps write it. */
const parseOklch = (value) => {
  const match = value.match(/^oklch\(([\d.]+)% ([\d.]+) ([\d.]+)(?: \/ ([\d.]+))?\)$/);

  if (!match) return undefined;

  return fromOklch({
    l: Number.parseFloat(match[1]) / 100,
    c: Number.parseFloat(match[2]),
    h: (Number.parseFloat(match[3]) * Math.PI) / 180,
    alpha: match[4] === undefined ? 1 : Number.parseFloat(match[4]),
  });
};

const resolve = (expression, mode, trail) => {
  const value = expression.trim();

  if (value === "transparent") return { red: 0, green: 0, blue: 0, alpha: 0 };

  const color =
    parseHex(value) ?? parseLab(value) ?? parseOklch(value) ?? relativeOklch(value, mode, trail);

  if (color !== undefined) return color;

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

  // The contract is sRGB mixing only: a token that mixes in another space fails
  // the run instead of shipping a colour this resolver cannot reproduce.
  if (mix !== undefined) {
    const [space, ...operands] = mix;

    if (space !== "in srgb" || operands.length !== 2) {
      throw new Error(`${trail.at(-1)}: ${value} is not an srgb mix of two colors`);
    }

    const [first, second] = operands.map((operand) => parseOperand(operand, trail));
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
  const byte = (value) =>
    Math.round(Math.min(1, Math.max(0, value)) * 255)
      .toString(16)
      .padStart(2, "0");

  const encoded = [color.red, color.green, color.blue].map(fromLinear);
  const opaque = `#${encoded.map(byte).join("")}`;

  return color.alpha >= 1 ? opaque : `${opaque}${byte(color.alpha)}`;
};

// React Native cannot evaluate `light-dark()`, `color-mix()`, `lab()`, or
// `var()`, so every colour reduces here to one concrete value per appearance,
// outside any scope. A colour that fails to reduce has no value to ship and
// fails the run.
const colorNames = Object.keys(roles).filter((name) => !nonColors.has(name));

const scheme = (mode) =>
  colorNames
    .map((name) => `    ${colorKey(name)}: "${formatHex(resolve(declared[name], mode, [name]))}",`)
    .join("\n");

const notice =
  "Generated from the @nyte-ai/ui colour tokens. Run pnpm --filter @nyte-ai/ui sync:tokens.";

const neutralOutput = `export const platformColors = {\n  light: {\n${scheme("light")}\n  },\n  dark: {\n${scheme("dark")}\n  },\n} as const;\n`;

const hues = [
  "gray",
  "brown",
  "orange",
  "yellow",
  "green",
  "blue",
  "purple",
  "pink",
  "red",
  "teal",
];

const scopedScheme = (mode) =>
  hues
    .map((hue) => {
      declared = {
        ...neutralDeclarations,
        ...Object.fromEntries(defaults(themeGroups.get(hue).values)),
        ...Object.fromEntries(defaults(tinted)),
      };

      return `    ${hue}: {\n${scheme(mode)
        .split("\n")
        .map((line) => "  " + line)
        .join("\n")}\n    },`;
    })
    .join("\n");

const scopesOutput = `export const platformScopes = {\n  light: {\n${scopedScheme("light")}\n  },\n  dark: {\n${scopedScheme("dark")}\n  },\n} as const;\n`;

const generated = `// ${notice}\n${neutralOutput}\n${scopesOutput}`;

if (check) {
  const current = await readFile(outputPath, "utf8");

  if (current !== generated) {
    throw new Error("platform-colors.ts is stale; run pnpm --filter @nyte-ai/ui sync:tokens");
  }
} else {
  await writeFile(outputPath, generated);
}
