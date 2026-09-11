import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import stylex from "@stylexjs/unplugin";
import electron from "electron";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { build } from "vite";
import { afterAll, beforeAll, expect, test } from "vitest";

const execute = promisify(execFile);
let directory = "";

const Report = Type.Object({
  streaming: Type.Boolean(),
  typed: Type.Number(),
  rendered: Type.Number(),
  maxCharsPerFrame: Type.Number(),
  maxLatencyMs: Type.Number(),
  p95LatencyMs: Type.Number(),
  frames: Type.Number(),
  longestFrameMs: Type.Number(),
  coalescedAtMs: Type.Array(Type.Number()),
});

/** Two frames at 60Hz plus scheduling jitter; anything slower reads as lag. */
const LATENCY_BUDGET_MS = 40;

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "nyte-composer-latency-"));
  await Promise.all([mkdir(join(directory, "profile")), mkdir(join(directory, "session"))]);
  // Production mode: the measurement must not carry dev-only React checks.
  await build({
    configFile: false,
    mode: "production",
    // Vitest runs with NODE_ENV=test, which would otherwise pick the dev JSX runtime.
    esbuild: { jsxDev: false },
    logLevel: "silent",
    define: { "process.env.NODE_ENV": JSON.stringify("production") },
    plugins: [stylex.rollup({ devMode: "css-only", runtimeInjection: false })],
    build: {
      outDir: directory,
      emptyOutDir: false,
      lib: {
        entry: fileURLToPath(new URL("./composer-latency.browser-test.tsx", import.meta.url)),
        name: "LatencyTest",
        formats: ["iife"],
        fileName: () => "latency.js",
        cssFileName: "latency",
      },
    },
  });
  await writeFile(
    join(directory, "index.html"),
    `<!doctype html><html data-theme="light"><meta charset="utf-8"><link rel="stylesheet" href="latency.css"><body>
<script>
// The renderer reads window.nyte at module load; the harness never calls the host.
const stub = () => new Proxy(function () {}, {
  get: (_, key) => key === "then" ? undefined : key === "landing" ? { lanes: [{ lane: "steer", lands: "boundary" }, { lane: "queue", lands: "idle" }] } : stub(),
  apply: () => Promise.reject(new Error("stub")),
});
window.nyte = stub();
</script>
<script src="latency.js"></script></body></html>`,
  );
  await writeFile(
    join(directory, "main.cjs"),
    `
    const { app, BrowserWindow } = require("electron");
    const { writeFileSync } = require("node:fs");
    app.setPath("userData", ${JSON.stringify(join(directory, "profile"))});
    app.setPath("sessionData", ${JSON.stringify(join(directory, "session"))});
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, width: 900, height: 700, webPreferences: { backgroundThrottling: false } });
      try {
        await window.loadFile(${JSON.stringify(join(directory, "index.html"))});
        const result = await window.webContents.executeJavaScript('(async () => { try { return JSON.stringify(await LatencyTest.run(' + (process.argv[2] === "streaming") + ')); } catch (error) { return error.stack; } })()');
        writeFileSync(process.argv[3], result);
        app.exit(0);
      } catch (error) {
        console.error(error);
        app.exit(1);
      }
    });
  `,
  );
}, 60_000);

afterAll(async () => {
  if (directory !== "") await rm(directory, { recursive: true, force: true });
});

test.each(["idle", "streaming"])(
  "every keystroke paints on its own frame while the chat is %s",
  // Other test files spawn their own Electron at the same time; a regression
  // fails every attempt, contention fails one.
  { timeout: 60_000, retry: 2 },
  async (mode) => {
    if (typeof electron !== "string") throw new Error("Expected the Electron executable path");
    const resultPath = join(directory, `${mode}.json`);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    await execute(electron, [join(directory, "main.cjs"), mode, resultPath], {
      env,
      timeout: 30_000,
    });
    const raw = await readFile(resultPath, "utf8");
    if (!raw.startsWith("{")) throw new Error(raw);
    const report = Value.Parse(Report, JSON.parse(raw));
    const detail = JSON.stringify(report);
    expect(report.rendered, detail).toBe(report.typed);
    expect(report.maxCharsPerFrame, detail).toBe(1);
    expect(report.p95LatencyMs, detail).toBeLessThan(LATENCY_BUDGET_MS);
    expect(report.maxLatencyMs, detail).toBeLessThan(LATENCY_BUDGET_MS * 2);
  },
);
