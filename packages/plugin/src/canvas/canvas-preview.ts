/**
 * The canvas preview, renderer-agnostic: what a host's previewer takes and
 * answers, and the one run every previewer shares. A previewer loads the
 * real shell as a page of its own (Electron offscreen, a headless
 * Chromium); `runCanvasPreview` then drives that page through a harness
 * script that answers the shell's protocol in place of a client, records
 * its size reports, errors and console, and captures it at the chat
 * column's width, then measures it at a phone's.
 */
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  CANVAS_MAX_HEIGHT,
  CANVAS_RUNTIME,
  clampCanvasHeight,
  initializeResult,
  renderNotification,
} from "./canvas-protocol.ts";
import type { CanvasHostContext, CanvasModule } from "./canvas-protocol.ts";

/** The widths a preview measures at, in CSS pixels: the desktop chat column (its 840 px measure less the gutters) and a phone's. */
export const CANVAS_PREVIEW_WIDTHS = { chat: 808, phone: 358 } as const;

/** What the model reads each preview width as. */
const WIDTH_NAMES = { chat: "the chat column", phone: "a phone" } as const;

/** How long a preview waits for the canvas to settle at one width before it reports what it has. */
const SETTLE_TIMEOUT_MS = 8000;

/** How long the canvas's height must hold before the preview counts it settled. */
const SETTLE_QUIET_MS = 400;

const CONSOLE_KEPT = 40;

/**
 * Returns what a previewer renders: the compiled module and the theme to
 * show it in.
 *
 * @category plugins
 * @since 0.1.0
 */
export type CanvasPreviewRequest = {
  readonly module: CanvasModule;
  readonly theme: "light" | "dark";
};

/**
 * Returns one error the shell reported while the preview ran, its message
 * ending in the canvas file and line when the stack named one.
 *
 * @category plugins
 * @since 0.1.0
 */
export type CanvasPreviewError = {
  readonly phase: "load" | "render";
  readonly message: string;
  readonly stack: string | null;
};

/**
 * Returns one console call the canvas made while the preview ran.
 *
 * @category plugins
 * @since 0.1.0
 */
export type CanvasPreviewLog = { readonly level: string; readonly text: string };

/**
 * Returns what a preview saw: a PNG of the canvas at the chat column's
 * width, its height there and at a phone's (`CANVAS_PREVIEW_WIDTHS`), its
 * errors and its console.
 *
 * @category plugins
 * @since 0.1.0
 */
export type CanvasPreviewReport = {
  readonly png: Uint8Array;
  readonly heights: { readonly chat: number; readonly phone: number };
  readonly errors: readonly CanvasPreviewError[];
  readonly console: readonly CanvasPreviewLog[];
};

/**
 * Returns a previewer's answer: the report, or why this host cannot render
 * a preview (no renderer installed, the renderer failed to start).
 *
 * @category plugins
 * @since 0.1.0
 */
export type CanvasPreviewOutcome =
  | { readonly kind: "rendered"; readonly report: CanvasPreviewReport }
  | { readonly kind: "unavailable"; readonly reason: string };

/**
 * Renders a compiled canvas off-screen in the real shell. A host passes one
 * to `canvasPlugin` to give the model `canvas_preview`.
 *
 * @category plugins
 * @since 0.1.0
 */
export type CanvasPreviewer = (request: CanvasPreviewRequest) => Promise<CanvasPreviewOutcome>;

/**
 * Returns the page a previewer loaded the shell in, top-level, for
 * `runCanvasPreview` to drive: `evaluate` runs an expression in the page
 * and resolves with its JSON-safe value (awaiting a promise), `resize` sets
 * the viewport in CSS pixels, `capture` takes a PNG of the viewport.
 *
 * @category plugins
 * @since 0.1.0
 */
export type CanvasPreviewPage = {
  evaluate(expression: string): Promise<unknown>;
  resize(width: number, height: number): Promise<void>;
  capture(): Promise<Uint8Array>;
};

const settled = Type.Object({
  height: Type.Number(),
  errors: Type.Array(
    Type.Object({
      phase: Type.Union([Type.Literal("load"), Type.Literal("render")]),
      message: Type.String(),
      stack: Type.Optional(Type.String()),
    }),
  ),
  console: Type.Array(Type.Object({ level: Type.String(), text: Type.String() })),
});

function hostContext(theme: "light" | "dark"): CanvasHostContext {
  return {
    theme,
    styles: { variables: { "--nyte-custom-hue": "250", "--nyte-custom-chroma-scale": "0" } },
    displayMode: "inline",
    platform: "desktop",
    deviceCapabilities: { touch: false, hover: true },
  };
}

