import { readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import process from "node:process";
import { blankLiterals, swiftFiles } from "./swift-source.mjs";

const root = join(import.meta.dirname, "..");
const sources = join(root, "Sources");
const exempt = [/^NyteProbe\//u, /^NyteUI\/Tokens\//u, /\.generated\.swift$/u, /^NyteTerminal\/(KeyMap|TerminalEngine|RowLayout)\.swift$/u];
const specimens = new Set(["NyteGallery", "NyteShot"]);
const declaration = /^\s*(?:(?:public|private|fileprivate|internal)\s+)?(?:nonisolated\s+)?(?:static\s+)?let\s+\w+\s*(?::\s*[\w.<>\[\]? ]+)?\s*=/u;
const places = [
  [/\bconstant:/u, "a constraint constant"],
  [/\bequalToConstant:/u, "a fixed size"],
  [/\.spacing\s*=|\bsetCustomSpacing\(/u, "a stack's spacing"],
  [/\bNSEdgeInsets\(/u, "an inset"],
  [/\bcornerRadius\b|\b[xy]Radius:|\bradius:/u, "a corner radius"],
  [/\bpointSize:|\bofSize:|\bfontSize\b|\bSymbol\.image\([^)]*\bsize:/u, "a type or symbol size"],
  [/\blineWidth\b|\bborderWidth\b|\bringWidth\b/u, "a line width"],
  [/\bduration\b|\basyncAfter\(/u, "a duration"],
  [/\b(?:NS|CG)(?:Rect|Size|Point)\(|\binsetBy\(|\boffsetBy\(/u, "a drawn size or offset"],
  [/\balphaValue\s*=|\bopacity\s*=|\bfraction:/u, "an opacity"],
];
const number = /(?<![\w.])-?\d+(?:\.\d+)?(?![\w.]|\s*\.\.[.<])/gu;
const free = new Set(["0", "1", "2", "0.5", "-1", "-0.5", "-2"]);
const banned = [
  [/\bNSColor\((?:srgbRed|red|white|calibratedRed|calibratedWhite|deviceRed|deviceWhite|displayP3Red|hue)\b/u, "a colour written as components; use a Palette role"],
  [/\bNSColor\.(?:black|white|red|green|blue|gray|darkGray|lightGray|orange|yellow|purple|brown|cyan|magenta|system\w+|labelColor|secondaryLabelColor|tertiaryLabelColor|quaternaryLabelColor|textColor|controlTextColor|windowBackgroundColor|controlBackgroundColor|separatorColor)\b/u, "a system colour; use a Palette role"],
  [/\.withAlphaComponent\(/u, "an ink faded with opacity; pick a lower content or fill step"],
  [/\bNSFont\.(?:systemFont|boldSystemFont|monospacedSystemFont|monospacedDigitSystemFont|userFont|labelFont|menuFont|messageFont)\(/u, "a font built by hand; use a TextStyle"],
  [/#colorLiteral|\b0x[0-9A-Fa-f]{6,8}\b/u, "a colour written as hex; use a Palette role"],
];

const wanted = process.argv.slice(2);
const folders = wanted.length > 0 ? wanted.map((name) => join(sources, name)) : [sources];
const files = (await Promise.all(folders.map(swiftFiles))).flat();
const findings = [];
let checked = 0;

for (const file of files) {
  const name = relative(sources, file);
  if (exempt.some((pattern) => pattern.test(name))) continue;
  const text = await readFile(file, "utf8");
  if (!/^import (?:AppKit|QuartzCore|CoreText)\b/mu.test(text)) continue;
  checked += 1;
  const specimen = specimens.has(name.split("/")[0]);
  blankLiterals(text).forEach((blanked, index) => {
    const line = blanked.replace(/\/\/.*$/u, "");
    if (line.trim() === "") return;
    for (const [pattern, what] of banned) {
      if (pattern.test(line)) findings.push(`${name}:${index + 1}: ${what}`);
    }
    if (declaration.test(line)) return;
    const kind = places.find(([pattern]) => pattern.test(line))?.[1] ?? (specimen ? undefined : "a bare number");
    if (kind === undefined) return;
    const off = (line.replace(/(?:<<|>>)\s*\d+/gu, "").match(number) ?? []).filter((value) => !free.has(value));
    if (off.length > 0) findings.push(`${name}:${index + 1}: ${kind} written as ${off.join(", ")}`);
  });
}

if (findings.length > 0) {
  const byFolder = new Map();
  for (const finding of findings) {
    const folder = finding.split("/")[0];
    byFolder.set(folder, (byFolder.get(folder) ?? 0) + 1);
  }
  const summary = [...byFolder].map(([folder, count]) => `${folder} ${count}`).join(", ");
  process.stderr.write(
    `${findings.join("\n")}\n\n${findings.length} value${findings.length === 1 ? "" : "s"} off the design scales (${summary}). ` +
      "Use a Space step, a Size, a Radius, a Glyph, a TextStyle, a Motion duration or a Palette role; " +
      "a value only one view needs is a `static let` on that view with its reason.\n",
  );
  process.exit(1);
}

process.stdout.write(`design: ${checked} files, every value from a token\n`);
