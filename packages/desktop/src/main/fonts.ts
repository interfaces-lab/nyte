/** Native font discovery for Settings. Renderer pages never receive font-file access. */
import { execFile } from "node:child_process";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { LocalFontCatalog } from "../shared/ipc.ts";

const EMPTY_CATALOG: LocalFontCatalog = { sans: [], monospace: [] };

const fontCatalogSchema = Type.Object(
  {
    sans: Type.Array(Type.String()),
    monospace: Type.Array(Type.String()),
  },
  { additionalProperties: false },
);

const MACOS_FONT_SCRIPT = String.raw`
ObjC.import("AppKit");

const manager = $.NSFontManager.sharedFontManager;
const fixedPitchMask = Number($.NSFixedPitchFontMask);
const sans = [];
const monospace = [];

for (const nativeFamily of ObjC.unwrap(manager.availableFontFamilies)) {
  const family = ObjC.unwrap(nativeFamily);
  if (typeof family !== "string" || family.startsWith(".")) continue;

  const font = manager.fontWithFamilyTraitsWeightSize(nativeFamily, 0, 5, 13);
  if (!font) continue;

  const managerTraits = Number(manager.traitsOfFont(font));
  const descriptorTraits = Number(font.fontDescriptor.symbolicTraits);
  if ((managerTraits & fixedPitchMask) !== 0) monospace.push(family);
  else if ((descriptorTraits >>> 28) === 8) sans.push(family);
}

JSON.stringify({ sans, monospace });
`;

type CommandRunner = (executable: string, arguments_: readonly string[]) => Promise<string>;

function runFile(executable: string, arguments_: readonly string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(
      executable,
      arguments_,
      { encoding: "utf8", maxBuffer: 1_048_576, windowsHide: true },
      (error, stdout) => {
        if (error !== null) reject(error);
        else resolve(stdout);
      },
    );
  });
}

function normalizedFamilies(families: readonly string[]): readonly string[] {
  const hasControlCharacter = (value: string): boolean => {
    for (let index = 0; index < value.length; index += 1) {
      const codeUnit = value.charCodeAt(index);

      if (codeUnit <= 31 || codeUnit === 127) return true;
    }

    return false;
  };

  const unique = new Set(
    families
      .values()
      .map((family) => family.trim())
      .filter(
        (family) =>
          family !== "" &&
          !family.startsWith(".") &&
          family.length <= 128 &&
          !hasControlCharacter(family),
      ),
  );

  return [...unique].sort((left, right) => left.localeCompare(right));
}

function parseMacOSCatalog(output: string): LocalFontCatalog {
  const parsed: unknown = JSON.parse(output);
  const catalog = Value.Parse(fontCatalogSchema, parsed);

  return {
    sans: normalizedFamilies(catalog.sans),
    monospace: normalizedFamilies(catalog.monospace),
  };
}

function parseFontconfigCatalog(output: string): LocalFontCatalog {
  const sans: string[] = [];
  const monospace: string[] = [];

  for (const line of output.split("\n")) {
    const separator = line.lastIndexOf("\t");

    if (separator < 0) continue;
    const spacing = Number.parseInt(line.slice(separator + 1), 10);
    const target = spacing >= 90 ? monospace : sans;
    target.push(...line.slice(0, separator).split(","));
  }

  return { sans: normalizedFamilies(sans), monospace: normalizedFamilies(monospace) };
}

/** Read OS font metadata in the trusted host, using no shell and no renderer permission. */
export async function readLocalFonts(
  platform: NodeJS.Platform,
  run: CommandRunner = runFile,
): Promise<LocalFontCatalog> {
  if (platform === "darwin") {
    return parseMacOSCatalog(
      await run("/usr/bin/osascript", ["-l", "JavaScript", "-e", MACOS_FONT_SCRIPT]),
    );
  }

  if (platform === "linux") {
    return parseFontconfigCatalog(
      await run("/usr/bin/fc-list", ["--format=%{family}\\t%{spacing}\\n"]),
    );
  }

  return EMPTY_CATALOG;
}

let localFontsPromise: Promise<LocalFontCatalog> | undefined;

export function localFonts(): Promise<LocalFontCatalog> {
  localFontsPromise ??= readLocalFonts(process.platform).catch(() => EMPTY_CATALOG);

  return localFontsPromise;
}
