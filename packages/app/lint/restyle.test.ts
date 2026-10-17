import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, expect, test } from "vitest";

const run = promisify(execFile);

const here = dirname(fileURLToPath(import.meta.url));

const repoRoot = join(here, "../../..");

const fixture = join(here, "fixtures/restyle-fixture.tsx");

const configDirectory = mkdtempSync(join(tmpdir(), "nyte-restyle-"));

type Violation = { line: number; message: string };

let violations: Array<Violation> = [];

const findLine = (needle: string): number => {
  const index = readFileSync(fixture, "utf8")
    .split("\n")
    .findIndex((line) => line.includes(needle));

  if (index < 0) throw new Error(`fixture line not found: ${needle}`);

  return index + 1;
};

const message = (needle: string): string =>
  violations.find((entry) => entry.line === findLine(needle))?.message ?? "";

beforeAll(async () => {
  const config = join(configDirectory, "oxlintrc.json");
  writeFileSync(
    config,
    JSON.stringify({
      categories: {},
      jsPlugins: [join(here, "restyle.js")],
      rules: { "nyte-restyle/no-restyle": "error" },
    }),
  );

  const result = await run("node", [
    join(repoRoot, "node_modules/oxlint/bin/oxlint"),
    "--config",
    config,
    "--format",
    "json",
    fixture,
  ]).catch((error: { stdout?: string }) => ({ stdout: error.stdout ?? "" }));

  if (!result.stdout.startsWith("{")) throw new Error(`oxlint did not report: ${result.stdout}`);

  const report: {
    diagnostics?: Array<{ message: string; labels?: Array<{ span: { line: number } }> }>;
  } = JSON.parse(result.stdout);

  violations = (report.diagnostics ?? []).map((diagnostic) => ({
    message: diagnostic.message,
    line: diagnostic.labels?.[0]?.span.line ?? 0,
  }));
});

afterAll(() => {
  rmSync(configDirectory, { recursive: true, force: true });
});

test("reports only properties outside each component's contract", () => {
  expect(new Set(violations.map((entry) => entry.line))).toEqual(
    new Set([findLine(">Padded<"), findLine(">Typed<"), findLine(">Paint<")]),
  );
});

test("names the owned concern, the rejected properties, and the way out", () => {
  const padded = message(">Padded<");

  expect(padded).toContain("<Button> owns its spacing and colours");
  expect(padded).toContain("paddingInline and backgroundColor (from styles.padded)");
  expect(padded).toContain("Choose its look with variant, size, tone, and iconOnly");
  expect(padded).toContain("packages/ui/src/button.tsx");
});

test("reads shared text styles and leaves component hooks, host parts, and bare rows alone", () => {
  expect(message(">Typed<")).toContain("fontSize, lineHeight, and letterSpacing (from text.sm)");
  expect(message(">Hooks<")).toBe("");
  expect(message(`variant="bare"`)).toBe("");
  expect(message(">Host<")).toBe("");
});
