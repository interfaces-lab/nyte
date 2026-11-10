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

const fixture = join(here, "fixtures/design-scale-fixture.ts");

const foreignFixture = join(here, "fixtures/foreign-create-fixture.ts");

const configDirectory = mkdtempSync(join(tmpdir(), "nyte-design-scale-"));

type Violation = { file: string; line: number; rule: string; message: string };

let violations: Array<Violation> = [];

const pluginOnlyConfig = {
  categories: {},
  jsPlugins: [join(here, "design-scale.js")],
  rules: {
    "nyte-design/spacing-scale": "error",
    "nyte-design/size-grid": "error",
    "nyte-design/no-raw-font-weight": "error",
    "nyte-design/no-light-dark-outside-tokens": "error",
    "nyte-design/guarded-hover": "error",
    "nyte-design/logical-properties": "error",
    "nyte-design/no-faded-ink": "error",
    "nyte-design/disabled-ink": "error",
  },
};

const findLine = (needle: string): number => {
  const index = readFileSync(fixture, "utf8")
    .split("\n")
    .findIndex((line) => line.includes(needle));

  if (index < 0) throw new Error(`fixture line not found: ${needle}`);

  return index + 1;
};

const rulesOn = (needle: string): Array<string> =>
  violations
    .filter((entry) => entry.line === findLine(needle))
    .map((entry) => entry.rule)
    .sort();

