import { spawn } from "node:child_process";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "vite";
import { electronExecutable } from "../../fixtures/electron.ts";

const HOST_PAGE = `<!doctype html><meta charset="utf-8"><title>guest host</title>
<body style="margin:0;background:#fff">
<input id="composer" aria-label="composer" style="position:relative;z-index:2">
<div id="layer" style="position:fixed;inset:0;z-index:1;pointer-events:none"></div>
<script>
  const mounted = new Map();
  window.messages = [];
  const slots = new Map();
  const layer = document.getElementById("layer");

  function park(element) {
    const slot = slots.get(element.dataset.surface);
    const box = "position:fixed;width:900px;height:600px;pointer-events:none;";

    if (slot !== undefined) {
      element.style.cssText =
        "position:fixed;pointer-events:auto;left:" + slot.x + "px;top:" + slot.y + "px;width:" +
        slot.width + "px;height:" + slot.height + "px";
      return;
    }

    element.style.cssText =
      element.dataset.painting === "true"
        ? box + "left:0;top:0;opacity:0;z-index:-1"
        : box + "left:-100000px;top:-100000px";
  }

  window.sync = (guests) => {
    const wanted = new Map(guests.map((guest) => [guest.surface + " " + guest.generation, guest]));

    for (const [key, element] of mounted) {
      if (wanted.has(key)) continue;
      element.remove();
      mounted.delete(key);
    }

    const fresh = [];

    for (const [key, guest] of wanted) {
      const existing = mounted.get(key);

      if (existing !== undefined) {
        existing.dataset.painting = String(guest.painting);
        park(existing);
        continue;
      }

      fresh.push(create(guest, {}, (element) => mounted.set(key, element)));
    }

    return Promise.all(fresh).then((ids) => ids.filter((entry) => entry !== undefined));
  };

  window.mount = (guest, attributes) => create(guest, attributes, () => {});

  function create(guest, attributes, track) {
    const element = document.createElement("webview");
    element.setAttribute("partition", guest.partition);
    element.setAttribute("src", attributes.src ?? "about:blank");
    for (const [name, value] of Object.entries(attributes)) element.setAttribute(name, value);
    element.dataset.surface = guest.surface;
    element.dataset.painting = String(guest.painting);
    element.addEventListener("ipc-message", (event) => window.messages.push([guest.surface, event.channel]));
    park(element);
    track(element);
    layer.append(element);

    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(undefined), 5000);
      element.addEventListener(
        "dom-ready",
        () => {
          clearTimeout(timer);
          resolve({ surface: guest.surface, generation: guest.generation, id: element.getWebContentsId() });
        },
        { once: true },
      );
    });
  }

  window.place = (surface, slot) => {
    if (slot === null) slots.delete(surface);
    else slots.set(surface, slot);
    for (const element of mounted.values()) if (element.dataset.surface === surface) park(element);
    return true;
  };

  window.focusGuest = (surface) => {
    for (const element of mounted.values()) if (element.dataset.surface === surface) element.focus();
    return true;
  };

  window.focusComposer = () => {
    document.getElementById("composer").focus();
    return document.activeElement.id;
  };
</script>
`;

