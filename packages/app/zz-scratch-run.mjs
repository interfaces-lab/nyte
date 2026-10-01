import { execFile } from "node:child_process";
import { glob, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";
import stylex from "@stylexjs/unplugin";
import electron from "electron";
import { build, defaultClientConditions } from "vite";

const entry = new URL("./src/chrome/zz-scratch-preview.browser-test.tsx", import.meta.url);
const scenario = process.argv[2] ?? "default";
const directory = await mkdtemp(join(tmpdir(), "nyte-scratch-"));
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
      runtimeInjection: false,
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
const sheets = [];
for await (const sheet of glob("**/*.css", { cwd: directory })) sheets.push(sheet);
await writeFile(
  join(directory, "index.html"),
  `<!doctype html><meta charset="utf-8">${sheets.map((s) => `<link rel="stylesheet" href="${s}">`).join("")}<body style="background:#222"><script src="fixture.js"></script>`,
);
await writeFile(
  join(directory, "main.cjs"),
  `
const { app, BrowserWindow } = require("electron");
const { writeFileSync } = require("node:fs");
app.setPath("userData", ${JSON.stringify(join(directory, "profile"))});
const log = [];
app.whenReady().then(async () => {
  const window = new BrowserWindow({ width: 900, height: 600, show: false, webPreferences: { backgroundThrottling: false } });
  try {
    await window.loadFile(${JSON.stringify(join(directory, "index.html"))});
    const dbg = window.webContents.debugger;
    dbg.attach("1.3");
    await dbg.sendCommand("Emulation.setFocusEmulationEnabled", { enabled: true });
    await window.webContents.executeJavaScript("RendererTest.run()");
    const js = (code) => window.webContents.executeJavaScript(code);
    const wait = (ms) => new Promise((r) => setTimeout(r, ms));
    let pos = { x: 700, y: 500 };
    const move = async (x, y, step = 6) => {
      const dx = x - pos.x, dy = y - pos.y;
      const n = Math.max(1, Math.ceil(Math.hypot(dx, dy) / step));
      for (let i = 1; i <= n; i++) {
        const p = { x: pos.x + (dx * i) / n, y: pos.y + (dy * i) / n };
        await dbg.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", x: p.x, y: p.y });
        await wait(8);
      }
      pos = { x, y };
    };
    const snap = async (label) => log.push(label + " " + JSON.stringify(await js("popups()")));
    const row = (i) => js("rect('[data-row]:nth-child(" + (i + 1) + ")') ?? [...document.querySelectorAll('[data-row]')][" + i + "].getBoundingClientRect().toJSON()");
    const rows = await js("[...document.querySelectorAll('[data-row]')].map(e => e.getBoundingClientRect().toJSON())");
    log.push("rows " + JSON.stringify(rows.map(r => [r.x, r.y, r.width, r.height])));
    ${scenarioCode(scenario)}
  } catch (error) {
    log.push(String(error && error.stack || error));
  }
  writeFileSync(${JSON.stringify(join(directory, "result.txt"))}, log.join("\\n"));
  app.exit(0);
});`,
);
const env = { ...process.env };
delete env.ELECTRON_RUN_AS_NODE;
await promisify(execFile)(electron, [join(directory, "main.cjs")], { env, timeout: 60_000 });
console.log(await readFile(join(directory, "result.txt"), "utf8"));

function scenarioCode(name) {
  const archiveOf = `async (i) => { const r = rows[i]; await move(r.x + r.width / 2, r.y + r.height / 2); const a = await js("rect('[data-archive=\\"" + ["fix touch area! in that area", "Hardcoded workspace", "Investigate storage", "Subagent model"][i] + "\\"]')"); return a; }`;
  const scenarios = {
    default: `
      const archive = ${archiveOf};
      const a0 = await archive(0); log.push("archive0 " + JSON.stringify(a0));
      await move(a0.x + a0.width / 2, a0.y + a0.height / 2);
      await wait(1200); await snap("on archive 0");
      // go straight down to row 1 archive position
      await move(a0.x + a0.width / 2, rows[1].y + rows[1].height / 2);
      for (const t of [50, 150, 300, 700, 1200]) { await wait(t === 50 ? 50 : t - [50,150,300,700,1200][[50,150,300,700,1200].indexOf(t)-1]); await snap("row1 archive +" + t); }
    `,
    slow: `
      const archive = ${archiveOf};
      const a0 = await archive(0);
      await move(a0.x + a0.width / 2, a0.y + a0.height / 2);
      await wait(1200); await snap("on archive 0");
      await move(a0.x + a0.width / 2, rows[1].y + rows[1].height / 2, 1);
      await wait(1200); await snap("row1 after slow move");
      await move(a0.x + a0.width / 2, rows[2].y + rows[2].height / 2, 1);
      await wait(1200); await snap("row2 after slow move");
    `,
    back: `
      const archive = ${archiveOf};
      const a0 = await archive(0);
      await move(a0.x + a0.width / 2, a0.y + a0.height / 2);
      await wait(1200); await snap("on archive 0");
      await move(a0.x + a0.width / 2, rows[1].y + rows[1].height / 2);
      await wait(1200); await snap("row1");
      await move(a0.x + a0.width / 2, a0.y + a0.height / 2);
      await wait(1200); await snap("back on archive 0");
    `,
    card: `
      const archive = ${archiveOf};
      const a0 = await archive(0);
      await move(a0.x + a0.width / 2, a0.y + a0.height / 2);
      await wait(1200); await snap("on archive 0");
      const card = await js("document.querySelector('[aria-label^=\\"Details for\\"]').getBoundingClientRect().toJSON()");
      log.push("card " + JSON.stringify(card));
      await move(card.x + 20, a0.y + 8);
      await wait(300); await snap("in card");
      await move(card.x + 20, rows[1].y + 14);
      await move(a0.x + 8, rows[1].y + 14);
      await wait(1200); await snap("row1 via card");
    `,
    jitter: `
      const archive = ${archiveOf};
      const a0 = await archive(0);
      await move(a0.x + a0.width / 2, a0.y + a0.height / 2);
      await wait(1200); await snap("on archive 0");
      for (let k = 0; k < 6; k++) {
        await move(a0.x + 8, rows[1].y + 14, 20);
        await wait(40 + k * 60);
        await move(a0.x + 8, rows[0].y + 14, 20);
        await wait(40 + k * 60);
      }
      await move(a0.x + 8, rows[1].y + 14, 20);
      await wait(1200); await snap("after jitter on row1");
      await move(a0.x + 8, rows[0].y + 14, 20);
      await wait(1200); await snap("after jitter on row0");
    `,
    sweep: `
      const archive = ${archiveOf};
      const a0 = await archive(0);
      await move(a0.x + a0.width / 2, a0.y + a0.height / 2);
      await wait(1200); await snap("on archive 0");
      for (const d of [100, 200, 400, 650, 800]) {
        await move(a0.x + 8, rows[1].y + 14, 40);
        await wait(d);
        await move(a0.x + 8, rows[0].y + 14, 40);
        await wait(20); await snap("back after " + d);
        await wait(1200); await snap("settled after " + d);
      }
    `,
    exit: `
      const archive = ${archiveOf};
      const a0 = await archive(0);
      await move(a0.x + a0.width / 2, a0.y + a0.height / 2);
      await wait(1200); await snap("on archive 0");
      await dbg.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", x: -5, y: -5 });
      await wait(20);
      await dbg.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", x: a0.x + 8, y: rows[1].y + 14 });
      pos = { x: a0.x + 8, y: rows[1].y + 14 };
      await wait(1200); await snap("row1 after exit");
      await dbg.sendCommand("Input.dispatchMouseEvent", { type: "mouseMoved", x: a0.x + 8, y: rows[0].y + 14 });
      await wait(1200); await snap("row0 jump");
    `,
    click: `
      const archive = ${archiveOf};
      const a0 = await archive(0);
      await move(a0.x + a0.width / 2, a0.y + a0.height / 2);
      await dbg.sendCommand("Input.dispatchMouseEvent", { type: "mousePressed", x: pos.x, y: pos.y, button: "left", clickCount: 1 });
      await dbg.sendCommand("Input.dispatchMouseEvent", { type: "mouseReleased", x: pos.x, y: pos.y, button: "left", clickCount: 1 });
      await wait(1200); await snap("clicked archive 0");
      await move(a0.x + 8, rows[1].y + 14);
      await wait(1200); await snap("row1");
      await move(a0.x + 8, rows[2].y + 14);
      await wait(1200); await snap("row2");
    `,
    clickopen: `
      const archive = ${archiveOf};
      const a0 = await archive(0);
      await move(a0.x + a0.width / 2, a0.y + a0.height / 2);
      await wait(1200); await snap("open");
      await dbg.sendCommand("Input.dispatchMouseEvent", { type: "mousePressed", x: pos.x, y: pos.y, button: "left", clickCount: 1 });
      await dbg.sendCommand("Input.dispatchMouseEvent", { type: "mouseReleased", x: pos.x, y: pos.y, button: "left", clickCount: 1 });
      await wait(300); await snap("clicked archive 0");
      await move(a0.x + 8, rows[1].y + 14);
      await wait(1200); await snap("row1");
      await move(a0.x + 8, rows[2].y + 14);
      await wait(1200); await snap("row2");
    `,
  };
  return scenarios[name];
}
