import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { app } from "electron";
import { readCanvasFixture } from "@nyte-ai/canvas/fixtures";
import { compileCanvas } from "@nyte-ai/plugin/core/canvas-compile";
import { ACCOUNT_SCHEMES } from "../../account/scheme.ts";
import { previewCanvasOffscreen } from "../canvas-preview.ts";
import { canvasShellUrl, registerRenderer } from "../renderer.ts";

const directory = process.argv[2];

const shellRoot = process.argv[3];

const fixture = process.argv[4];

assert.ok(directory !== undefined && shellRoot !== undefined && fixture !== undefined);

app.setPath("userData", join(directory, "profile"));

app.on("window-all-closed", () => undefined);

const scheme = ACCOUNT_SCHEMES.development;

process.env.ELECTRON_RENDERER_URL = "http://127.0.0.1:9";

registerRenderer({ scheme, frontendApiHost: undefined, shellRoot });

/** Previews the fixture folder's main.tsx and its files offscreen in the scheme-served shell, in both themes. */
async function run(): Promise<void> {
  const { source, files } = await readCanvasFixture(fixture);
  const compiled = await compileCanvas(source, files);

  if (compiled.kind === "failed") throw new Error(JSON.stringify(compiled.errors));
  await app.whenReady();
  const results = [];

  for (const theme of ["dark", "light"] as const) {
    const outcome = await previewCanvasOffscreen(
      canvasShellUrl(scheme),
      { module: { runtime: compiled.runtime, code: compiled.code, title: "Fixture" }, theme },
      new AbortController().signal,
    );

    if (outcome.kind !== "rendered") throw new Error(outcome.reason);
    writeFileSync(join(directory, `preview-${theme}.png`), outcome.report.png);
    results.push({ theme, ...outcome.report, png: outcome.report.png.byteLength });
  }

  const hung = await compileCanvas("export default function Loop() {\n  for (;;) {}\n}");
  const plain = await compileCanvas(
    'import { Text } from "nyte/canvas";\nexport default () => <Text>After the loop</Text>;',
  );

  if (hung.kind === "failed" || plain.kind === "failed")
    throw new Error("A probe did not compile.");
  const started = performance.now();
  const stuck = await previewCanvasOffscreen(
    canvasShellUrl(scheme),
    { module: { runtime: hung.runtime, code: hung.code, title: "Loop" }, theme: "light" },
    AbortSignal.timeout(3000),
  );
  const stoppedAfter = performance.now() - started;
  const after = await previewCanvasOffscreen(
    canvasShellUrl(scheme),
    { module: { runtime: plain.runtime, code: plain.code, title: "After" }, theme: "light" },
    AbortSignal.timeout(30_000),
  );

  writeFileSync(
    join(directory, "result.json"),
    JSON.stringify(
      {
        galaxy: results,
        hung: { kind: stuck.kind, ms: Math.round(stoppedAfter) },
        after: after.kind === "rendered" ? { kind: after.kind, ...after.report, png: 0 } : after,
      },
      null,
      2,
    ),
  );
}

run().then(
  () => {
    writeFileSync(join(directory, "result.txt"), "passed");
    app.exit(0);
  },
  (error: Error) => {
    writeFileSync(join(directory, "result.txt"), error.stack ?? error.message);
    app.exit(0);
  },
);
