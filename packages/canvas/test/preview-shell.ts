import { createServer } from "node:http";
import type { Server } from "node:http";
import { existsSync } from "node:fs";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { extname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "@playwright/test";
import type { Browser } from "@playwright/test";
import { compileCanvas } from "@nyte-ai/plugin/core/canvas-compile";
import { runCanvasPreview } from "@nyte-ai/plugin/core/canvas-preview";
import type { CanvasPreviewReport } from "@nyte-ai/plugin/core/canvas-preview";
import { build } from "vite";

const TYPES: Readonly<Record<string, string>> = {
  ".html": "text/html",
  ".js": "text/javascript",
  ".css": "text/css",
  ".woff2": "font/woff2",
};

const named = process.env["NYTE_CANVAS_CHROMIUM"];

const executablePath = named === undefined || named === "" ? chromium.executablePath() : named;

export const chromiumFound = existsSync(executablePath);

export type ShellPreviewed = { readonly report: CanvasPreviewReport; readonly phone: Uint8Array };

export type ShellPreview = {
  readonly preview: (
    source: string,
    files?: Readonly<Record<string, string>>,
  ) => Promise<ShellPreviewed>;
  readonly close: () => Promise<void>;
};

export async function openShellPreview(): Promise<ShellPreview> {
  const directory = await mkdtemp(join(tmpdir(), "nyte-canvas-shell-"));
  await build({
    configFile: fileURLToPath(new URL("../vite.config.ts", import.meta.url)),
    root: fileURLToPath(new URL("../src/shell/", import.meta.url)),
    logLevel: "silent",
    build: { outDir: directory, emptyOutDir: true },
  });
  const server = await serve(directory);
  const address = server.address();
  const origin = `http://127.0.0.1:${typeof address === "object" && address !== null ? String(address.port) : ""}`;
  const browser = await chromium.launch({ executablePath });

  return {
    preview: (source, files) => previewIn(browser, origin, source, files),
    close: async () => {
      await browser.close();
      server.close();
      await rm(directory, { recursive: true, force: true });
    },
  };
}

async function previewIn(
  browser: Browser,
  origin: string,
  source: string,
  files: Readonly<Record<string, string>> = {},
): Promise<ShellPreviewed> {
  const compiled = await compileCanvas(source, files);

  if (compiled.kind === "failed") throw new Error(JSON.stringify(compiled.errors));
  const page = await browser.newPage({ viewport: { width: 808, height: 900 } });

  try {
    await page.goto(`${origin}/index.html`);

    const report = await runCanvasPreview(
      {
        evaluate: (expression) => page.evaluate(expression),
        resize: (width, height) => page.setViewportSize({ width, height }),
        capture: async () => new Uint8Array(await page.screenshot({ fullPage: true })),
      },
      {
        module: { runtime: compiled.runtime, code: compiled.code, title: "Preview" },
        theme: "light",
      },
    );

    return { report, phone: new Uint8Array(await page.screenshot({ fullPage: true })) };
  } finally {
    await page.close();
  }
}

async function serve(directory: string): Promise<Server> {
  const server = createServer(async (request, response) => {
    const path = new URL(request.url ?? "/", "http://localhost").pathname;
    const body = await readFile(join(directory, path)).catch(() => undefined);

    if (body === undefined) {
      response.writeHead(404);
      response.end();

      return;
    }

    response.writeHead(200, { "Content-Type": TYPES[extname(path)] ?? "application/octet-stream" });
    response.end(body);
  });

  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));

  return server;
}
