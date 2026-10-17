/**
 * The desktop canvas previewer, in main: an offscreen window loads the real
 * canvas shell from its scheme, so the canvas runs under the same CSP and
 * origin as in the chat, and `runCanvasPreview` drives it. The host process
 * asks for a preview over its RPC (`host-messages.ts`). Previews run one at
 * a time in one window, which reloads the shell for each and closes after a
 * minute without one: a fresh offscreen window right after another closed
 * never finishes loading.
 */
import { BrowserWindow } from "electron";
import { runCanvasPreview } from "@nyte-ai/plugin/core/canvas-preview";
import type {
  CanvasPreviewOutcome,
  CanvasPreviewPage,
  CanvasPreviewRequest,
} from "@nyte-ai/plugin/core/canvas-preview";

const PREVIEW_TIMEOUT_MS = 45_000;

const IDLE_CLOSE_MS = 60_000;

let held: BrowserWindow | undefined;

let idle: ReturnType<typeof setTimeout> | undefined;

let queue: Promise<unknown> = Promise.resolve();

function previewWindow(): BrowserWindow {
  if (held !== undefined && !held.isDestroyed()) return held;
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
  held = window;

  return window;
}

/** Waits for the next two painted frames, so a resize has laid out before anyone measures or captures. */
function painted(window: BrowserWindow): Promise<void> {
  return new Promise((resolve) => {
    let frames = 0;
    const done = (): void => {
      window.webContents.off("paint", paint);
      clearTimeout(fallback);
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

async function preview(
  shellUrl: string,
  request: CanvasPreviewRequest,
): Promise<CanvasPreviewOutcome> {
  clearTimeout(idle);
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
  let timer: ReturnType<typeof setTimeout> | undefined;

  try {
    await window.loadURL(shellUrl);

    return await Promise.race([
      runCanvasPreview(page, request).then((report): CanvasPreviewOutcome => ({
        kind: "rendered",
        report,
      })),
      new Promise<CanvasPreviewOutcome>((resolve) => {
        timer = setTimeout(
          () =>
            resolve({ kind: "unavailable", reason: "The preview took longer than 45 seconds." }),
          PREVIEW_TIMEOUT_MS,
        );
      }),
    ]);
  } catch (error) {
    return {
      kind: "unavailable",
      reason: `The preview window could not render the canvas: ${error instanceof Error ? error.message : String(error)}`,
    };
  } finally {
    clearTimeout(timer);
    await window.loadURL("about:blank").catch(() => undefined);
    idle = setTimeout(() => {
      held = undefined;
      window.destroy();
    }, IDLE_CLOSE_MS);
  }
}

/**
 * Renders a preview offscreen in the shell at `shellUrl` once the previews
 * before it finish, or answers unavailable when the window fails to load
 * the shell or the preview runs past 45 seconds.
 */
export function previewCanvasOffscreen(
  shellUrl: string,
  request: CanvasPreviewRequest,
): Promise<CanvasPreviewOutcome> {
  const next = queue.then(() => preview(shellUrl, request));
  queue = next.catch(() => undefined);

  return next;
}
