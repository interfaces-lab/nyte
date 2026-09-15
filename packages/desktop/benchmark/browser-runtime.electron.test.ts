// Proves the browser runtime drives a real page: refs resolve, clicks land on the
// element a ref names, typing submits a form, and refs from before a cross-document
// navigation fail instead of acting on whatever now sits at those coordinates.
//
// Run with NYTE_DESKTOP_BROWSER_E2E=1. The runtime talks to Electron APIs, so the
// assertions run inside an Electron main process; this file bundles the runtime,
// writes the harness and its pages to a temp directory, and reads back one JSON line.
import { spawn } from "node:child_process";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import electronBinary from "electron";
import { build } from "vite";
import { expect, test } from "vitest";

const PAGE_ONE = `<!doctype html><meta charset="utf-8"><title>page one</title>
<body style="font:16px system-ui;margin:0">
<button id="alpha" style="position:absolute;left:40px;top:40px;width:180px;height:40px">Alpha Button</button>
<form id="f" style="position:absolute;left:40px;top:100px">
  <input id="q" name="q" aria-label="Search query" style="width:260px;height:32px">
</form>
<script>
  window.__clicked = "";
  document.addEventListener("click", (e) => { window.__clicked = e.target.id || e.target.tagName; }, true);
  document.getElementById("f").addEventListener("submit", (e) => {
    e.preventDefault();
    window.__submitted = document.getElementById("q").value;
  });
</script>
`;

const PAGE_TWO = `<!doctype html><meta charset="utf-8"><title>page two</title>
<body style="font:16px system-ui;margin:0">
<button id="gamma" style="position:absolute;left:40px;top:40px;width:180px;height:40px">Gamma Button</button>
<script>
  window.__clicked = "";
  document.addEventListener("click", (e) => { window.__clicked = e.target.id || e.target.tagName; }, true);
</script>
`;

const HARNESS = `const { app, BaseWindow, WebContentsView, session } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const rt = require("./runtime.cjs");

const dir = __dirname;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const pages = {
    one: fs.readFileSync(dir + "/page1.html"),
    two: fs.readFileSync(dir + "/page2.html"),
  };
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(req.url.startsWith("/two") ? pages.two : pages.one);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const base = "http://127.0.0.1:" + server.address().port;

  const win = new BaseWindow({ show: false, width: 900, height: 600 });
  const view = new WebContentsView({
    webPreferences: {
      session: session.fromPartition("persist:browser-e2e"),
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      devTools: false,
      backgroundThrottling: false,
    },
  });
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 900, height: 600 });
  const wc = view.webContents;

  const runtime = rt.createSurfaceRuntime();
  await wc.loadURL(base + "/one");
  win.show();
  await sleep(300);

  const first = await rt.takeSnapshot(wc, runtime);
  const button = first.nodes.find((n) => n.name === "Alpha Button");
  const clicked = await rt.performClick(wc, runtime, button.ref, "left", false, true);
  const clickTarget = await wc.executeJavaScript("window.__clicked");

  const typing = await rt.takeSnapshot(wc, runtime);
  const field = typing.nodes.find((n) => n.editable === true);
  const typed = await rt.performType(wc, runtime, field.ref, "hello world", false, true, true);
  const fieldValue = await wc.executeJavaScript("document.getElementById('q').value");
  const submitted = await wc.executeJavaScript("window.__submitted || null");

  const staleRef = (await rt.takeSnapshot(wc, runtime)).nodes.find((n) => n.name === "Alpha Button").ref;
  await wc.loadURL(base + "/two");
  await sleep(200);
  const stale = await rt.performClick(wc, runtime, staleRef, "left", false, true);
  const staleTarget = await wc.executeJavaScript("window.__clicked");

  const reinjected = await rt.takeSnapshot(wc, runtime);
  const gamma = reinjected.nodes.find((n) => n.name === "Gamma Button");
  const freshClick = await rt.performClick(wc, runtime, gamma.ref, "left", false, true);
  const freshTarget = await wc.executeJavaScript("window.__clicked");

  const shot = await rt.performCapture(wc);

  console.log("BROWSER_E2E " + JSON.stringify({
    refs: first.nodes.length,
    clickKind: clicked.kind,
    clickTarget,
    typeKind: typed.kind,
    fieldValue,
    submitted,
    staleFailure: stale.kind === "failed" ? stale.failure.kind : "acted:" + stale.kind,
    staleTarget,
    freshKind: freshClick.kind,
    freshTarget,
    captureBytes: shot ? shot.length : 0,
  }));
  server.close();
  app.exit(0);
}).catch((e) => { console.log("BROWSER_E2E_FATAL " + e.stack); app.exit(1); });
`;

test.runIf(process.env["NYTE_DESKTOP_BROWSER_E2E"] === "1")(
  "the browser runtime snapshots, clicks, types, and invalidates refs across a navigation",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "nyte-browser-e2e-"));
    await build({
      logLevel: "silent",
      configFile: false,
      // Bundle typebox in; an SSR build would leave it external and unresolvable.
      ssr: { noExternal: true },
      build: {
        ssr: fileURLToPath(new URL("../src/main/browser-runtime.ts", import.meta.url)),
        outDir: dir,
        emptyOutDir: false,
        minify: false,
        rollupOptions: {
          external: ["electron"],
          output: { format: "cjs", entryFileNames: "runtime.cjs" },
        },
      },
    });
    await writeFile(join(dir, "page1.html"), PAGE_ONE);
    await writeFile(join(dir, "page2.html"), PAGE_TWO);
    await writeFile(join(dir, "harness.js"), HARNESS);

    const electronPath = typeof electronBinary === "string" ? electronBinary : "";
    const output = await new Promise<string>((resolve, reject) => {
      // Electron is chatty on stderr; an unread pipe would deadlock the child.
      const child = spawn(electronPath, [join(dir, "harness.js")], {
        stdio: ["ignore", "pipe", "ignore"],
      });
      let stdout = "";
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
      child.on("error", reject);
      child.on("close", () => resolve(stdout));
    });

    const line = output.split("\n").find((l) => l.startsWith("BROWSER_E2E "));
    expect(line, output).toBeDefined();
    const report: unknown = JSON.parse((line ?? "").slice("BROWSER_E2E ".length));

    expect(report).toMatchObject({
      clickKind: "ok",
      clickTarget: "alpha",
      typeKind: "ok",
      fieldValue: "hello world",
      submitted: "hello world",
      staleTarget: "",
      freshKind: "ok",
      freshTarget: "gamma",
    });
    expect(report).toHaveProperty(
      "staleFailure",
      expect.stringMatching(/unknown_ref|stale_document|detached/),
    );
    const bytes = report as { readonly refs: number; readonly captureBytes: number };
    expect(bytes.refs).toBeGreaterThan(0);
    expect(bytes.captureBytes).toBeGreaterThan(1000);
    await readFile(join(dir, "runtime.cjs"));
  },
  120_000,
);
