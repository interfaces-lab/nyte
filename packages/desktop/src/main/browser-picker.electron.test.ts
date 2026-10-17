import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import electronBinary from "electron";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { build } from "vite";
import { expect, test } from "vitest";

const PAGE = `<!doctype html><meta charset="utf-8"><title>picker</title>
<body style="font:16px system-ui;margin:0">
<main>
  <p>Intro</p>
  <button class="primary" style="position:absolute;left:40px;top:60px;width:160px;height:40px;background:#e33;color:#fff;border:0">Save</button>
  <button class="primary" style="position:absolute;left:240px;top:60px;width:160px;height:40px">Cancel</button>
</main>
<script>
  window.__clicked = "";
  document.addEventListener("click", (e) => { window.__clicked = e.target.textContent; });
</script>
`;

const HARNESS = `const { app, BaseWindow, WebContentsView, session } = require("electron");
const http = require("node:http");
const fs = require("node:fs");
const picker = require("./picker.cjs");

const dir = __dirname;
const profile = dir + "/profile";
fs.mkdirSync(profile);
app.setPath("userData", profile);
app.setPath("sessionData", profile);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

app.whenReady().then(async () => {
  const page = fs.readFileSync(dir + "/page.html");
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end(page);
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const win = new BaseWindow({ show: false, width: 600, height: 400 });
  const view = new WebContentsView({
    webPreferences: { session: session.fromPartition("persist:picker-e2e"), sandbox: true, contextIsolation: true },
  });
  win.contentView.addChildView(view);
  view.setBounds({ x: 0, y: 0, width: 600, height: 400 });
  const wc = view.webContents;
  await wc.loadURL("http://127.0.0.1:" + server.address().port + "/");
  win.show();
  wc.focus();
  await sleep(300);

  const picked = picker.pickElement(wc);
  await sleep(100);
  wc.sendInputEvent({ type: "mouseMove", x: 120, y: 80 });
  await sleep(100);
  wc.sendInputEvent({ type: "mouseDown", x: 120, y: 80, button: "left", clickCount: 1 });
  wc.sendInputEvent({ type: "mouseUp", x: 120, y: 80, button: "left", clickCount: 1 });
  const element = await picked;
  const clicked = await wc.executeJavaScript("window.__clicked");

  const climbing = picker.pickElement(wc);
  await sleep(100);
  wc.sendInputEvent({ type: "mouseMove", x: 320, y: 80 });
  await sleep(100);
  wc.sendInputEvent({ type: "keyDown", keyCode: "Up" });
  await sleep(50);
  wc.sendInputEvent({ type: "keyDown", keyCode: "Return" });
  const parent = await climbing;

  const escaped = picker.pickElement(wc);
  await sleep(100);
  wc.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  const cancelled = await escaped;

  const forging = picker.pickElement(wc);
  await sleep(100);
  await wc.executeJavaScript(
    'document.querySelectorAll("button")[1].dispatchEvent(new MouseEvent("click", { bubbles: true, clientX: 320, clientY: 80 }));' +
      'window.dispatchEvent(new KeyboardEvent("keydown", { key: "Enter" })); true',
  );
  await sleep(100);
  wc.sendInputEvent({ type: "keyDown", keyCode: "Escape" });
  const forged = await forging;

  const first = picker.pickElement(wc);
  await sleep(100);
  const second = await picker.pickElement(wc);
  const toggled = await first;
  const overlays = await wc.executeJavaScript("document.documentElement.children.length");

  console.log("PICKER_E2E " + JSON.stringify({
    element: element && { ...element, image: element.image ? element.image.length : 0 },
    clicked,
    parent: parent && parent.selector,
    cancelled: cancelled === undefined,
    forged: forged === undefined,
    toggled: toggled === undefined && second === undefined,
    overlays,
  }));
  server.close();
  app.exit(0);
}).catch((e) => { console.log("PICKER_E2E_FATAL " + e.stack); app.exit(1); });
`;

test.runIf(process.env["NYTE_DESKTOP_BROWSER_E2E"] === "1")(
  "a pick outlines, takes the click from the page, climbs with the arrows, ignores the page's own events and cancels",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "nyte-picker-e2e-"));

    try {
      await build({
        logLevel: "silent",
        configFile: false,
        ssr: { noExternal: true },
        build: {
          ssr: fileURLToPath(new URL("./browser-picker.ts", import.meta.url)),
          outDir: dir,
          emptyOutDir: false,
          minify: false,
          rollupOptions: {
            external: ["electron"],
            output: { format: "cjs", entryFileNames: "picker.cjs" },
          },
        },
      });
      await writeFile(join(dir, "page.html"), PAGE);
      await writeFile(join(dir, "harness.js"), HARNESS);

      const output = await new Promise<string>((resolve, reject) => {
        const child = spawn(
          Value.Parse(Type.String(), electronBinary),
          [join(dir, "harness.js"), "--use-mock-keychain", "--password-store=basic"],
          { stdio: ["ignore", "pipe", "ignore"] },
        );

        let stdout = "";
        child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
        child.on("error", reject);
        child.on("close", () => resolve(stdout));
      });

      const line = output.split("\n").find((entry) => entry.startsWith("PICKER_E2E "));
      expect(line, output).toBeDefined();
      const report: unknown = JSON.parse((line ?? "").slice("PICKER_E2E ".length));

      expect(report).toMatchObject({
        element: {
          selector: "button.primary:nth-of-type(1)",
          html: expect.stringContaining('class="primary"'),
        },
        clicked: "",
        parent: "main",
        cancelled: true,
        forged: true,
        toggled: true,
        overlays: 2,
      });
      expect(
        Value.Parse(Type.Object({ element: Type.Object({ image: Type.Number() }) }), report).element
          .image,
      ).toBeGreaterThan(100);
    } finally {
      await rm(dir, { recursive: true, force: true });
    }
  },
  120_000,
);
