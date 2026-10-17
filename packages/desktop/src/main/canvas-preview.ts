/**
 * The desktop canvas previewer, in main: each preview opens its own
 * offscreen window on the real canvas shell from its scheme, with the
 * preview's driver (`preload/canvas-preview.ts`) as its preload, answers the
 * driver's resizes and captures, and destroys the window after, so a canvas
 * that hangs its renderer takes nothing down with it once the preview's
 * signal aborts. The driver runs beside the canvas, so main reads its report
 * as untrusted and keeps its own capture. The windows share one in-memory
 * session of their own, which serves only the shell, under its policy plus
 * the chat frame's sandbox, so the page gets the frame's opaque origin; it
 * grants no permission, and its WebRTC may only go through a proxy that leads
 * nowhere. The host process asks for a preview over its RPC (`host-messages.ts`).
 */
import { pathToFileURL } from "node:url";
import { BrowserWindow, net, session } from "electron";
import type { Session } from "electron";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type {
  CanvasPreviewOutcome,
  CanvasPreviewRequest,
  CanvasPreviewer,
} from "@nyte-ai/plugin/core/canvas-preview";
import { resolveRendererFile, shellContentSecurityPolicy } from "../account/policy.ts";
import type { accountScheme } from "../account/scheme.ts";
import { CANVAS_PREVIEW_CHANNELS } from "../shared/canvas-preview.ts";
import { canvasShellUrl } from "./renderer.ts";

/** The preview session's partition; without the `persist:` prefix, nothing it stores outlives the app. */
const PARTITION = "canvas-preview";

/** A proxy nothing listens on, for every host, loopback included: WebRTC, kept to proxied traffic, then reaches no one, over UDP or TCP. */
const NOWHERE = "socks5://127.0.0.1:9";

/** The largest viewport side a driver may ask for, in CSS pixels. */
const VIEWPORT_LIMIT = 4_096;

const ViewportSide = Type.Integer({ minimum: 1, maximum: VIEWPORT_LIMIT });

/** What the driver answers with. Its report's PNG is not read: main answers with the capture it took. */
const DriverOutcome = Type.Union([
  Type.Object({
    kind: Type.Literal("rendered"),
    report: Type.Object({
      heights: Type.Object({ chat: Type.Number(), phone: Type.Number() }),
      errors: Type.Array(
        Type.Object({
          phase: Type.Union([Type.Literal("load"), Type.Literal("render")]),
          message: Type.String(),
          stack: Type.Union([Type.String(), Type.Null()]),
        }),
      ),
      console: Type.Array(Type.Object({ level: Type.String(), text: Type.String() })),
    }),
  }),
  Type.Object({ kind: Type.Literal("failed"), message: Type.String() }),
]);

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

function previewWindow(preview: Session, driver: string): BrowserWindow {
  const window = new BrowserWindow({
    show: false,
    width: 808,
    height: 900,
    useContentSize: true,
    webPreferences: {
      offscreen: { deviceScaleFactor: 1 },
      preload: driver,
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
 * `scheme`, driven by the preload at `driver`. Each preview renders
 * offscreen, or answers unavailable when its window fails to load the shell,
 * its driver fails, or its signal aborts first; the window is destroyed
 * either way.
 */
export function offscreenCanvasPreviewer(
  scheme: ReturnType<typeof accountScheme>,
  root: string,
  driver: string,
): CanvasPreviewer {
  let preview: Promise<Session> | undefined;

  return async (request, signal) => {
    preview ??= openPreviewSession(scheme, root);

    return previewOffscreen(await preview, driver, canvasShellUrl(scheme), request, signal);
  };
}

async function previewOffscreen(
  preview: Session,
  driver: string,
  shellUrl: string,
  request: CanvasPreviewRequest,
  signal: AbortSignal,
): Promise<CanvasPreviewOutcome> {
  if (signal.aborted) return { kind: "unavailable", reason: "The preview was stopped." };
  const window = previewWindow(preview, driver);
  const contents = window.webContents;
  let png: Uint8Array | undefined;

  contents.ipc.handle(CANVAS_PREVIEW_CHANNELS.resize, async (_event, width, height) => {
    if (!Value.Check(ViewportSide, width) || !Value.Check(ViewportSide, height))
      throw new Error("The preview asked for a viewport out of range.");
    window.setContentSize(width, height);
    await painted(window);
  });

  contents.ipc.handle(CANVAS_PREVIEW_CHANNELS.capture, async () => {
    await painted(window);
    png = new Uint8Array((await contents.capturePage()).toPNG());

    return png;
  });
  const answered = Promise.withResolvers<unknown>();
  contents.ipc.once(CANVAS_PREVIEW_CHANNELS.outcome, (_event, outcome) =>
    answered.resolve(outcome),
  );
  const stopped = Promise.withResolvers<never>();
  const stop = (): void => stopped.reject(new Error("The preview was stopped."));
  signal.addEventListener("abort", stop, { once: true });
  contents.once("render-process-gone", () =>
    stopped.reject(new Error("The preview's renderer stopped.")),
  );

  try {
    const run = async (): Promise<CanvasPreviewOutcome> => {
      await window.loadURL(shellUrl);
      contents.send(CANVAS_PREVIEW_CHANNELS.run, request);
      const outcome = await answered.promise;

      if (!Value.Check(DriverOutcome, outcome))
        throw new Error("The preview answered something unreadable.");

      if (outcome.kind === "failed") throw new Error(outcome.message);

      if (png === undefined) throw new Error("The preview finished without a capture.");

      return { kind: "rendered", report: { ...outcome.report, png } };
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
