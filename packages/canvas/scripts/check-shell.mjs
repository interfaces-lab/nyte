import { createServer } from "node:http";
import { mkdir, readFile, readdir } from "node:fs/promises";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { compileCanvas } from "@nyte-ai/plugin/core/canvas";
import {
  CANVAS_RUNTIME,
  initializeResult,
  renderNotification,
} from "@nyte-ai/plugin/canvas/protocol";
import { chromium } from "../../app/node_modules/@playwright/test/index.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));

const shell = join(root, "dist/shell");

const out = join(root, "dist/check");

const SHELL_CSP =
  "default-src 'none'; script-src 'self' blob:; style-src 'self' 'unsafe-inline'; img-src data: blob:; font-src 'self'; connect-src 'none'; frame-ancestors 'self'; base-uri 'none'; form-action 'none'";

const TYPES = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
};

const HOST_PAGE = `<!doctype html><html><head><meta charset="utf-8"><style>
html{margin:0;background:var(--bg)}body{margin:0;padding:24px}iframe{display:block;width:100%;border:0;height:80px}
</style></head><body><iframe id="frame" sandbox="allow-scripts" referrerpolicy="no-referrer" title="Canvas"></iframe><script>
window.__received = [];
const config = window.__canvasCheck;
document.documentElement.style.setProperty("--bg", config.background);
const frame = document.getElementById("frame");
window.addEventListener("message", (event) => {
  if (event.source !== frame.contentWindow) return;
  const data = event.data;
  window.__received.push(data);
  if (data.method === "ui/initialize") frame.contentWindow.postMessage({ ...config.initializeResult, id: data.id }, "*");
  if (data.method === "ui/notifications/initialized") frame.contentWindow.postMessage(config.render, "*");
  if (data.method === "ui/notifications/size-changed") frame.style.height = Math.min(2000, Math.max(48, data.params.height)) + "px";
});
frame.src = "/index.html";
</script></body></html>`;

const server = createServer(async (request, response) => {
  const path = new URL(request.url ?? "/", "http://localhost").pathname;

  if (path === "/host.html") {
    response.writeHead(200, { "Content-Type": "text/html" });
    response.end(HOST_PAGE);

    return;
  }

  try {
    const body = await readFile(join(shell, path === "/" ? "index.html" : path));
    const type = TYPES[extname(path)] ?? "application/octet-stream";
    response.writeHead(200, {
      "Content-Type": type,
      "Access-Control-Allow-Origin": "*",
      ...(path.endsWith(".html") ? { "Content-Security-Policy": SHELL_CSP } : {}),
    });
    response.end(body);
  } catch {
    response.writeHead(404);
    response.end();
  }
});

await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));

const port = server.address().port;

const compile = compileCanvas;

const fixtures = (await readdir(join(root, "test/fixtures"))).filter((name) =>
  name.endsWith(".tsx"),
);

const modules = [];

for (const name of fixtures) {
  const outcome = await compile(await readFile(join(root, "test/fixtures", name), "utf8"));

  if (outcome.kind !== "compiled")
    throw new Error(`${name} did not compile: ${JSON.stringify(outcome.errors)}`);
  modules.push({
    name: name.replace(/\.tsx$/, ""),
    module: { runtime: outcome.runtime, code: outcome.code, title: name },
  });
}

const context = (theme) => ({
  theme,
  styles: { variables: { "--nyte-custom-hue": "250", "--nyte-custom-chroma-scale": "0" } },
  displayMode: "inline",
  platform: "web",
  deviceCapabilities: { touch: false, hover: true },
});

const backgrounds = { light: "#ffffff", dark: "#171717" };

await mkdir(out, { recursive: true });

const browser = await chromium.launch();

const failures = [];

const results = [];

