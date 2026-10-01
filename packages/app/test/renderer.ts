import { execFile } from "node:child_process";
import { glob, mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import { stylex } from "@nyte-ai/ui/stylex";
import electron from "electron";
import { build, defaultClientConditions } from "vite";

const execute = promisify(execFile);

/** Run a fixture's exported run() in an isolated, styled Electron renderer. */
export async function testRenderer(
  entry: URL,
  setup = "",
  {
    pointer = "fine",
    forcePseudoClasses = [],
    forcePseudoSelector = "button",
    runtimeInjection = false,
  }: {
    pointer?: "fine" | "coarse";
    /** Inject rules from the bundle at runtime, as the development server does. */
    runtimeInjection?: boolean;
    forcePseudoClasses?: readonly string[];
    forcePseudoSelector?: string;
  } = {},
): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "nyte-renderer-test-"));
  try {
    await mkdir(join(directory, "profile"));
    await build({
      configFile: false,
      resolve: { conditions: ["nyte-source", ...defaultClientConditions] },
      logLevel: "silent",
      esbuild: { jsxDev: false },
      define: { "process.env.NODE_ENV": JSON.stringify("production") },
      plugins: [
        stylex.rollup({
          devMode: "css-only",
          runtimeInjection,
          // Electron's Chromium, as the app build targets. Older targets make
          // lightningcss polyfill the tokens' light-dark() with variables only
          // its own color-scheme rules define.
          lightningcssOptions: { targets: { chrome: 152 << 16 } },
        }),
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
    const stylesheets: string[] = [];
    for await (const sheet of glob("**/*.css", { cwd: directory })) stylesheets.push(sheet);
    stylesheets.sort((first, second) => first.localeCompare(second));
    await writeFile(
      join(directory, "index.html"),
      `<!doctype html><meta charset="utf-8">${stylesheets.map((sheet) => `<link rel="stylesheet" href="${sheet}">`).join("")}<body>
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
app.setPath("userData", ${JSON.stringify(join(directory, "profile"))});
app.whenReady().then(async () => {
  const window = new BrowserWindow({ show: false, webPreferences: { backgroundThrottling: false } });
  try {
    await window.loadFile(${JSON.stringify(join(directory, "index.html"))});
    window.webContents.debugger.attach("1.3");
    // Hidden test windows need focus emulation to dispatch native focus/blur events.
    await window.webContents.debugger.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
    await window.webContents.debugger.sendCommand("Emulation.setEmulatedMedia", {
      features: [
        { name: "prefers-reduced-motion", value: "reduce" },
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
    const result = await window.webContents.executeJavaScript('(async () => { try { if (window.fixtureFailure) return window.fixtureFailure; return await RendererTest.run(); } catch (error) { return error instanceof Error ? error.stack ?? error.message : String(error); } })()');
    writeFileSync(${JSON.stringify(join(directory, "result.txt"))}, result);
    app.exit(0);
  } catch (error) {
    console.error(error);
    app.exit(1);
  }
});`,
    );
    if (typeof electron !== "string") throw new Error("Expected the Electron executable path");
    const env = { ...process.env };
    delete env.ELECTRON_RUN_AS_NODE;
    await execute(electron, [join(directory, "main.cjs")], { env, timeout: 40_000 });
    return await readFile(join(directory, "result.txt"), "utf8");
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
