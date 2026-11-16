import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import { platformColors, platformScopes } from "@nyte-ai/ui/platform-colors";

const target = join(import.meta.dirname, "../Sources/NyteDesign/Tokens.generated.swift");

function literal(hex) {
  const digits = hex.slice(1);
  const rgba = digits.length === 6 ? `${digits}ff` : digits;

  return `0x${rgba}`;
}

function table(name, light, dark) {
  const rows = Object.keys(light).map(
    (role) => `    .${role}: (${literal(light[role])}, ${literal(dark[role] ?? light[role])}),`,
  );

  return [`  static let ${name}: [NyteRole: (light: UInt32, dark: UInt32)] = [`, ...rows, "  ]"];
}

const roles = Object.keys(platformColors.light);

const source = [
  "// Generated from the @nyte-ai/ui colour tokens. Run pnpm --filter @nyte-ai/studio sync:tokens.",
  "",
  "/// A colour role of the Nyte design language. Each resolves to a light and a dark value.",
  "public enum NyteRole: String, CaseIterable, Sendable {",
  ...roles.map((role) => `  case ${role}`),
  "}",
  "",
  "/// A hue a surface can take; it re-resolves the roles that carry colour.",
  "public enum NyteHue: String, CaseIterable, Sendable {",
  ...Object.keys(platformScopes.light).map((hue) => `  case ${hue}`),
  "}",
  "",
  "enum NytePalette {",
  ...table("base", platformColors.light, platformColors.dark),
  "",
  "  static let hues: [NyteHue: [NyteRole: (light: UInt32, dark: UInt32)]] = [",
  ...Object.keys(platformScopes.light).flatMap((hue) => [
    `    .${hue}: [`,
    ...Object.keys(platformScopes.light[hue]).map(
      (role) =>
        `      .${role}: (${literal(platformScopes.light[hue][role])}, ${literal(platformScopes.dark[hue][role])}),`,
    ),
    "    ],",
  ]),
  "  ]",
  "}",
  "",
].join("\n");

if (process.argv.includes("--check")) {
  const current = await readFile(target, "utf8").catch(() => "");

  if (current !== source) {
    process.stderr.write(
      "Tokens.generated.swift is stale. Run pnpm --filter @nyte-ai/studio sync:tokens.\n",
    );
    process.exit(1);
  }
} else {
  await writeFile(target, source);
}