for (const theme of ["light", "dark"]) {
  for (const { name, module } of modules) {
    const page = await browser.newPage({
      viewport: { width: 760, height: 900 },
      colorScheme: theme,
    });
    const consoleErrors = [];
    page.on("console", (message) => {
      if (message.type() === "error") consoleErrors.push(message.text());
    });
    await page.addInitScript(
      (config) => {
        window.__canvasCheck = config;
      },
      {
        background: backgrounds[theme],
        initializeResult: initializeResult(
          0,
          { name: "nyte-web", version: "check" },
          context(theme),
        ),
        render: renderNotification(module),
      },
    );
    await page.goto(`http://127.0.0.1:${port}/host.html`);
    page.on("pageerror", (error) => consoleErrors.push(error.message));

    try {
      await page.waitForFunction(
        () =>
          window.__received.some(
            (m) => m.method === "ui/notifications/size-changed" && m.params.height > 80,
          ) || window.__received.some((m) => m.method === "notifications/message"),
        undefined,
        { timeout: 15_000 },
      );
    } catch {
      failures.push({
        fixture: name,
        theme,
        timeout: true,
        received: await page.evaluate(() => window.__received),
        consoleErrors,
      });
      await page.screenshot({ path: join(out, `${name}-${theme}-timeout.png`), fullPage: true });
      await page.close();

      continue;
    }

    await page.waitForTimeout(400);
    const received = await page.evaluate(() => window.__received);
    const sizes = received
      .filter((m) => m.method === "ui/notifications/size-changed")
      .map((m) => m.params.height);
    const errors = received
      .filter((m) => m.method === "notifications/message")
      .map((m) => m.params.data);
    const file = join(out, `${name}-${theme}.png`);
    await page.screenshot({ path: file, fullPage: true });
    results.push({ fixture: name, theme, height: sizes.at(-1), file });
    process.stdout.write(
      `${name} ${theme}: height ${String(sizes.at(-1))}${errors.length > 0 ? ` errors ${JSON.stringify(errors)}` : ""}${consoleErrors.length > 0 ? ` console ${JSON.stringify(consoleErrors)}` : ""}\n`,
    );

    if (errors.length > 0 || consoleErrors.length > 0)
      failures.push({ fixture: name, theme, errors, consoleErrors });
    await page.close();
  }
}

{
  const { shell: inline } = await import("../dist/shell-inline.js");
  const page = await browser.newPage({ viewport: { width: 390, height: 800 } });
  const consoleErrors = [];
  page.on("console", (message) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  await page.addInitScript(
    (config) => {
      window.__received = [];
      window.ReactNativeWebView = {
        postMessage(text) {
          const data = JSON.parse(text);
          window.__received.push(data);

          if (data.method === "ui/initialize")
            window.dispatchEvent(
              new MessageEvent("message", { data: { ...config.initializeResult, id: data.id } }),
            );

          if (data.method === "ui/notifications/initialized")
            window.dispatchEvent(new MessageEvent("message", { data: config.render }));
        },
      };
    },
    {
      initializeResult: initializeResult(
        0,
        { name: "nyte-ios", version: "check" },
        {
          ...context("dark"),
          platform: "mobile",
          deviceCapabilities: { touch: true, hover: false },
        },
      ),
      render: renderNotification(modules[0].module),
    },
  );
  page.on("pageerror", (error) => consoleErrors.push(error.message));
  await page.route("http://inline.test/", (route) =>
    route.fulfill({ status: 200, contentType: "text/html", body: inline.html }),
  );
  await page.goto("http://inline.test/", { waitUntil: "load" });

  try {
    await page.waitForFunction(
      () =>
        (window.__received ?? []).some(
          (m) => m.method === "ui/notifications/size-changed" && m.params.height > 80,
        ) || (window.__received ?? []).some((m) => m.method === "notifications/message"),
      undefined,
      { timeout: 15_000 },
    );
  } catch {
    failures.push({
      fixture: "inline",
      timeout: true,
      received: await page.evaluate(() => window.__received ?? null),
      consoleErrors,
      html: (await page.content()).slice(0, 400),
    });
  }

  await page.waitForTimeout(400);
  const received = await page.evaluate(() => window.__received);
  const errors = received
    .filter((m) => m.method === "notifications/message")
    .map((m) => m.params.data);
  const file = join(out, `inline-${modules[0].name}-dark.png`);
  await page.screenshot({ path: file, fullPage: true });
  results.push({
    fixture: `inline ${modules[0].name}`,
    theme: "dark",
    height: received.filter((m) => m.method === "ui/notifications/size-changed").at(-1)?.params
      .height,
    file,
    runtime: inline.runtime === CANVAS_RUNTIME,
  });

  if (errors.length > 0 || consoleErrors.length > 0)
    failures.push({ fixture: "inline", errors, consoleErrors });
  await page.close();
}

await browser.close();
server.close();

for (const result of results)
  console.log(
    `${result.fixture} ${result.theme}: height ${String(result.height)} → ${result.file}`,
  );

if (failures.length > 0) {
  console.error(JSON.stringify(failures, null, 2));
  process.exitCode = 1;
}
