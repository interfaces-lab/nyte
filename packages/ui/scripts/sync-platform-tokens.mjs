import { readFile, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const packageRoot = join(dirname(fileURLToPath(import.meta.url)), "..");
const sourcePath = join(packageRoot, "src/platform-tokens.stylex.ts");
const check = process.argv.includes("--check");

const sourceText = await readFile(sourcePath, "utf8");
const declaredTokens = sourceText.match(/"--nyte-[^"]+"\s*:/g) ?? [];
if (declaredTokens.length === 0) throw new Error("No literal Nyte tokens found");

const tokenPattern =
  /"(?<name>--nyte-[^"]+)"\s*:\s*(?:"(?<doubleQuoted>[^"\\]*)"|'(?<singleQuoted>[^'\\]*)'|(?<number>-?\d+(?:\.\d+)?)),/g;
const declarations = [...sourceText.matchAll(tokenPattern)].map(({ groups }) => {
  if (groups === undefined) throw new Error("Token parser invariant failed");
  const { name, doubleQuoted, singleQuoted, number } = groups;
  const value = doubleQuoted ?? singleQuoted ?? number;
  if (name === undefined || value === undefined) throw new Error("Token parser invariant failed");
  return { name, value };
});

if (declarations.length !== declaredTokens.length) {
  throw new Error(
    `Unsupported token literal: extracted ${declarations.length} of ${declaredTokens.length} Nyte tokens`,
  );
}

const colors = declarations.flatMap(({ name, value }) => {
  if (!name.startsWith("--nyte-color-")) return [];
  // Focus modality is a browser concern; native controls use the ring value directly.
  if (name === "--nyte-color-focus-ring" && value === "var(--nyte-color-ring)") return [];
  const match = value.match(/^light-dark\((#[\da-f]+),\s*(#[\da-f]+)\)$/i);
  const light = match?.[1];
  const dark = match?.[2];
  if (light === undefined || dark === undefined) {
    throw new Error(`Unsupported platform color ${name}: ${value}`);
  }
  const key = name
    .slice("--nyte-color-".length)
    .replace(/-([a-z])/g, (_, letter) => letter.toUpperCase());
  return [{ key, light, dark }];
});

const notice =
  "Generated from platform-tokens.stylex.ts. Run pnpm --filter @nyte-ai/ui sync:tokens.";
const css = `/* ${notice} */\n:root {\n  color-scheme: light dark;\n${declarations.map(({ name, value }) => `  ${name}: ${value};`).join("\n")}\n}\n`;
const platformColors = `// ${notice}\nexport const platformColors = {\n  light: {\n${colors.map(({ key, light }) => `    ${key}: "${light}",`).join("\n")}\n  },\n  dark: {\n${colors.map(({ key, dark }) => `    ${key}: "${dark}",`).join("\n")}\n  },\n} as const;\n`;

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