/**
 * The harness, as page source: it stands in for the client, so it answers
 * the shell's `ui/initialize` (already sent at load, so answered unasked),
 * posts the module once the shell is initialized, and keeps the size
 * reports, errors and console calls under `__nytePreview`. It runs in the
 * page's main world through the previewer's devtools channel, which the
 * shell's CSP does not govern; the canvas itself still runs under it.
 */
function harness(request: CanvasPreviewRequest): string {
  const initialize = initializeResult(
    1,
    { name: "nyte-desktop", version: String(CANVAS_RUNTIME) },
    hostContext(request.theme),
  );

  return `(() => {
  if (globalThis.__nytePreview !== undefined) return true;
  if (globalThis.__nyteCanvas === undefined) return false;
  const state = { height: 0, changed: 0, errors: [], console: [] };
  const text = (value) => {
    if (typeof value === "string") return value;
    if (value instanceof Error) return value.stack ?? String(value);
    try { return JSON.stringify(value) ?? String(value); } catch { return String(value); }
  };
  for (const level of ["log", "info", "warn", "error", "debug"]) {
    const original = console[level].bind(console);
    console[level] = (...values) => {
      if (state.console.length < ${CONSOLE_KEPT}) state.console.push({ level, text: values.map(text).join(" ").slice(0, 2000) });
      original(...values);
    };
  }
  addEventListener("message", (event) => {
    const data = event.data;
    if (data === null || typeof data !== "object") return;
    if (data.method === "ui/notifications/initialized") postMessage(${JSON.stringify(renderNotification(request.module))}, "*");
    if (data.method === "ui/notifications/size-changed") { state.height = data.params.height; state.changed = performance.now(); }
    if (data.method === "notifications/message") state.errors.push(data.params.data);
  });
  globalThis.__nytePreview = {
    settle: () => new Promise((resolve) => {
      const since = performance.now();
      const check = () => {
        const now = performance.now();
        const quiet = now - Math.max(state.changed, since) > ${SETTLE_QUIET_MS};
        if ((quiet && (state.height > 0 || state.errors.length > 0)) || now - since > ${SETTLE_TIMEOUT_MS})
          resolve({ height: state.height, errors: state.errors, console: state.console });
        else setTimeout(check, 50);
      };
      check();
    }),
  };
  postMessage(${JSON.stringify(initialize)}, "*");
  return true;
})()`;
}

async function settle(page: CanvasPreviewPage) {
  const answer = await page.evaluate("globalThis.__nytePreview.settle()");

  if (!Value.Check(settled, answer))
    throw new Error("The canvas preview harness answered something unreadable.");

  return answer;
}

/**
 * Runs a preview on a page that has loaded the shell: installs the harness
 * (retrying while the shell's script has not run yet), settles at the chat
 * column's width and captures it there, then settles again at a phone's
 * width for its height.
 *
 * @category plugins
 * @since 0.1.0
 */
export async function runCanvasPreview(
  page: CanvasPreviewPage,
  request: CanvasPreviewRequest,
): Promise<CanvasPreviewReport> {
  const { chat, phone } = CANVAS_PREVIEW_WIDTHS;
  await page.resize(chat, 900);
  const install = harness(request);

  let attempts = 0;

  while ((await page.evaluate(install)) !== true) {
    attempts += 1;

    if (attempts > 50) throw new Error("The canvas shell did not start in the preview.");
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  const wide = await settle(page);
  await page.resize(chat, clampCanvasHeight(wide.height > 0 ? wide.height : 240));
  const narrow = await settle(page);
  const png = await page.capture();
  await page.resize(phone, 900);
  const last = await settle(page);

  return {
    png,
    heights: { chat: narrow.height, phone: last.height },
    errors: last.errors.map((error) => ({ ...error, stack: error.stack ?? null })),
    console: last.console,
  };
}

/** Returns the preview as the model reads it beside the screenshot: heights, errors, console. */
export function describeCanvasPreview(report: CanvasPreviewReport): string {
  const heights = (["chat", "phone"] as const).map((width) => {
    const height = report.heights[width];
    const scrolls =
      height > CANVAS_MAX_HEIGHT ? `, so it scrolls past ${CANVAS_MAX_HEIGHT} px` : "";

    return `At ${CANVAS_PREVIEW_WIDTHS[width]} px wide (${WIDTH_NAMES[width]}) it is ${height} px tall${scrolls}.`;
  });
  const errors =
    report.errors.length === 0
      ? ["No errors."]
      : [
          `Errors (${report.errors.length}):`,
          ...report.errors.map((error) => `- ${error.phase}: ${error.message}`),
        ];
  const logs =
    report.console.length === 0
      ? []
      : [
          `Console (${report.console.length}):`,
          ...report.console.map((entry) => `- [${entry.level}] ${entry.text}`),
        ];

  return [
    "Preview only; the user has not seen it. The screenshot is the chat-column render.",
    ...heights,
    ...errors,
    ...logs,
  ].join("\n");
}
