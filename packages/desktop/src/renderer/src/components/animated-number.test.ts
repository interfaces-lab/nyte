import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import stylex from "@stylexjs/unplugin";
import electron from "electron";
import { build } from "vite";
import { afterAll, beforeAll, expect, test } from "vitest";

const execute = promisify(execFile);
let directory = "";

beforeAll(async () => {
  directory = await mkdtemp(join(tmpdir(), "nyte-number-test-"));
  await Promise.all([mkdir(join(directory, "profile")), mkdir(join(directory, "session"))]);
  await build({
    configFile: false,
    logLevel: "silent",
    define: { "process.env.NODE_ENV": JSON.stringify("development") },
    plugins: [stylex.rollup({ devMode: "css-only", runtimeInjection: false })],
    build: {
      outDir: directory,
      emptyOutDir: false,
      lib: {
        entry: fileURLToPath(new URL("./animated-number.browser-test.tsx", import.meta.url)),
        name: "NumberTest",
        formats: ["iife"],
        fileName: () => "number.js",
        cssFileName: "number",
      },
    },
  });
  await writeFile(
    join(directory, "index.html"),
    '<!doctype html><link rel="stylesheet" href="number.css"><script src="number.js"></script>',
  );
  await writeFile(
    join(directory, "main.cjs"),
    `
    const { app, BrowserWindow } = require("electron");
    const { writeFileSync } = require("node:fs");
    app.setPath("userData", ${JSON.stringify(join(directory, "profile"))});
    app.setPath("sessionData", ${JSON.stringify(join(directory, "session"))});
    app.whenReady().then(async () => {
      const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
      try {
        await window.loadFile(${JSON.stringify(join(directory, "index.html"))});
        window.webContents.debugger.attach("1.3");
        await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
          features: [{ name: "prefers-reduced-motion", value: process.argv[2] }],
        });
        const result = await window.webContents.executeJavaScript('(async () => { try { return await NumberTest.run(' + (process.argv[2] === "reduce") + '); } catch (error) { return error.stack; } })()');
        writeFileSync(process.argv[3], result);
        app.exit(0);
      } catch (error) {
        console.error(error);
        app.exit(1);
      }
    });
  `,
  );
}, 30_000);

afterAll(async () => {
  if (directory !== "") await rm(directory, { recursive: true, force: true });
});

test.each(["no-preference", "reduce"])(
  "diff counts in Chromium with %s motion",
  async (motion) => {
    if (typeof electron !== "string") throw new Error("Expected the Electron executable path");
    const resultPath = join(directory, `${motion}.txt`);
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    await execute(electron, [join(directory, "main.cjs"), motion, resultPath], {
      env,
      timeout: 20_000,
    });
    expect(await readFile(resultPath, "utf8")).toBe("passed");
  },
  30_000,
);
