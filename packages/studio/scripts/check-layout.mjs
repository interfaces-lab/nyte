import { readdir, readFile } from "node:fs/promises";
import { join, relative } from "node:path";
import process from "node:process";

const root = join(import.meta.dirname, "..");

const folder = join(root, "Sources/NyteStudio");

const rules = [
  [/\bconstant:\s*-?\d/u, "a constraint constant"],
  [/\bequalToConstant:\s*-?\d/u, "a fixed size"],
  [/\.spacing\s*=\s*\d/u, "a stack's spacing"],
  [/\bsetCustomSpacing\(\s*\d/u, "a stack's spacing"],
  [/\bNSEdgeInsets\([^)]*:\s*-?\d/u, "an inset"],
  [/\bcornerRadius\s*=\s*\d/u, "a corner radius"],
  [/\b(?:xRadius|yRadius|cornerWidth|cornerHeight):\s*\d/u, "a corner radius"],
  [/\bpointSize:\s*\d/u, "a symbol size"],
  [/\b(?:ofSize:|fontSize\s*=)\s*\d/u, "a type size"],
  [/\b(?:lineWidth|borderWidth)\s*=\s*\d/u, "a line width"],
  [/\bduration\s*=\s*\d/u, "a duration"],
];

const files = (await readdir(folder)).filter((name) => name.endsWith(".swift")).sort();

const findings = [];

for (const name of files) {
  const lines = (await readFile(join(folder, name), "utf8")).split("\n");

  lines.forEach((line, index) => {
    if (line.trimStart().startsWith("//")) return;

    for (const [pattern, what] of rules) {
      if (pattern.test(line))
        findings.push(
          `${relative(root, join(folder, name))}:${index + 1}: ${what} written as a number`,
        );
    }
  });
}

if (findings.length > 0) {
  process.stderr.write(
    `${findings.join("\n")}\n\n${findings.length} layout value${findings.length === 1 ? "" : "s"} off the scales. Use a NyteSpace step, a NyteControl height, a NyteRadius, a NyteGlyph, a NyteText size or a NyteMetric.\n`,
  );
  process.exit(1);
}

process.stdout.write(`layout: ${files.length} files, every size from a token\n`);
