import { mkdir, readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { readCanvasFixture } from "@nyte-ai/canvas/fixtures";
import { compileCanvas } from "@nyte-ai/plugin/core/canvas-compile";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { expect, it } from "vitest";
import { chromiumCanvasPreview, findChromium } from "../src/canvas-preview.ts";
import type { CanvasShellFiles } from "../src/canvas-preview.ts";

const canvasPackage = fileURLToPath(new URL("../../canvas/", import.meta.url));

const galaxy = join(canvasPackage, "test/fixtures/repo-galaxy");

/** Reads packages/canvas/dist/shell-files.js without importing it, so the test can skip before a build. */
async function readShell(): Promise<CanvasShellFiles | undefined> {
  const text = await readFile(join(canvasPackage, "dist", "shell-files.js"), "utf8").catch(
    () => undefined,
  );
  const json = text === undefined ? undefined : /^export const files = (.*);\s*$/su.exec(text)?.[1];
  const files: unknown = json === undefined ? undefined : JSON.parse(json);

  return Value.Check(Type.Record(Type.String(), Type.String()), files) ? files : undefined;
}

const shell = await readShell();

const chromium = findChromium();

it.skipIf(shell === undefined || chromium === undefined)(
  "previews the multi-file repo-galaxy canvas in a headless Chromium: a screenshot, both heights, no errors",
  { timeout: 90_000 },
  async () => {
    if (shell === undefined) return;
    const { source, files } = await readCanvasFixture(galaxy);
    const compiled = await compileCanvas(source, files);

    if (compiled.kind !== "compiled") throw new Error(JSON.stringify(compiled.errors));
    const outcome = await chromiumCanvasPreview(shell)(
      {
        module: { runtime: compiled.runtime, code: compiled.code, title: "Repo galaxy" },
        theme: "dark",
      },
      new AbortController().signal,
    );

    if (outcome.kind !== "rendered") throw new Error(outcome.reason);
    const { report } = outcome;

    expect(report.errors).toEqual([]);
    expect([...report.png.subarray(0, 4)]).toEqual([0x89, 0x50, 0x4e, 0x47]);
    expect(report.heights.chat).toBeGreaterThan(600);
    expect(report.heights.phone).toBeGreaterThan(report.heights.chat);

    const proof = process.env["NYTE_CANVAS_PROOF"];

    if (proof !== undefined) {
      await mkdir(proof, { recursive: true });
      await writeFile(join(proof, "preview-chromium-repo-galaxy-dark.png"), report.png);
      await writeFile(
        join(proof, "preview-chromium-repo-galaxy-dark.json"),
        JSON.stringify({ ...report, png: `${report.png.byteLength} bytes` }, null, 2),
      );
    }
  },
);

it.skipIf(shell === undefined || chromium === undefined)(
  "reports a runtime error with its source file and line, and the canvas's console",
  { timeout: 60_000 },
  async () => {
    if (shell === undefined) return;
    const compiled = await compileCanvas(
      `import { Text } from "nyte/canvas";\nimport { rows } from "./rows.ts";\nexport default function View() {\n  console.warn("rows", rows.length);\n  return <Text>{rows[3].label}</Text>;\n}`,
      { "rows.ts": "export const rows: { label: string }[] = [];" },
    );

    if (compiled.kind !== "compiled") throw new Error(JSON.stringify(compiled.errors));
    const outcome = await chromiumCanvasPreview(shell)(
      {
        module: { runtime: compiled.runtime, code: compiled.code, title: "Broken" },
        theme: "light",
      },
      new AbortController().signal,
    );

    if (outcome.kind !== "rendered") throw new Error(outcome.reason);

    expect(outcome.report.errors).toMatchObject([
      { phase: "render", message: expect.stringMatching(/^TypeError: .* \(main\.tsx:5\)$/u) },
    ]);
    expect(outcome.report.console).toContainEqual({ level: "warn", text: "rows 0" });
  },
);

it.skipIf(shell === undefined || chromium === undefined)(
  "stops the browser of a canvas that hangs its page once the signal aborts",
  { timeout: 30_000 },
  async () => {
    if (shell === undefined) return;
    const compiled = await compileCanvas("export default function Loop() {\n  for (;;) {}\n}");

    if (compiled.kind !== "compiled") throw new Error(JSON.stringify(compiled.errors));
    const started = performance.now();
    const outcome = await chromiumCanvasPreview(shell)(
      { module: { runtime: compiled.runtime, code: compiled.code, title: "Loop" }, theme: "light" },
      AbortSignal.timeout(3000),
    );

    expect(outcome).toMatchObject({ kind: "unavailable" });
    expect(performance.now() - started).toBeLessThan(10_000);
  },
);

it("answers unavailable when there is no Chromium", async () => {
  expect(
    await chromiumCanvasPreview({}, () => undefined)(
      { module: { runtime: 2, code: "", title: "" }, theme: "light" },
      new AbortController().signal,
    ),
  ).toEqual({ kind: "unavailable", reason: "No Chrome or Chromium was found on this machine." });
});
