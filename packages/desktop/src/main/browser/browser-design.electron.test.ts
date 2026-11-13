import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import electronBinary from "electron";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { build } from "vite";
import { expect, onTestFinished, test } from "vitest";

const PAGE = `<!doctype html><meta charset="utf-8"><title>design</title>
<body style="font:16px system-ui;margin:0">
<main style="padding:40px">
  <button class="primary" style="width:160px;height:40px;margin:0">Save</button><button class="primary" style="width:160px;height:40px;margin:0">Cancel</button>
  <p><input id="field"></p>
</main>
<dialog style="margin:0;inset:auto auto 40px 40px"><button id="confirm" style="width:120px;height:32px">Confirm</button><input id="inner"><iframe srcdoc="<button id=deep onclick=parent.__deep=true style=width:180px;height:40px>Deep</button>" style="width:200px;height:60px"></iframe></dialog>
<script>
  window.__seen = [];
  window.__confirmed = false;
  window.__deep = false;
  document.querySelector("#confirm").addEventListener("click", () => (window.__confirmed = true));
  for (const type of ["pointerdown", "pointermove", "mousedown", "click", "keydown", "keyup"])
    window.addEventListener(type, (event) => window.__seen.push(event.type + (event.isTrusted ? "" : ":forged")), true);
</script>
`;

const HARNESS = `const { app, BrowserWindow, nativeImage } = require("electron");
process.stdin.on("close", () => app.exit(1));
process.stdin.resume();
const http = require("node:http");
const fs = require("node:fs");
const { BrowserSurfaces } = require("./browser.cjs");

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
  const url = "http://127.0.0.1:" + server.address().port + "/";
  const window = new BrowserWindow({ show: true, width: 600, height: 400 });
  const id = window.webContents.id;
  const events = [];
  const surfaces = new BrowserSurfaces({
    window: () => window,
    emit: (event) => events.push(event),
    filterListPath: dir + "/missing.bin",
    windowShown: () => true,
    settings: () => ({ blockAds: false, adblockAllowedHosts: [], upgradeToHttps: false }),
    history: {
      listen() {},
      record: async () => {},
      retitle: async () => {},
      entries: async () => [],
      clear: async () => {},
      remove: async () => [],
    },
    pagePreload: dir + "/preload.js",
    forwardKey: () => {},
  });
  const surface = "design";
  surfaces.open({ surface, url }, id);
  surfaces.setBounds({ surface, bounds: { x: 0, y: 0, width: 600, height: 400 }, visible: true, focus: true }, id);
  const wc = surfaces.surface(surface).view.webContents;
  while (wc.isLoading() || wc.getURL() === "") await sleep(50);
  await sleep(200);
  const children = () => wc.executeJavaScript("document.documentElement.children.length");
  const before = await children();

  const picks = () => events.filter((event) => event.kind === "browser_design_pick");
  const designs = () => events.filter((event) => event.kind === "browser_changed").map((event) => event.state.design);
  const until = async (check) => {
    for (let tries = 0; tries < 100 && !(await check()); tries++) await sleep(30);
  };
  const click = (x, y) => {
    wc.sendInputEvent({ type: "mouseMove", x, y });
    wc.sendInputEvent({ type: "mouseDown", x, y, button: "left", clickCount: 1 });
    wc.sendInputEvent({ type: "mouseUp", x, y, button: "left", clickCount: 1 });
  };

  const stroke = (keyCode, modifiers = []) => {
    wc.sendInputEvent({ type: "keyDown", keyCode, modifiers });
    wc.sendInputEvent({ type: "keyUp", keyCode, modifiers });
  };
  const opacity = () =>
    wc.executeJavaScript("getComputedStyle(document.documentElement.lastElementChild).opacity");
  const ringInCrop = (dataUrl) => {
    const image = nativeImage.createFromDataURL(dataUrl);
    const size = image.getSize();
    const bitmap = image.toBitmap();
    const at = Math.floor(size.height / 2) * size.width * 4;
    return Math.abs(bitmap[at] - bitmap[at + 2]) > 150;
  };

  await wc.executeJavaScript('document.querySelector("#field").focus(); true');
  surfaces.design({ surface, change: { kind: "on" } });
  await sleep(300);
  const during = await children();

  click(100, 60);
  stroke("X", ["shift"]);
  await until(() => picks().length === 1);
  const element = picks()[0]?.pick;
  await until(() => designs().some((design) => design.views.xray));
  const field = await wc.executeJavaScript('document.querySelector("#field").value');

  wc.sendInputEvent({ type: "mouseMove", x: 30, y: 120 });
  wc.sendInputEvent({ type: "mouseDown", x: 30, y: 120, button: "left", clickCount: 1 });
  for (let step = 1; step <= 5; step++)
    wc.sendInputEvent({ type: "mouseMove", x: 30 + step * 60, y: 120 + step * 36, button: "left", modifiers: ["leftButtonDown"] });
  wc.sendInputEvent({ type: "mouseUp", x: 330, y: 300, button: "left", clickCount: 1 });
  await until(() => picks().length === 2);
  const area = picks()[1]?.pick;

  await wc.executeJavaScript(
    'const host = document.documentElement.lastElementChild;' +
      'host.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, clientX: 100, clientY: 60, button: 0 }));' +
      'host.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, clientX: 100, clientY: 60, button: 0 })); true',
  );
  await sleep(300);
  const forgedPicks = picks().length - 2;

  await sleep(200);
  const shown = await opacity();
  const seen = await wc.executeJavaScript("window.__seen");
  stroke("Escape");
  await until(() => designs().at(-1)?.on === false);
  await sleep(200);
  const after = await children();
  const seenAfter = await wc.executeJavaScript("window.__seen");

  await wc.executeJavaScript(
    'document.querySelector("dialog").showModal(); document.querySelector("#inner").focus(); true',
  );
  const confirm = await wc.executeJavaScript(
    'JSON.parse(JSON.stringify(document.querySelector("#confirm").getBoundingClientRect()))',
  );
  surfaces.design({ surface, change: { kind: "on" } });
  await sleep(300);
  click(confirm.x + 20, confirm.y + 10);
  await until(() => picks().length === 3);
  const modal = picks()[2]?.pick;
  const confirmed = await wc.executeJavaScript("window.__confirmed");
  await until(async () => (await opacity()) === "1");
  await sleep(200);
  const frame = await wc.executeJavaScript(
    'JSON.parse(JSON.stringify(document.querySelector("iframe").getBoundingClientRect()))',
  );
  click(frame.x + 40, frame.y + 20);
  await until(() => picks().length === 4);
  const framed = picks()[3]?.pick;
  const deep = await wc.executeJavaScript("window.__deep");
  const views = designs().length;
  stroke("X", ["shift"]);
  await until(() => designs().length > views);
  const inner = await wc.executeJavaScript('document.querySelector("#inner").value');

  console.log("DESIGN_E2E " + JSON.stringify({
    before,
    during,
    after,
    element: element && { ...element, image: element.image ? element.image.length : 0 },
    ring: element?.image ? ringInCrop(element.image) : undefined,
    field,
    shown,
    modal: modal?.source.selector,
    confirmed,
    framed: framed?.source.selector,
    deep,
    inner,
    modalXray: designs().at(-1)?.views.xray,
    area: area && { source: area.source, image: area.image ? area.image.slice(0, 22) : undefined },
    forgedPicks,
    designs: designs(),
    seen,
    seenAfter: seenAfter.filter((entry) => entry.startsWith("key")),
  }));
  server.close();
  app.exit(0);
}).catch((e) => { console.log("DESIGN_E2E_FATAL " + e.stack); app.exit(1); });
`;

