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
const { darkPalette, lightPalette, tokens } = await import("../src/platform-tokens.stylex.ts");
const declared = Object.assign({}, ...Object.values(tokens));

const colorKey = (name) =>
  name
    .slice("--nyte-color-".length)
    .split("-")
    .map((part, index) => (index === 0 ? part : part[0].toUpperCase() + part.slice(1)))
    .join("");

// Native reads the palettes, so a color built any other way would be missing
// there. The ring is the one color a native control takes directly.
for (const [name, value] of Object.entries(declared)) {
  if (!name.startsWith("--nyte-color-") || name === "--nyte-color-focus-ring") continue;
  const key = colorKey(name);
  const light = lightPalette[key];
  const dark = darkPalette[key];
  if (light === undefined || dark === undefined) {
    throw new Error(`${name} has no ${key} entry in both palettes`);
  }
  if (value !== `light-dark(${light}, ${dark})`) {
    throw new Error(`${name} is ${value}, not the ${key} palette pair`);
  }
}

const notice =
  "Generated from platform-tokens.stylex.ts. Run pnpm --filter @nyte-ai/ui sync:tokens.";
const declarations = Object.entries(declared)
  .map(([name, value]) => `  ${name}: ${value};`)
  .join("\n");
const css = `/* ${notice} */\n:root {\n  color-scheme: light dark;\n${declarations}\n}\n`;

const scheme = (palette) =>
  Object.entries(palette)
    .map(([key, value]) => `    ${key}: "${value}",`)
    .join("\n");
const platformColors = `// ${notice}\nexport const platformColors = {\n  light: {\n${scheme(lightPalette)}\n  },\n  dark: {\n${scheme(darkPalette)}\n  },\n} as const;\n`;

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
