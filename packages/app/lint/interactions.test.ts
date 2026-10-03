import { execFile } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { expect, test } from "vitest";

const execute = promisify(execFile);

const rules = [
  "no-clickable-non-control",
  "drag-only-touch-action",
  "restore-popup-focus",
  "named-stylex-imports",
  "accessible-pressable",
  "specific-confirm-label",
  "no-disabled-caption",
  "title-case-control-label",
];

const FailedRun = Type.Object({ stdout: Type.String() });

const Report = Type.Object({ diagnostics: Type.Array(Type.Object({ code: Type.String() })) });

test("interaction guards reject regressions and accept semantic controls", async () => {
  const directory = await mkdtemp(join(tmpdir(), "nyte-interaction-lint-"));

  try {
    const config = join(directory, "oxlintrc.json");
    await writeFile(
      config,
      JSON.stringify({
        categories: { correctness: "off" },
        jsPlugins: [fileURLToPath(new URL("./interactions.js", import.meta.url))],
        rules: Object.fromEntries(rules.map((name) => [`nyte-interactions/${name}`, "error"])),
      }),
    );
    const rejected = join(directory, "rejected.tsx");
    const accepted = join(directory, "accepted.tsx");
    await writeFile(
      rejected,
      `import * as stylex from "@stylexjs/stylex";
const layout = { touchAction: "none" };
const controls = <><div onClick={() => {}} /><Dialog finalFocus={false} /><Pressable onPress={() => {}} /><Button>Confirm</Button><Button>save file</Button><MenuItem meta={disabled ? "No file open" : "⌘S"}>Save</MenuItem></>;`,
    );
    await writeFile(
      accepted,
      `import { create } from "@stylexjs/stylex";
const layout = { touchAction: "manipulation" };
const controls = <><button onClick={() => {}} /><div role="option" onClick={() => {}} /><Dialog /><Pressable accessibilityRole="link" /><Button>Delete File</Button><p>No {count} matches</p><MenuItem disabled={disabled} meta="⌘S">Save</MenuItem></>;`,
    );

    const output = await execute("node", [
      fileURLToPath(new URL("../../../node_modules/oxlint/bin/oxlint", import.meta.url)),
      "--config",
      config,
      "--format",
      "json",
      rejected,
      accepted,
    ]).catch((error) => {
      if (Value.Check(FailedRun, error)) return { stdout: error.stdout };
      throw error;
    });

    const report = Value.Parse(Report, JSON.parse(output.stdout));
    expect(
      report.diagnostics
        .map((diagnostic) => diagnostic.code)
        .sort((first, second) => first.localeCompare(second)),
    ).toEqual(
      rules
        .map((name) => `nyte-interactions(${name})`)
        .sort((first, second) => first.localeCompare(second)),
    );
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});
