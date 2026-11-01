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

const HARNESS = `const { app, BrowserWindow } = require("electron");
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

app.whenReady().then(async () => {
  const server = http.createServer((req, res) => {
    res.writeHead(200, { "content-type": "text/html" });
    res.end("<!doctype html><title>agent page</title><p>agent page</p>");
  });
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const url = "http://127.0.0.1:" + server.address().port + "/";
  const owner = { kind: "project", path: "/workspace" };

  const windows = new Map();
  for (const _ of [0, 1]) {
    const window = new BrowserWindow({ show: false, width: 900, height: 600 });
    windows.set(window.webContents.id, window);
  }
  const [first, second] = [...windows.keys()];
  const broadcasts = [];
  const surfaces = new BrowserSurfaces({
    window: (id) => windows.get(id) ?? [...windows.values()].at(-1),
    emit: (event, window) => {
      if (event.kind === "browser_agent_opened" && window === undefined) broadcasts.push(event.surface);
    },
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

  const opened = await surfaces.agent.open({ session: "agent", url, owner });
  const surface = surfaces.agent.sessionSurfaceId("agent");
  // Every window that receives the broadcast mounts a Browser tab for the agent's page.
  for (const window of windows.keys()) surfaces.open({ surface, url, owner }, window);
  surfaces.setBounds(
    { surface, bounds: { x: 0, y: 0, width: 400, height: 300 }, visible: true, focus: false },
    first,
  );
  const view = surfaces.surface(surface).view;
  const shown = view.getVisible();

  surfaces.close({ surface }, second);
  const shownAfterOtherTabCloses = view.getVisible();

  windows.get(second).destroy();
  windows.delete(second);
  surfaces.releaseWindow(second);
  const shownAfterOtherWindowCloses = view.getVisible();

  surfaces.close({ surface }, first);
  surfaces.agent.release({ session: "agent" });

  console.log("SURFACES_E2E " + JSON.stringify({
    opened: opened.kind,
    broadcast: broadcasts.includes(surface),
    shown,
    shownAfterOtherTabCloses,
    shownAfterOtherWindowCloses,
    destroyedWhenUnheld: surfaces.surface(surface) === undefined,
  }));
  server.close();
  app.exit(0);
}).catch((e) => { console.log("SURFACES_E2E_FATAL " + e.stack); app.exit(1); });
`;

test.runIf(process.env["NYTE_DESKTOP_BROWSER_E2E"] === "1")(
  "closing one window's tab for a shared page leaves it showing in the other window",
  async () => {
    const dir = await mkdtemp(join(tmpdir(), "nyte-surfaces-e2e-"));
    onTestFinished(() => rm(dir, { recursive: true, force: true }));

    await build({
      logLevel: "silent",
      configFile: false,
      ssr: { noExternal: true },
      build: {
        ssr: fileURLToPath(new URL("./browser.ts", import.meta.url)),
        outDir: dir,
        emptyOutDir: false,
        minify: false,
        rollupOptions: {
          external: ["electron"],
          output: { format: "cjs", entryFileNames: "browser.cjs" },
        },
      },
    });
    await writeFile(join(dir, "preload.js"), "");
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

    const line = output.split("\n").find((entry) => entry.startsWith("SURFACES_E2E "));
    expect(line, output).toBeDefined();

    expect(JSON.parse((line ?? "").slice("SURFACES_E2E ".length))).toEqual({
      opened: "ok",
      broadcast: true,
      shown: true,
      shownAfterOtherTabCloses: true,
      shownAfterOtherWindowCloses: true,
      destroyedWhenUnheld: true,
    });
  },
  120_000,
);
