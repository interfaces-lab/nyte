import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { platformColors, platformScopes } from "../../ui/src/platform-colors.ts";
import { platformRamps } from "../../ui/src/platform-ramps.ts";

const target = join(import.meta.dirname, "../Sources/NyteUI/Tokens/Roles.generated.swift");
const rolesSource = await readFile(join(import.meta.dirname, "../../ui/src/styles/roles.stylex.ts"), "utf8");

const toLinear = (channel) => (channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4);
const fromLinear = (channel) => (channel <= 0.0031308 ? channel * 12.92 : 1.055 * channel ** (1 / 2.4) - 0.055);

function scaleLightness(hex, factor) {
  const digits = hex.slice(1);
  const [red, green, blue] = [0, 2, 4].map((at) => toLinear(Number.parseInt(digits.slice(at, at + 2), 16) / 255));
  const l = Math.cbrt(0.4122214708 * red + 0.5363325363 * green + 0.0514459929 * blue);
  const m = Math.cbrt(0.2119034982 * red + 0.6806995451 * green + 0.1073969566 * blue);
  const s = Math.cbrt(0.0883024619 * red + 0.2817188376 * green + 0.6299787005 * blue);
  const lightness = (0.2104542553 * l + 0.793617785 * m - 0.0040720468 * s) * factor;
  const a = 1.9779984951 * l - 2.428592205 * m + 0.4505937099 * s;
  const b = 0.0259040371 * l + 0.7827717662 * m - 0.808675766 * s;
  const long = (lightness + 0.3963377774 * a + 0.2158037573 * b) ** 3;
  const medium = (lightness - 0.1055613458 * a - 0.0638541728 * b) ** 3;
  const short = (lightness - 0.0894841775 * a - 1.291485548 * b) ** 3;
  const linear = [
    4.0767416621 * long - 3.3077115913 * medium + 0.2309699292 * short,
    -1.2684380046 * long + 2.6097574011 * medium - 0.3413193965 * short,
    -0.0041960863 * long - 0.7034186147 * medium + 1.707614701 * short,
  ];
  const byte = (value) =>
    Math.round(Math.min(1, Math.max(0, fromLinear(Math.min(1, Math.max(0, value))))) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${linear.map(byte).join("")}${digits.slice(6)}`;
}

function splitArguments(source) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let index = 0; index < source.length; index += 1) {
    if (source[index] === "(") depth += 1;
    else if (source[index] === ")") depth -= 1;
    else if (source[index] === "," && depth === 0) {
      parts.push(source.slice(start, index).trim());
      start = index + 1;
    }
  }
  parts.push(source.slice(start).trim());
  return parts;
}

function call(expression) {
  const match = expression.match(/^(\w+)\((.*)\)$/s);
  return match ? { name: match[1], args: splitArguments(match[2]) } : { name: undefined, args: [] };
}

const roleKey = (cssName) => cssName.replace(/-(\w)/g, (_, letter) => letter.toUpperCase());

function helper(name) {
  const match = rolesSource.match(new RegExp(`const ${name} = \\(role: string\\) =>\\s*(contrast\\(.*\\));`));
  if (!match) throw new Error(`roles.stylex.ts: no ${name} helper`);
  return (role) => match[1].replaceAll("role,", `"${role}",`);
}

const helpers = { hover: helper("hover"), press: helper("press") };

function declaration(role) {
  const match = rolesSource.match(new RegExp(`"--nyte-${role}":\\s*(.*),\\n`));
  if (!match) throw new Error(`roles.stylex.ts: no declaration of --nyte-${role}`);
  const value = call(match[1]);
  const expand = helpers[value.name];
  return expand ? call(expand(JSON.parse(value.args[0]))) : value;
}

function shade(value) {
  const [role, light, dark] = value.args;
  const name = roleKey(JSON.parse(role));
  if (declaration(JSON.parse(role)).name === "contrast") throw new Error(`${name} is shaded from a contrast-dependent role`);
  return [
    scaleLightness(platformColors.light[name], Number(light)),
    scaleLightness(platformColors.dark[name] ?? platformColors.light[name], Number(dark)),
  ];
}

function moreContrast(value) {
  const [light, dark] = value.args.map((arg) => (Number.isNaN(Number(arg)) ? arg : String(Number(arg))));
  const neutral = platformRamps.gray;
  switch (value.name) {
    case "step":
      return [neutral.opaque[light], neutral.opaque[dark]];
    case "glass":
      return [neutral.translucentLight[light], neutral.translucentDark[dark]];
    case "shade":
      return shade(value);
    default:
      throw new Error(`roles.stylex.ts: cannot resolve ${value.name}() for prefers-contrast`);
  }
}

const cssName = (role) => role.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`);

const contrastRoles = Object.keys(platformColors.light).flatMap((role) => {
  const value = declaration(cssName(role));
  return value.name === "contrast" ? [[role, moreContrast(call(value.args[1]))]] : [];
});

const withinOneStep = (first, second) =>
  [1, 3, 5, 7].every(
    (at) => Math.abs(Number.parseInt(first.slice(at, at + 2) || "ff", 16) - Number.parseInt(second.slice(at, at + 2) || "ff", 16)) <= 1,
  );

const buttonSteps = ["buttonFillHover", "buttonFillPressed"].map((role) => {
  const value = declaration(cssName(role));
  if (value.name !== "shade" || JSON.parse(value.args[0]) !== "button-fill") {
    throw new Error(`${role} is no longer a shade of button-fill`);
  }
  const factors = [Number(value.args[1]), Number(value.args[2])];
  for (const [index, mode] of ["light", "dark"].entries()) {
    const derived = scaleLightness(platformColors[mode].buttonFill, factors[index]);
    if (!withinOneStep(derived, platformColors[mode][role])) {
      throw new Error(`${role} ${mode}: derived ${derived}, @nyte-ai/ui has ${platformColors[mode][role]}`);
    }
  }
  return { role, factors };
});

function literal(hex) {
  const digits = hex.slice(1);
  return `0x${(digits.length === 6 ? `${digits}ff` : digits).toUpperCase()}`;
}

function pairs(light, dark, roles, indent) {
  return roles.map((role) => `${indent}${literal(light[role])}, ${literal(dark[role] ?? light[role])}, // ${role}`);
}

const channels = (hex) => [1, 3, 5].map((at) => Number.parseInt(hex.slice(at, at + 2), 16) / 255);

function toLab(hex) {
  const [r, g, b] = channels(hex).map(toLinear);
  const x = 0.4360747 * r + 0.3850649 * g + 0.1430804 * b;
  const y = 0.2225045 * r + 0.7168786 * g + 0.0606169 * b;
  const z = 0.0139322 * r + 0.0971045 * g + 0.7141733 * b;
  const white = [0.9642956, 1, 0.8251046];
  const f = (value) => (value > 216 / 24389 ? Math.cbrt(value) : ((24389 / 27) * value + 16) / 116);
  const [fx, fy, fz] = [x / white[0], y / white[1], z / white[2]].map(f);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

function fromLab([lightness, a, b]) {
  const white = [0.9642956, 1, 0.8251046];
  const fy = (lightness + 16) / 116;
  const fx = fy + a / 500;
  const fz = fy - b / 200;
  const inverse = (f) => (f ** 3 > 216 / 24389 ? f ** 3 : (116 * f - 16) / (24389 / 27));
  const [x, y, z] = [inverse(fx) * white[0], lightness > 8 ? fy ** 3 : lightness / (24389 / 27), inverse(fz) * white[2]];
  const linear = [
    3.1341359 * x - 1.6173863 * y - 0.4906619 * z,
    -0.9787985 * x + 1.9161301 * y + 0.0334454 * z,
    0.0719639 * x - 0.2289168 * y + 1.4052427 * z,
  ];
  const byte = (value) =>
    Math.round(Math.min(1, Math.max(0, fromLinear(Math.min(1, Math.max(0, value))))) * 255)
      .toString(16)
      .padStart(2, "0");
  return `#${linear.map(byte).join("")}`;
}

const mixInLab = (ground, share, tint) => {
  const [g, t] = [toLab(ground), toLab(tint)];
  return fromLab(g.map((value, index) => value * share + t[index] * (1 - share)));
};

const withAlpha = (hex, alpha) =>
  `${hex.slice(0, 7)}${Math.round(alpha * 255).toString(16).padStart(2, "0")}`;

const diffLineShare = { light: 0.88, dark: 0.8 };
const diffSpanAlpha = { light: 0.15, dark: 0.2 };
const diffHues = { added: "green", removed: "red", modified: "blue" };

const diffRoles = Object.entries(diffHues).flatMap(([change, hue]) => {
  const base = (mode) => platformScopes[mode][hue].strokeAccent;
  const name = change[0].toUpperCase() + change.slice(1);
  const rows = [[`bar${name}`, base("light"), base("dark")]];
  if (change === "modified") return rows;
  return [
    ...rows,
    [`line${name}`, ...["light", "dark"].map((mode) => mixInLab(platformColors[mode].bgBase, diffLineShare[mode], base(mode)))],
    [`span${name}`, ...["light", "dark"].map((mode) => withAlpha(base(mode), diffSpanAlpha[mode]))],
  ];
});

const roles = Object.keys(platformColors.light);
const hues = Object.keys(platformScopes.light);
const scopedByWeb = Object.keys(platformScopes.light[hues[0]]);
const scoped = [...scopedByWeb, ...buttonSteps.map((step) => step.role)];

const scopeWithButtonSteps = (mode, hue) => ({
  ...platformScopes[mode][hue],
  ...Object.fromEntries(
    buttonSteps.map((step) => [
      step.role,
      scaleLightness(platformScopes[mode][hue].buttonFill, step.factors[mode === "light" ? 0 : 1]),
    ]),
  ),
});

for (const hue of hues) {
  const own = Object.keys(platformScopes.light[hue]);
  if (own.join() !== scopedByWeb.join()) throw new Error(`${hue} scopes different roles than ${hues[0]}`);
}

const source = [
  "// Generated from @nyte-ai/ui's platform colours by the token sync script. Do not edit.",
  "",
  "/// A colour role of the Nyte design language.",
  "public enum Role: UInt8, CaseIterable, Sendable {",
  `    case ${roles.join(", ")}`,
  "}",
  "",
  "/// A hue a scope can take. A scope re-resolves the roles that carry colour.",
  "public enum Hue: UInt8, CaseIterable, Sendable {",
  `    case ${hues.join(", ")}`,
  "}",
  "",
  "enum RoleTable {",
  "    /// Every role as 0xRRGGBBAA, light then dark, in `Role` order.",
  "    static let base: [UInt32] = [",
  ...pairs(platformColors.light, platformColors.dark, roles, "        "),
  "    ]",
  "",
  "    /// The roles a hue scope re-resolves.",
  `    static let scoped: [Role] = [${scoped.map((role) => `.${role}`).join(", ")}]`,
  "",
  "    /// Per hue, in `Hue` order: each scoped role as 0xRRGGBBAA, light then dark, in `scoped` order.",
  "    static let hues: [[UInt32]] = [",
  ...hues.flatMap((hue) => [
    `        [ // ${hue}`,
    ...pairs(scopeWithButtonSteps("light", hue), scopeWithButtonSteps("dark", hue), scoped, "            "),
    "        ],",
  ]),
  "    ]",
  "",
  "    /// Roles that take another value under Increase Contrast (`prefers-contrast: more`), light then dark.",
  "    static let moreContrast: [(role: Role, light: UInt32, dark: UInt32)] = [",
  ...contrastRoles.map(([role, [light, dark]]) => `        (.${role}, ${literal(light)}, ${literal(dark)}),`),
  "    ]",
  "}",
  "",
  "/// Diff grounds and change bars, derived as the app's diff view derives them from the green, red and blue scopes.",
  "enum DiffTable {",
  ...diffRoles.map(([name, light, dark]) => `    static let ${name}: (light: UInt32, dark: UInt32) = (${literal(light)}, ${literal(dark)})`),
  "}",
  "",
].join("\n");

if (process.argv.includes("--check")) {
  const current = await readFile(target, "utf8").catch(() => "");
  if (current !== source) {
    process.stderr.write("Roles.generated.swift is stale. Run packages/ide/scripts/tokens.sh.\n");
    process.exit(1);
  }
} else {
  await writeFile(target, source);
}
