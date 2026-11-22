import { execFile } from "node:child_process";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { expect, test } from "vitest";

const run = promisify(execFile);

const here = import.meta.dirname;

const fixture = join(here, "fixtures/control-size-fixture.ts");

test("control sizes and touch sizes come from tokens", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nyte-control-size-"));

  try {
    const config = join(directory, "oxlintrc.json");
    writeFileSync(
      config,
      JSON.stringify({
        categories: {},
        jsPlugins: [join(here, "design-scale.js")],
        rules: { "nyte-design/control-size": "error", "nyte-design/touch-in-tokens": "error" },
      }),
    );

    const result = await run("node", [
      join(here, "../../../node_modules/oxlint/bin/oxlint"),
      "--config",
      config,
      "--format",
      "json",
      fixture,
    ]).catch((error: unknown) => ({
      stdout:
        typeof error === "object" &&
        error !== null &&
        "stdout" in error &&
        typeof error.stdout === "string"
          ? error.stdout
          : "",
    }));

    const report: {
      diagnostics?: { code?: string; labels?: { span: { line: number } }[] }[];
    } = JSON.parse(result.stdout);

    const lines = readFileSync(fixture, "utf8").split("\n");

    const found = (report.diagnostics ?? [])
      .map((entry) => {
        const line = lines[(entry.labels?.[0]?.span.line ?? 0) - 1] ?? "";

        return `${line.trim().split(":")[0]} ${entry.code ?? ""}`;
      })
      .sort();

    expect(found).toEqual([
      "handSized nyte-design(control-size)",
      "handSizedGlyph nyte-design(control-size)",
      "handSizedGlyph nyte-design(control-size)",
      "touchFork nyte-design(control-size)",
      "touchFork nyte-design(touch-in-tokens)",
      "touchGap nyte-design(touch-in-tokens)",
    ]);
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
