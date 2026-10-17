/**
 * The desktop canvas previewer, in main: each preview opens its own
 * offscreen window on the real canvas shell from its scheme, lets
 * `runCanvasPreview` drive it, and destroys it after, so a canvas that
 * hangs its renderer takes nothing down with it once the preview's signal
 * aborts. The host process asks for a preview over its RPC
 * (`host-messages.ts`).
 */
import { BrowserWindow } from "electron";
import { runCanvasPreview } from "@nyte-ai/plugin/core/canvas-preview";
import type {
  CanvasPreviewOutcome,
  CanvasPreviewPage,
  CanvasPreviewRequest,
} from "@nyte-ai/plugin/core/canvas-preview";

function previewWindow(): BrowserWindow {
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
    },
  });
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
 * Renders a preview offscreen in the shell at `shellUrl`, or answers
 * unavailable when the window fails to load the shell or `signal` aborts
 * first; the window is destroyed either way.
 */
export async function previewCanvasOffscreen(
  shellUrl: string,
  request: CanvasPreviewRequest,
  signal: AbortSignal,
): Promise<CanvasPreviewOutcome> {
  if (signal.aborted) return { kind: "unavailable", reason: "The preview was stopped." };
  const window = previewWindow();
  const contents = window.webContents;
  const page: CanvasPreviewPage = {
    evaluate: (expression) => contents.executeJavaScript(expression, true),
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