beforeAll(async () => {
  const config = join(configDirectory, "oxlintrc.json");
  writeFileSync(config, JSON.stringify(pluginOnlyConfig));

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

const DISABLEABLE_HOVER = '      ":hover": { [media.hover]: ink },';

const HOVER_DEFAULT = '{ ":hover": { default: ink,';

const PARTLY_EXCLUDED_HOVER = '":hover:not([data-disabled])": { [media.hover]: ink }, ":disabled"';

const message = (needle: string): string =>
  violations.find((entry) => entry.line === findLine(needle))?.message ?? "";

test("reports every raw spacing length, off-grid size, raw weight, light-dark(), unguarded hover, physical side, and faded or disabled ink", () => {
  expect(new Set(violations.map((entry) => entry.line))).toEqual(
    new Set([
      findLine("onScale:"),
      findLine("negativeOnScale:"),
      findLine("offScale:"),
      findLine("aboveScale:"),
      findLine("negative:"),
      findLine("condition:"),
      findLine("pseudo:"),
      findLine("shorthandString:"),
      findLine("mixedShorthand:"),
      findLine("offGridSize:"),
      findLine("rawWeight:"),
      findLine("stringWeight:"),
      findLine("offTokenWeight:"),
      findLine("lightDark:"),
      findLine("lightDarkTemplate:"),
      findLine("bare: {"),
      findLine("return { paddingInline: 3"),
      findLine("unguardedHover:"),
      findLine(HOVER_DEFAULT),
      findLine(DISABLEABLE_HOVER),
      findLine(PARTLY_EXCLUDED_HOVER),
      findLine("physicalPadding:"),
      findLine("right: 0"),
      findLine("physicalAlign:"),
      findLine("leftWithoutTranslate:"),
      findLine("logicalCentred:"),
      findLine("const DIMMED ="),
      findLine("thinking:"),
      findLine("fadedPseudo:"),
      findLine("fadedText:"),
      findLine("rawMix:"),
      findLine("failed:"),
      findLine("idleRing:"),
      findLine("fadedHover:"),
      findLine("fadedAroundInk:"),
      findLine("fadedWhileEnabled:"),
      findLine('":not([data-disabled])": role.contentDisabled'),
      findLine("disabled ? role.contentDisabled : role.contentDisabled"),
    ]),
  );
});

test("ignores a `create` that is not StyleX's", () => {
  expect(violations.filter((entry) => entry.file.endsWith("foreign-create-fixture.ts"))).toEqual(
    [],
  );
});

const SPACING = "nyte-design(spacing-scale)";

const SIZE_GRID = "nyte-design(size-grid)";

const RAW_WEIGHT = "nyte-design(no-raw-font-weight)";

const LIGHT_DARK = "nyte-design(no-light-dark-outside-tokens)";

const GUARDED_HOVER = "nyte-design(guarded-hover)";

const LOGICAL = "nyte-design(logical-properties)";

const FADED_INK = "nyte-design(no-faded-ink)";

const DISABLED_INK = "nyte-design(disabled-ink)";

test.each<{ readonly needle: string; readonly rules: readonly string[] }>([
  { needle: "bare: {", rules: [SPACING] },
  { needle: "return { paddingInline: 3", rules: [SPACING] },
  { needle: "condition:", rules: [SPACING] },
  { needle: "mixedShorthand:", rules: [SPACING] },
  { needle: "shorthandString:", rules: [SPACING, SPACING] },
  { needle: "offGridSize:", rules: [SIZE_GRID, SIZE_GRID] },
  { needle: "offScale:", rules: [SPACING, SPACING] },
  { needle: "rawWeight:", rules: [RAW_WEIGHT] },
  { needle: "stringWeight:", rules: [RAW_WEIGHT, RAW_WEIGHT] },
  { needle: "lightDark:", rules: [LIGHT_DARK] },
  { needle: "lightDarkTemplate:", rules: [LIGHT_DARK] },
  { needle: "unguardedHover:", rules: [GUARDED_HOVER] },
  { needle: HOVER_DEFAULT, rules: [GUARDED_HOVER] },
  { needle: DISABLEABLE_HOVER, rules: [GUARDED_HOVER] },
  { needle: PARTLY_EXCLUDED_HOVER, rules: [GUARDED_HOVER] },
  { needle: "const DIMMED =", rules: [FADED_INK] },
  { needle: "thinking:", rules: [FADED_INK] },
  { needle: "fadedPseudo:", rules: [FADED_INK] },
  { needle: "fadedText:", rules: [FADED_INK] },
  { needle: "rawMix:", rules: [FADED_INK] },
  { needle: "failed:", rules: [DISABLED_INK] },
  { needle: "idleRing:", rules: [DISABLED_INK] },
  { needle: "fadedHover:", rules: [FADED_INK] },
  { needle: "fadedAroundInk:", rules: [FADED_INK] },
  { needle: "fadedWhileEnabled:", rules: [FADED_INK] },
  { needle: '":not([data-disabled])": role.contentDisabled', rules: [DISABLED_INK] },
  { needle: "disabled ? role.contentDisabled : role.contentDisabled", rules: [DISABLED_INK] },
  { needle: "physicalPadding:", rules: [LOGICAL] },
  { needle: "right: 0", rules: [LOGICAL] },
  { needle: "physicalAlign:", rules: [LOGICAL] },
  { needle: "leftWithoutTranslate:", rules: [LOGICAL] },
  { needle: "logicalCentred:", rules: [LOGICAL] },
])("reports $rules on $needle", (row) => {
  expect(rulesOn(row.needle)).toEqual(row.rules);
});

test.each<{ readonly needle: string; readonly fix: string }>([
  { needle: "onScale:", fix: "Use space.s2 from @nyte-ai/ui/styles/schema.stylex" },
  { needle: "negativeOnScale:", fix: "Use calc(${space.s1} * -1)" },
  { needle: "mixedShorthand:", fix: "Use space.s2" },
  { needle: "offScale:", fix: "Use space.s1_5 (6) or space.s2 (8)" },
  { needle: "negative:", fix: "Use calc(${space.s1} * -1) (-4) or calc(${space.s1_5} * -1) (-6)" },
  { needle: "aboveScale:", fix: "packages/ui/src/styles/schema.stylex.ts" },
  { needle: "offGridSize:", fix: "Use 14 or 16." },
  { needle: "rawWeight:", fix: "Use type.weightSemibold" },
  { needle: "offTokenWeight:", fix: "Use the nearest, type.weightSemibold (600)" },
  { needle: "lightDark:", fix: "packages/ui/src/styles/roles.stylex.ts" },
  { needle: "unguardedHover:", fix: '":hover": { [media.hover]: … }' },
  { needle: HOVER_DEFAULT, fix: '":hover": { [media.hover]: … }' },
  {
    needle: DISABLEABLE_HOVER,
    fix: '":hover:not(:disabled, [data-disabled])": { [media.hover]: … }',
  },
  { needle: PARTLY_EXCLUDED_HOVER, fix: '":hover:not([data-disabled]):not(:disabled)"' },
  {
    needle: "const DIMMED =",
    fix: "Mixing content roles makes an off-stair colour; pick a stair.",
  },
  { needle: "thinking:", fix: "Pick a lower content stair (role.contentTertiary" },
  { needle: "fadedPseudo:", fix: '"opacity: 0.6" fades text set to role.contentTertiary' },
  { needle: "fadedText:", fix: "blends role.contentPrimary with another colour" },
  { needle: "rawMix:", fix: "blends var(--nyte-content-primary)" },
  { needle: "failed:", fix: "Use role.contentTertiary for information" },
  { needle: "idleRing:", fix: "role.contentQuaternary for decoration" },
  { needle: "fadedHover:", fix: '"opacity: 0.5" fades text set to role.contentPrimary' },
  { needle: "fadedAroundInk:", fix: '"opacity: 0.5" fades text set to role.contentPrimary' },
  { needle: "fadedWhileEnabled:", fix: "Pick a lower content stair" },
  {
    needle: '":not([data-disabled])": role.contentDisabled',
    fix: "contentDisabled is for disabled controls",
  },
  {
    needle: "disabled ? role.contentDisabled : role.contentDisabled",
    fix: "contentDisabled is for disabled controls",
  },
  { needle: "physicalPadding:", fix: "Use paddingInlineStart." },
  { needle: "right: 0", fix: "Use insetInlineEnd." },
  { needle: "physicalAlign:", fix: 'Use textAlign: "end".' },
  { needle: "leftWithoutTranslate:", fix: "Use insetInlineStart." },
  { needle: "logicalCentred:", fix: 'Centre with left: "50%"' },
])("names the way out on $needle", (row) => {
  expect(message(row.needle)).toContain(row.fix);
});
