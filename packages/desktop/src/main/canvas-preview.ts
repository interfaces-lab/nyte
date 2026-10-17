/**
 * The desktop canvas previewer, in main: each preview opens its own
 * offscreen window on the real canvas shell from its scheme, lets
 * `runCanvasPreview` drive it, and destroys it after, so a canvas that
 * hangs its renderer takes nothing down with it once the preview's signal
 * aborts. The windows share one in-memory session of their own, which
 * serves only the shell, under its policy plus the chat frame's sandbox,
 * so the page gets the frame's opaque origin; it grants no permission, and
 * its WebRTC may only go through a proxy that leads nowhere. The host process asks for a preview
 * over its RPC (`host-messages.ts`).
 */
import { pathToFileURL } from "node:url";
import { BrowserWindow, net, session } from "electron";
import type { Session } from "electron";
import { runCanvasPreview } from "@nyte-ai/plugin/core/canvas-preview";
import type {
  CanvasPreviewOutcome,
  CanvasPreviewPage,
  CanvasPreviewRequest,
  CanvasPreviewer,
} from "@nyte-ai/plugin/core/canvas-preview";
import { resolveRendererFile, shellContentSecurityPolicy } from "../account/policy.ts";
import type { accountScheme } from "../account/scheme.ts";
import { canvasShellUrl } from "./renderer.ts";

/** The preview session's partition; without the `persist:` prefix, nothing it stores outlives the app. */
const PARTITION = "canvas-preview";

/** A proxy nothing listens on, for every host, loopback included: WebRTC, kept to proxied traffic, then reaches no one, over UDP or TCP. */
const NOWHERE = "socks5://127.0.0.1:9";

/** Opens the preview session, serving the shell at `root` over `scheme`. */
async function openPreviewSession(
  scheme: ReturnType<typeof accountScheme>,
  root: string,
): Promise<Session> {
  const preview = session.fromPartition(PARTITION);
  await preview.setProxy({
    mode: "fixed_servers",
    proxyRules: NOWHERE,
    proxyBypassRules: "<-loopback>",
  });
  const policy = `${shellContentSecurityPolicy({ frameAncestor: "'none'" })}; sandbox allow-scripts`;
  preview.setPermissionRequestHandler((_contents, _permission, callback) => callback(false));
  preview.setPermissionCheckHandler(() => false);
  preview.setDevicePermissionHandler(() => false);
  preview.protocol.handle(scheme, async (request) => {
    if (request.method !== "GET") return new Response(null, { status: 405 });
    const target = resolveRendererFile({ account: undefined, canvas: root }, request.url);

    if (target.kind === "refused") return new Response(null, { status: target.status });

    try {
      const response = await net.fetch(pathToFileURL(target.path).toString());
      const headers = new Headers(response.headers);
      headers.set("Access-Control-Allow-Origin", "*");

      if (target.html) headers.set("Content-Security-Policy", policy);

      return new Response(response.body, { status: response.status, headers });
    } catch {
      return new Response(null, { status: 404 });
    }
  });

  return preview;
}

function previewWindow(preview: Session): BrowserWindow {
  const window = new BrowserWindow({
    show: false,
    width: 808,
    height: 900,
    useContentSize: true,
    webPreferences: {
      offscreen: { deviceScaleFactor: 1 },
      sandbox: true,
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      spellcheck: false,
      session: preview,
    },
  });
  window.webContents.setWebRTCIPHandlingPolicy("disable_non_proxied_udp");
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
  window.webContents.on("will-navigate", (event) => event.preventDefault());
  window.webContents.setFrameRate(60);

  return window;
}

/** Waits for the next two painted frames, so a resize has laid out before anyone measures or captures. */
function painted(window: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    let frames = 0;
    const done = (): void => {
      clearTimeout(fallback);

      if (!window.isDestroyed()) window.webContents.off("paint", paint);
      resolve();
    };
    const paint = (): void => {
      frames += 1;

      if (frames >= 2) done();
    };
    const fallback = setTimeout(done, 500);
    window.webContents.on("paint", paint);
    window.webContents.invalidate();
  });
}

/**
 * Returns a previewer over the canvas shell at `root`, served over
 * `scheme`. Each preview renders offscreen, or answers unavailable when its
 * window fails to load the shell or its signal aborts first; the window is
 * destroyed either way.
 */
export function offscreenCanvasPreviewer(
  scheme: ReturnType<typeof accountScheme>,
  root: string,
): CanvasPreviewer {
  let preview: Promise<Session> | undefined;

  return async (request, signal) => {
    preview ??= openPreviewSession(scheme, root);

    return previewOffscreen(await preview, canvasShellUrl(scheme), request, signal);
  };
}

async function previewOffscreen(
  preview: Session,
  shellUrl: string,
  request: CanvasPreviewRequest,
  signal: AbortSignal,
): Promise<CanvasPreviewOutcome> {
  if (signal.aborted) return { kind: "unavailable", reason: "The preview was stopped." };
  const window = previewWindow(preview);
  const contents = window.webContents;
  const page: CanvasPreviewPage = {
    evaluate: (expression) => contents.executeJavaScript(expression),
    async resize(width, height) {
      window.setContentSize(width, height);
      await painted(window);
    },
    async capture() {
      await painted(window);

      return new Uint8Array((await contents.capturePage()).toPNG());
    },
  };
  const stopped = Promise.withResolvers<never>();
  const stop = (): void => stopped.reject(new Error("The preview was stopped."));
  signal.addEventListener("abort", stop, { once: true });

  try {
    const run = async (): Promise<CanvasPreviewOutcome> => {
      await window.loadURL(shellUrl);

      return { kind: "rendered", report: await runCanvasPreview(page, request) };
    };

    return await Promise.race([run(), stopped.promise]);
  } catch (error) {
    return {
      kind: "unavailable",
      reason: `The preview window could not render the canvas: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    signal.removeEventListener("abort", stop);
    window.destroy();
  }
}