const cjs = async (entry: string, file: string, dir: string): Promise<void> => {
  await build({
    logLevel: "silent",
    configFile: false,
    ssr: { noExternal: true },
    build: {
      ssr: fileURLToPath(new URL(entry, import.meta.url)),
      outDir: dir,
      emptyOutDir: false,
      minify: false,
      rollupOptions: { external: ["electron"], output: { format: "cjs", entryFileNames: file } },
    },
  });
};

test.runIf(process.env["NYTE_DESKTOP_BROWSER_E2E"] === "1")(
  "Design Mode picks an element and an area with their crops, takes its keys, and keeps the page from seeing any of it",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "nyte-design-e2e-"));
    onTestFinished(() => rm(dir, { recursive: true, force: true }));

    await cjs("./browser.ts", "browser.cjs", dir);
    await cjs("../../preload/browser-page.ts", "preload.js", dir);
    await writeFile(join(dir, "page.html"), PAGE);
    await writeFile(join(dir, "harness.js"), HARNESS);

    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        Value.Parse(Type.String(), electronBinary),
        [join(dir, "harness.js"), "--use-mock-keychain", "--password-store=basic"],
        { stdio: ["pipe", "pipe", "ignore"] },
      );

      let stdout = "";
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
      child.on("error", reject);
      child.on("close", () => resolve(stdout));
    });

    const line = output.split("\n").find((entry) => entry.startsWith("DESIGN_E2E "));
    expect(line, output).toBeDefined();
    const report: unknown = JSON.parse((line ?? "").slice("DESIGN_E2E ".length));

    expect(report).toMatchObject({
      during: 3,
      ring: false,
      field: "",
      shown: "1",
      modal: "#confirm",
      confirmed: false,
      framed: expect.stringContaining("iframe"),
      deep: false,
      inner: "",
      modalXray: false,
      seenAfter: [],
      element: {
        source: { kind: "browser", selector: "button.primary:nth-of-type(1)" },
        text: expect.stringMatching(
          /^label: button \.primary\ntext: Save\nbounds: x=40 y=40 w=160 h=40\n/,
        ),
      },
      area: {
        source: { kind: "browser", region: { x: 30, y: 120, width: 300, height: 180 } },
        image: "data:image/png;base64,",
      },
      forgedPicks: 0,
      seen: ["pointerdown:forged"],
    });

    const parsed = Value.Parse(
      Type.Object({
        before: Type.Number(),
        after: Type.Number(),
        element: Type.Object({ image: Type.Number() }),
        designs: Type.Array(
          Type.Object({ on: Type.Boolean(), views: Type.Object({ xray: Type.Boolean() }) }),
        ),
      }),
      report,
    );

    expect(parsed.element.image).toBeGreaterThan(100);
    expect(parsed.after).toBe(parsed.before);
    expect(parsed.designs.filter((design) => !design.on).at(-1)?.views.xray).toBe(true);
  },
  120_000,
);
