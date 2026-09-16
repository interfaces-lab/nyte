import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, test } from "vitest";

/**
 * The rules only constrain anything if they still fire. This runs oxlint over a
 * fixture of deliberate values and asserts which rule reports which line, so a
 * visitor that stops descending into conditions, or a call form it no longer
 * recognises, fails here rather than going quiet.
 */
const run = promisify(execFile);
const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, "../../..");
const fixture = join(here, "fixtures/design-scale-fixture.ts");
const foreignFixture = join(here, "fixtures/foreign-create-fixture.ts");
const configDirectory = mkdtempSync(join(tmpdir(), "nyte-design-scale-"));

type Violation = { file: string; line: number; rule: string; message: string };
let violations: Array<Violation> = [];

const lineOf = (needle: string): number => {
  const index = readFileSync(fixture, "utf8")
    .split("\n")
    .findIndex((line) => line.includes(needle));
  if (index < 0) throw new Error(`fixture line not found: ${needle}`);
  return index + 1;
};

const rulesOn = (needle: string): Array<string> =>
  violations
    .filter((entry) => entry.line === lineOf(needle))
    .map((entry) => entry.rule)
    .sort();

beforeAll(async () => {
  const config = join(configDirectory, "oxlintrc.json");
  writeFileSync(
    config,
    JSON.stringify({
      // Only the plugin runs: an unrelated warning in the fixture must not read
      // as a design-scale violation.
      categories: {},
      jsPlugins: [join(here, "design-scale.js")],
      rules: { "nyte-design/spacing-scale": "error", "nyte-design/size-grid": "error" },
    }),
  );
  const result = await run("node", [
    join(repoRoot, "node_modules/oxlint/bin/oxlint"),
    "--config",
    config,
    "--format",
    "json",
    fixture,
    foreignFixture,
  ]).catch((error: { stdout?: string }) => ({ stdout: error.stdout ?? "" }));
  if (!result.stdout.startsWith("{")) throw new Error(`oxlint did not report: ${result.stdout}`);
  const report: {
    diagnostics?: Array<{
      code?: string;
      filename?: string;
      message: string;
      labels?: Array<{ span: { line: number } }>;
    }>;
  } = JSON.parse(result.stdout);
  violations = (report.diagnostics ?? []).map((diagnostic) => ({
    file: diagnostic.filename ?? "",
    rule: diagnostic.code ?? "",
    message: diagnostic.message,
    line: diagnostic.labels?.[0]?.span.line ?? 0,
  }));
  expect(violations.every((entry) => entry.rule.startsWith("nyte-design"))).toBe(true);
});

afterAll(() => {
  rmSync(configDirectory, { recursive: true, force: true });
});

test("reports every off-scale length and nothing else", () => {
  expect(new Set(violations.map((entry) => entry.line))).toEqual(
    new Set([
      lineOf("offScale:"),
      lineOf("aboveScale:"),
      lineOf("negative:"),
      lineOf("condition:"),
      lineOf("pseudo:"),
      lineOf("shorthandString:"),
      lineOf("offGridSize:"),
      lineOf("bare: {"),
      lineOf("return { paddingInline: 3"),
    ]),
  );
});

test("ignores a `create` that is not StyleX's", () => {
  expect(violations.filter((entry) => entry.file.endsWith("foreign-create-fixture.ts"))).toEqual(
    [],
  );
});

test("reads both call forms, conditions, and shorthand strings", () => {
  expect(rulesOn("bare: {")).toEqual(["nyte-design(spacing-scale)"]);
  expect(rulesOn("return { paddingInline: 3")).toEqual(["nyte-design(spacing-scale)"]);
  expect(rulesOn("condition:")).toEqual(["nyte-design(spacing-scale)"]);
  expect(rulesOn("shorthandString:")).toEqual(["nyte-design(spacing-scale)"]);
  expect(rulesOn("offGridSize:")).toEqual(["nyte-design(size-grid)", "nyte-design(size-grid)"]);
  expect(rulesOn("offScale:")).toEqual([
    "nyte-design(spacing-scale)",
    "nyte-design(spacing-scale)",
  ]);
});

test("names a replacement step, and a token past the end of the scale", () => {
  const message = (needle: string): string =>
    violations.find((entry) => entry.line === lineOf(needle))?.message ?? "";

  expect(message("offScale:")).toContain("Use 6 or 8");
  expect(message("negative:")).toContain("Use -4 or -6");
  expect(message("aboveScale:")).toContain("schema.stylex.ts");
  expect(message("offGridSize:")).toContain("Use 14 or 16");
});
