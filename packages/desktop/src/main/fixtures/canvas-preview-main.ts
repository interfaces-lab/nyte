import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { readFile, readdir } from "node:fs/promises";
import { join } from "node:path";
import { app } from "electron";
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
  const names = (await readdir(fixture)).filter((name) => /\.tsx?$/u.test(name));
  const read = (name: string) => readFile(join(fixture, name), "utf8");
  const compiled = await compileCanvas(
    await read("main.tsx"),
    Object.fromEntries(
      await Promise.all(
        names.filter((name) => name !== "main.tsx").map(async (name) => [name, await read(name)]),
      ),
    ),
  );

  if (compiled.kind === "failed") throw new Error(JSON.stringify(compiled.errors));
  await app.whenReady();
  const results = [];

  for (const theme of ["dark", "light"] as const) {
    const outcome = await previewCanvasOffscreen(canvasShellUrl(scheme), {
      module: { runtime: compiled.runtime, code: compiled.code, title: "Fixture" },
      theme,
    });

    if (outcome.kind !== "rendered") throw new Error(outcome.reason);
    writeFileSync(join(directory, `preview-${theme}.png`), outcome.report.png);
    results.push({ theme, ...outcome.report, png: outcome.report.png.byteLength });
  }

  writeFileSync(join(directory, "result.json"), JSON.stringify(results, null, 2));
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
