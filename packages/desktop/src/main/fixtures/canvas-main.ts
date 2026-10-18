import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, join, normalize } from "node:path";
import process from "node:process";
import { app, BrowserWindow } from "electron";
import { compileCanvas } from "@nyte-ai/plugin/core/canvas-compile";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { ACCOUNT_SCHEMES } from "../../account/scheme.ts";
import { canvasShellUrl, registerRenderer } from "../renderer.ts";

process.stdin.on("close", () => app.exit(1));

process.stdin.resume();

const directory = process.argv[2];

const shellRoot = process.argv[3];

const source = process.argv[4];

const port = Number(process.argv[5]);

const transport = process.argv[6];

assert.ok(directory !== undefined && shellRoot !== undefined && source !== undefined);

assert.ok(transport === "scheme" || transport === "web");

assert.ok(Number.isInteger(port));

app.setPath("userData", join(directory, "profile"));

app.on("window-all-closed", () => undefined);

const scheme = ACCOUNT_SCHEMES.development;

const PAGE = `<!doctype html><meta charset="utf-8"><script defer src="/page.js"></script>`;

const SHELL_POLICY =
  "default-src 'none'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src data: blob:; font-src 'self'; connect-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

const SHELL_TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript; charset=utf-8"],
  [".css", "text/css; charset=utf-8"],
  [".woff2", "font/woff2"],
]);

const PAGE_SCRIPT = `
const shell = ${JSON.stringify(transport === "scheme" ? canvasShellUrl(scheme) : "/canvas/index.html")};
const seen = { heights: [], errors: [], initialized: false };
window.seen = seen;
const frame = document.createElement("iframe");
frame.sandbox = "allow-scripts";
frame.referrerPolicy = "no-referrer";
frame.title = "Fixture";
frame.style.cssText = "display:block;width:720px;height:80px;border:0";
const post = (message) => frame.contentWindow.postMessage(message, "*");
window.addEventListener("message", async (event) => {
  if (event.source !== frame.contentWindow) return;
  const message = event.data;
  if (message.method === "ui/initialize")
    post({ jsonrpc: "2.0", id: message.id, result: { protocolVersion: "2026-01-26", hostInfo: { name: "nyte-desktop", version: "1" }, hostCapabilities: {}, hostContext: { theme: "dark", styles: { variables: { "--nyte-custom-hue": "250", "--nyte-custom-chroma-scale": "0.2" } }, displayMode: "inline", platform: "desktop", deviceCapabilities: { touch: false, hover: true } } } });
  if (message.method === "ui/notifications/initialized") {
    seen.initialized = true;
    const module = await (await fetch("/module.json")).json();
    post({ jsonrpc: "2.0", method: "nyte/notifications/render", params: module });
  }
  if (message.method === "ui/notifications/size-changed") {
    seen.heights.push(message.params.height);
    frame.style.height = message.params.height + "px";
  }
  if (message.method === "notifications/message") seen.errors.push(message.params.data.message);
});
frame.src = shell;
document.body.append(frame);
`;

const Seen = Type.Object({
  heights: Type.Array(Type.Number()),
  errors: Type.Array(Type.String()),
  initialized: Type.Boolean(),
});

let module = "";

const server = createServer((request, response) => {
  const url = request.url ?? "/";

  if (url.startsWith("/canvas/")) {
    const file = join(shellRoot, normalize(url.slice("/canvas/".length)));
    const type = SHELL_TYPES.get(extname(file));

    readFile(file).then(
      (body) => {
        response.setHeader("Content-Type", type ?? "application/octet-stream");
        response.setHeader("Content-Security-Policy", SHELL_POLICY);
        response.setHeader("Access-Control-Allow-Origin", "*");
        response.end(body);
      },
      () => {
        response.statusCode = 404;
        response.end();
      },
    );
  } else if (url === "/page.js") {
    response.setHeader("Content-Type", "text/javascript");
    response.end(PAGE_SCRIPT);
  } else if (url === "/module.json") {
    response.setHeader("Content-Type", "application/json");
    response.end(module);
  } else {
    response.setHeader("Content-Type", "text/html");
    response.end(PAGE);
  }
});

server.listen(port, "127.0.0.1");

process.env.ELECTRON_RENDERER_URL = `http://127.0.0.1:${String(port)}`;

const rendererUrl = registerRenderer({ scheme, frontendApiHost: undefined, shellRoot });

async function run(): Promise<void> {
  const compiled = await compileCanvas(await readFile(source, "utf8"));

  if (compiled.kind === "failed")
    throw new Error(compiled.errors.map((error) => error.text).join("\n"));
  module = JSON.stringify({ runtime: compiled.runtime, code: compiled.code, title: "Fixture" });
  await app.whenReady();

  const window = new BrowserWindow({
    show: false,
    webPreferences: { contextIsolation: true, nodeIntegration: false, sandbox: true },
  });

  const consoleLines: string[] = [];
  window.webContents.on("console-message", (event) => consoleLines.push(event.message));
  await window.loadURL(rendererUrl);
  const deadline = Date.now() + 20_000;

  for (;;) {
    const seen: unknown = await window.webContents.executeJavaScript("window.seen");

    assert.ok(Value.Check(Seen, seen));
    const last = seen.heights.at(-1);

    if (seen.errors.length > 0)
      throw new Error(`The shell reported: ${seen.errors.join("; ")}\n${consoleLines.join("\n")}`);

    if (last !== undefined && last > 48) break;

    if (Date.now() > deadline)
      throw new Error(
        `No height after 20s (initialized: ${String(seen.initialized)}, heights: ${seen.heights.join(",")})\n${consoleLines.join("\n")}`,
      );
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  server.close();
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
