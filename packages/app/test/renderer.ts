import { execFile } from "node:child_process";
import { glob, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { stylex } from "@nyte-ai/ui/stylex";
import react from "@vitejs/plugin-react";
import electron from "electron";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { build, defaultClientConditions } from "vite";

const execute = promisify(execFile);

declare global {
  interface Window {
    readonly rendererCapture: (name: string) => void;
  }
}

const ELECTRON_CHROMIUM = 152 << 16;

export const NO_MOUSE = "The host has no mouse to hover or point finely with";

export async function testRenderer(
  entry: URL,
  setup = "",
  {
    pointer = "fine",
    forcePseudoClasses = [],
    forcePseudoSelector = "button",
    studio = false,
    captures,
    mouse = false,
    motion = "reduce",
  }: {
    pointer?: "fine" | "coarse";
    forcePseudoClasses?: readonly string[];
    forcePseudoSelector?: string;
    studio?: boolean;
    captures?: string;
    mouse?: boolean;
    motion?: "reduce" | "no-preference";
  } = {},
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "nyte-renderer-test-"));
  const sixtyFrames = process.env.NYTE_E2E_60FPS === "1";

  try {
    await mkdir(join(directory, "profile"));
    const nodeEnvironment = process.env.NODE_ENV;

    try {
      process.env.NODE_ENV = "production";
      await build({
        configFile: false,
        base: "./",
        resolve: {
          conditions: ["nyte-source", ...defaultClientConditions],
          dedupe: ["react", "react-dom"],
        },
        logLevel: "silent",
        define: { "process.env.NODE_ENV": JSON.stringify("production") },
        plugins: [
          stylex.rollup({
            devMode: "css-only",
            lightningcssOptions: { targets: { chrome: ELECTRON_CHROMIUM } },
          }),
          react({ compiler: true }),
        ],
        build: {
          outDir: directory,
          emptyOutDir: false,
          lib: {
            entry: fileURLToPath(entry),
            name: "RendererTest",
            formats: ["iife"],
            fileName: () => "fixture.js",
            cssFileName: "fixture",
          },
        },
      });
    } finally {
      if (nodeEnvironment === undefined) delete process.env.NODE_ENV;
      else process.env.NODE_ENV = nodeEnvironment;
    }

    const stylesheets: string[] = [];

    for await (const sheet of glob("**/*.css", { cwd: directory })) stylesheets.push(sheet);
    stylesheets.sort((first, second) => first.localeCompare(second));
    await writeFile(
      join(directory, "index.html"),
      `<!doctype html><meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="script-src 'self' 'unsafe-inline' 'wasm-unsafe-eval'">${stylesheets.map((sheet) => `<link rel="stylesheet" href="${sheet}">`).join("")}<body>
<script>
window.addEventListener("error", (event) => { window.fixtureFailure = event.error?.stack ?? event.message; });
${setup}
</script><script src="fixture.js"></script>`,
    );
    await writeFile(
      join(directory, "main.cjs"),
      `
const { app, BrowserWindow } = require("electron");
const { writeFileSync } = require("node:fs");
setInterval(() => { try { process.kill(${process.pid}, 0); } catch { app.exit(1); } }, 1000).unref();
app.setPath("userData", ${JSON.stringify(join(directory, "profile"))});
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: ${JSON.stringify(studio || process.platform !== "darwin")},${studio ? " width: 1280, height: 860," : ""} webPreferences: { backgroundThrottling: false } });
  try {
    await window.loadFile(${JSON.stringify(join(directory, "index.html"))});
    if (${JSON.stringify(studio)}) {
      window.on("closed", () => {
        writeFileSync(${JSON.stringify(join(directory, "result.txt"))}, "passed");
        app.exit(0);
      });
      await window.webContents.executeJavaScript("RendererTest.studio()");
      return;
    }
    if (${JSON.stringify(process.platform !== "darwin")}) {
      await window.webContents.executeJavaScript('new Promise((resolve) => { let settled = setTimeout(resolve, 100); addEventListener("resize", () => { clearTimeout(settled); settled = setTimeout(resolve, 100); }); })');
    }
    if (${JSON.stringify(mouse)} && !(await window.webContents.executeJavaScript('matchMedia("(any-pointer: fine) and (any-hover: hover)").matches'))) {
      writeFileSync(${JSON.stringify(join(directory, "result.txt"))}, ${JSON.stringify(NO_MOUSE)});
      app.exit(0);
      return;
    }
    window.webContents.debugger.attach("1.3");
    // Hidden test windows need focus emulation to dispatch native focus/blur events.
    await window.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
    await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
      features: [
        { name: "prefers-reduced-motion", value: ${JSON.stringify(motion)} },
        { name: "pointer", value: ${JSON.stringify(pointer)} },
        { name: "hover", value: ${JSON.stringify(pointer === "coarse" ? "none" : "hover")} },
      ],
    });
    await window.webContents.debugger.sendCommand("Emulation.setTouchEmulationEnabled", {
      enabled: ${JSON.stringify(pointer === "coarse")},
    });
    if (${forcePseudoClasses.length} > 0) {
      await window.webContents.executeJavaScript("RendererTest.mount()");
      await window.webContents.debugger.sendCommand("DOM.enable");
      await window.webContents.debugger.sendCommand("CSS.enable");
      const { root } = await window.webContents.debugger.sendCommand("DOM.getDocument");
      const { nodeIds } = await window.webContents.debugger.sendCommand("DOM.querySelectorAll", { nodeId: root.nodeId, selector: ${JSON.stringify(forcePseudoSelector)} });
      for (const nodeId of nodeIds) {
        await window.webContents.debugger.sendCommand("CSS.forcePseudoState", { nodeId, forcedPseudoClasses: ${JSON.stringify(forcePseudoClasses)} });
      }
    }
    await window.webContents.debugger.sendCommand("Runtime.addBinding", { name: "rendererMouseClick" });
    await window.webContents.debugger.sendCommand("Runtime.addBinding", { name: "rendererCapture" });
    window.webContents.debugger.on("message", async (_event, method, params) => {
      if (method !== "Runtime.bindingCalled" || params.name !== "rendererCapture") return;
      if (${JSON.stringify(captures !== undefined)}) {
        const image = await window.webContents.capturePage();
        writeFileSync(${JSON.stringify(join(captures ?? directory, "/"))} + params.payload + ".png", image.toPNG());
      }
      await window.webContents.executeJavaScript('document.dispatchEvent(new Event("renderer-captured"))');
    });
    window.webContents.debugger.on("message", async (_event, method, params) => {
      if (method !== "Runtime.bindingCalled" || params.name !== "rendererMouseClick") return;
      const { x, y, shift } = JSON.parse(params.payload);
      const point = { x, y, button: "left", clickCount: 1, modifiers: shift ? 8 : 0 };
      await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { ...point, type: "mousePressed" });
      await window.webContents.debugger.sendCommand("Input.dispatchMouseEvent", { ...point, type: "mouseReleased" });
      await window.webContents.executeJavaScript('document.dispatchEvent(new Event("renderer-mouse-clicked"))');
    });
    if (${JSON.stringify(sixtyFrames)}) {
      const intervals = await window.webContents.executeJavaScript('new Promise((resolve) => { const intervals = []; let previous; const sample = (time) => { if (previous !== undefined) intervals.push(time - previous); previous = time; if (intervals.length < 60) requestAnimationFrame(sample); else resolve(intervals); }; requestAnimationFrame(sample); })');
      const median = intervals.toSorted((first, second) => first - second)[29];
      if (${JSON.stringify(captures !== undefined)}) writeFileSync(${JSON.stringify(join(captures ?? directory, "cadence.json"))}, JSON.stringify({ intervalsMs: intervals, medianMs: median }, null, 2));
      if (Math.abs(median - 1000 / 60) >= 0.5) throw new Error("Expected 60Hz from 60 native animation-frame intervals; median was " + median.toFixed(3) + "ms");
    }
    const result = await window.webContents.executeJavaScript('(async () => { try { if (window.fixtureFailure) return window.fixtureFailure; const outcome = await RendererTest.run(); return window.fixtureFailure ?? outcome; } catch (error) { return error instanceof Error ? error.stack ?? error.message : String(error); } })()');
    writeFileSync(${JSON.stringify(join(directory, "result.txt"))}, result);
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});`,
    );

    if (!Value.Check(Type.String(), electron))
      throw new Error("Expected the Electron executable path");
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    await execute(
      electron,
      [
        join(directory, "main.cjs"),
        ...(sixtyFrames ? ["--enable-features=ThrottleMainFrameTo60Hz"] : []),
      ],
      {
        env,
        timeout: studio ? 0 : 40_000,
        killSignal: "SIGKILL",
      },
    );

    return await readFile(join(directory, "result.txt"), "utf8");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
