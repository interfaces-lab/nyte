/**
 * Aggregate oxlint diagnostics into Markdown tables: per package and per rule, source and test files apart.
 *
 * `node scripts/oxlint/report-violations.mjs` lints the repository with `oxlint -f json`;
 * `--input <report.json>` reads a saved report instead. `--rules a,b` picks the rule columns
 * (default: the code-shape rules); `--all` adds a table of every rule that fired.
 */
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";

const repository = fileURLToPath(new URL("../..", import.meta.url));

const codeShapeRules = [
  "nyte-code(no-is-helper-names)",
  "unicorn(prefer-includes)",
  "typescript(no-explicit-any)",
  "typescript(consistent-type-assertions)",
  "nyte-code(declarative-comments)",
  "nyte-code(no-one-off-boolean-helpers)",
  "eslint(max-lines)",
];

const TEST_FILE =
  /(?:^|\/)(?:test|tests|__tests__|e2e)\/|\.(?:test|spec|browser-test)\.[cm]?[jt]sx?$/;

const { values } = parseArgs({
  options: {
    input: { type: "string" },
    rules: { type: "string" },
    all: { type: "boolean", default: false },
  },
});

function readReport() {
  if (values.input !== undefined) return JSON.parse(readFileSync(values.input, "utf8"));

  const result = spawnSync(
    process.execPath,
    [
      fileURLToPath(new URL("../../node_modules/oxlint/bin/oxlint", import.meta.url)),
      "-f",
      "json",
      ".",
    ],
    { cwd: repository, encoding: "utf8", maxBuffer: 1024 * 1024 * 512 },
  );

  if (result.error !== undefined) throw result.error;
  return JSON.parse(result.stdout);
}

function readPackage(filename) {
  const [top, name] = filename.split("/");

  if (top === "packages" && name !== undefined) return name;
  if (top === "scripts") return "scripts";
  return "(root)";
}

function readCell(counts, key) {
  const { source = 0, test = 0 } = counts.get(key) ?? {};

  if (source + test === 0) return "";
  return test === 0 ? String(source) : `${source} + ${test}t`;
}

function tally(counts, key, kind) {
  const entry = counts.get(key) ?? { source: 0, test: 0 };

  entry[kind] += 1;
  counts.set(key, entry);
}

const report = readReport();
const rules = values.rules?.split(",").filter(Boolean) ?? codeShapeRules;
const cells = new Map();
const ruleTotals = new Map();
const severities = new Map();
const packages = new Set();
const longFiles = [];

for (const diagnostic of report.diagnostics) {
  const name = readPackage(diagnostic.filename);
  const kind = TEST_FILE.test(diagnostic.filename) ? "test" : "source";

  packages.add(name);
  tally(severities, `${diagnostic.code}\u0000${diagnostic.severity}`, kind);
  tally(severities, `(all)\u0000${diagnostic.severity}`, kind);

  if (!rules.includes(diagnostic.code)) continue;
  tally(cells, `${name}\u0000${diagnostic.code}`, kind);
  tally(cells, `${name}\u0000(total)`, kind);
  tally(ruleTotals, diagnostic.code, kind);
  tally(ruleTotals, "(total)", kind);

  if (diagnostic.code === "eslint(max-lines)") {
    const lines = readFileSync(`${repository}/${diagnostic.filename}`, "utf8").split("\n").length;

    longFiles.push({ filename: diagnostic.filename, kind, lines });
  }
}

function counts(name) {
  const { source = 0, test = 0 } = cells.get(`${name}\u0000(total)`) ?? {};

  return source + test;
}

const columns = [...rules, "(total)"];
const header = `| package | ${columns.map((rule) => rule.replace(/^[\w-]+\((.*)\)$/, "$1")).join(" | ")} |`;
const divider = `|---|${columns.map(() => "---:").join("|")}|`;
const rows = [...packages]
  .toSorted((left, right) => left.localeCompare(right))
  .filter((name) => counts(name) > 0)
  .map(
    (name) =>
      `| ${name} | ${columns.map((rule) => readCell(cells, `${name}\u0000${rule}`)).join(" | ")} |`,
  );

const output = [
  `Linted ${report.number_of_files} files: ${readCell(severities, "(all)\u0000error") || 0} errors, ${readCell(severities, "(all)\u0000warning") || 0} warnings (\`N + Mt\` = N in source files, M in test files).`,
];

if (rules.length > 0) {
  output.push(
    "",
    header,
    divider,
    ...rows,
    `| **all** | ${columns.map((rule) => `**${readCell(ruleTotals, rule) || 0}**`).join(" | ")} |`,
  );
}

if (longFiles.length > 0) {
  output.push("", "| file over 1,000 lines | kind | lines |", "|---|---|---:|");

  for (const { filename, kind, lines } of longFiles.toSorted(
    (left, right) => right.lines - left.lines,
  )) {
    output.push(`| ${filename} | ${kind} | ${lines} |`);
  }
}

if (values.all) {
  const codes = [...new Set(report.diagnostics.map((diagnostic) => diagnostic.code))];
  const total = (code) =>
    ["error", "warning"].reduce((sum, severity) => {
      const { source = 0, test = 0 } = severities.get(`${code}\u0000${severity}`) ?? {};

      return sum + source + test;
    }, 0);

  output.push("", "| rule | errors | warnings |", "|---|---:|---:|");

  for (const code of codes.toSorted((left, right) => total(right) - total(left))) {
    output.push(
      `| ${code} | ${readCell(severities, `${code}\u0000error`)} | ${readCell(severities, `${code}\u0000warning`)} |`,
    );
  }
}

process.stdout.write(`${output.join("\n")}\n`);