const PRELUDE = `const { app, BrowserWindow, webContents, nativeImage } = require("electron");
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

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const until = async (check, tries = 200) => {
  for (let tried = 0; tried < tries; tried++) {
    if (await check()) return true;
    await sleep(25);
  }
  return false;
};

const report = (value) => console.log("HARNESS_REPORT " + JSON.stringify(value));

async function serve(respond) {
  const server = http.createServer((request, response) => {
    const page = respond(request.url);
    response.writeHead(200, { "content-type": "text/html" });
    response.end(page);
  });
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  return { url: "http://127.0.0.1:" + server.address().port, close: () => server.close() };
}

function browser() {
  const windows = new Map();
  const events = [];
  const keys = [];
  const refusals = [];
  const attaching = [];
  const surfaces = new BrowserSurfaces({
    window: (id) => (id === undefined ? undefined : windows.get(id)?.window) ?? [...windows.values()].at(-1)?.window,
    emit: (event, window) => {
      events.push({ event, window });
      if (event.kind === "browser_guests" && window !== undefined) windows.get(window)?.sync(event.guests);
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
    forwardKey: ({ key }) => keys.push(key),
  });

  async function guestWindow(options = {}) {
    const window = new BrowserWindow({
      show: options.show ?? false,
      width: options.width ?? 900,
      height: options.height ?? 600,
      webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false, webviewTag: true },
    });
    window.webContents.on("will-attach-webview", (_event, webPreferences, params) =>
      attaching.push({ element: params.partition, preferences: webPreferences.partition ?? null }),
    );
    surfaces.hostGuests(window);
    const id = window.webContents.id;
    window.webContents.on("did-navigate", () => surfaces.releaseWindow(id));
    window.webContents.on("render-process-gone", () => surfaces.releaseWindow(id));
    await window.loadFile(dir + "/host.html");
    let pending = Promise.resolve();
    const page = (code) => window.webContents.executeJavaScript(code);
    const host = {
      id,
      window,
      page,
      sync(guests) {
        pending = pending.then(async () => {
          if (window.isDestroyed()) return;
          const fresh = await page("sync(" + JSON.stringify(guests) + ")");
          for (const guest of fresh) {
            try {
              surfaces.attach({ surface: guest.surface, webContentsId: guest.id, generation: guest.generation }, id);
            } catch (error) {
              refusals.push(guest.surface);
            }
          }
        }).catch(() => undefined);
        return pending;
      },
      async reload() {
        await new Promise((resolve) => {
          window.webContents.once("did-finish-load", resolve);
          window.webContents.reload();
        });
        await host.sync(surfaces.guests(id));
      },
      settled: () => pending,
      async show(surface, slot) {
        await page("place(" + JSON.stringify(surface) + ", " + JSON.stringify(slot) + ")");
        surfaces.setShown({ surface, visible: slot !== null }, id);
      },
      focus: (surface) => page("focusGuest(" + JSON.stringify(surface) + ")"),
      focusComposer: () => page("focusComposer()"),
      messages: () => page("window.messages"),
      mount: (guest, attributes) =>
        page("mount(" + [guest, attributes].map((value) => JSON.stringify(value)).join(", ") + ")"),
    };
    windows.set(id, host);
    await host.sync(surfaces.guests(id));
    return host;
  }

  const guestOf = (surface) => surfaces.surface(surface)?.guest;
  const attached = async (surface) => {
    await until(() => guestOf(surface) !== undefined);
    return guestOf(surface);
  };

  return { surfaces, events, keys, refusals, attaching, windows, guestWindow, guestOf, attached };
}

async function focusWindow(window) {
  window.show();
  for (let tries = 0; tries < 40 && !window.isFocused(); tries++) {
    app.focus({ steal: true });
    window.focus();
    await sleep(50);
  }
  return window.isFocused();
}
`;

async function bundle(entry: string, file: string, directory: string): Promise<void> {
  await build({
    logLevel: "silent",
    configFile: false,
    ssr: { noExternal: true },
    build: {
      ssr: fileURLToPath(new URL(entry, import.meta.url)),
      outDir: directory,
      emptyOutDir: false,
      minify: false,
      rollupOptions: { external: ["electron"], output: { format: "cjs", entryFileNames: file } },
    },
  });
}

/**
 * Runs `script` in a real Electron main process beside `browser()`, which builds `BrowserSurfaces`
 * against windows whose page mounts `<webview>` guests from `browser_guests` the way the app's
 * renderer does. The script ends by calling `report(value)`; its JSON comes back.
 */
export async function runBrowserHarness(input: {
  readonly script: string;
  readonly files?: Readonly<Record<string, string>>;
}): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), "nyte-browser-harness-"));

  try {
    await bundle("../browser.ts", "browser.cjs", directory);
    await bundle("../browser-runtime.ts", "runtime.cjs", directory);
    await bundle("../../../preload/browser-page.ts", "preload.js", directory);
    await writeFile(join(directory, "host.html"), HOST_PAGE);

    for (const [name, content] of Object.entries(input.files ?? {}))
      await writeFile(join(directory, name), content);

    await writeFile(
      join(directory, "harness.js"),
      `${PRELUDE}
app.whenReady().then(async () => {
${input.script}
  app.exit(0);
}).catch((error) => { console.log("HARNESS_FATAL " + error.stack); app.exit(1); });
`,
    );

    const output = await new Promise<string>((resolve, reject) => {
      const child = spawn(
        electronExecutable,
        [join(directory, "harness.js"), "--use-mock-keychain", "--password-store=basic"],
        { stdio: ["pipe", "pipe", "ignore"] },
      );

      let stdout = "";
      child.stdout.on("data", (chunk: Buffer) => (stdout += chunk.toString()));
      child.on("error", reject);
      child.on("close", () => resolve(stdout));
    });

    const line = output.split("\n").find((entry) => entry.startsWith("HARNESS_REPORT "));

    if (line === undefined) throw new Error(`The harness reported nothing:\n${output}`);

    return line.slice("HARNESS_REPORT ".length);
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}
