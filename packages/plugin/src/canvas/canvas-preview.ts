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

/** What the harness answers the shell with, and how it decides the canvas has settled. */
type HarnessSetup = {
  readonly initialize: ReturnType<typeof initializeResult>;
  readonly render: ReturnType<typeof renderNotification>;
  readonly quietMs: number;
  readonly timeoutMs: number;
  readonly consoleKept: number;
};

/**
 * The harness: it stands in for the client, so it answers the shell's
 * `ui/initialize` (already sent at load, so answered unasked), posts the
 * module once the shell is initialized, and keeps the size reports, errors
 * and console calls under `__nytePreview`. It answers false until the
 * shell's script has run. A previewer runs its source in the page's main
 * world through its devtools channel, which the shell's CSP does not
 * govern, so it uses only its argument and the page's globals; the canvas
 * itself still runs under the CSP.
 */
function installHarness(setup: HarnessSetup): boolean {
  if ("__nytePreview" in globalThis) return true;

  if (!("__nyteCanvas" in globalThis)) return false;
  const state = {
    height: 0,
    changed: 0,
    errors: new Array<unknown>(),
    console: new Array<{ readonly level: string; readonly text: string }>(),
  };
  // oxlint-disable-next-line unicorn/consistent-function-scoping -- the harness runs from its source in the page, so it holds its own helpers
  const text = (value: unknown): string => {
    if (typeof value === "string") return value;

    if (value instanceof Error) return value.stack ?? String(value);

    try {
      return JSON.stringify(value) ?? String(value);
    } catch {
      return String(value);
    }
  };

  for (const level of ["log", "info", "warn", "error", "debug"] as const) {
    const original = console[level].bind(console);
    console[level] = (...values: unknown[]) => {
      if (state.console.length < setup.consoleKept)
        state.console.push({ level, text: values.map(text).join(" ").slice(0, 2000) });
      original(...values);
    };
  }

  addEventListener("message", (event: MessageEvent<unknown>) => {
    const data = event.data;

    if (typeof data !== "object" || data === null || !("method" in data)) return;
    const params = "params" in data && typeof data.params === "object" ? data.params : null;

    if (data.method === "ui/notifications/initialized") postMessage(setup.render, "*");

    if (
      data.method === "ui/notifications/size-changed" &&
      params !== null &&
      "height" in params &&
      typeof params.height === "number"
    ) {
      state.height = params.height;
      state.changed = performance.now();
    }

    if (data.method === "notifications/message" && params !== null && "data" in params)
      state.errors.push(params.data);
  });
  Object.defineProperty(globalThis, "__nytePreview", {
    value: {
      settle: () =>
        new Promise((resolve) => {
          const since = performance.now();
          const check = (): void => {
            const now = performance.now();
            const quiet = now - Math.max(state.changed, since) > setup.quietMs;

            if (
              (quiet && (state.height > 0 || state.errors.length > 0)) ||
              now - since > setup.timeoutMs
            )
              resolve({ height: state.height, errors: state.errors, console: state.console });
            else setTimeout(check, 50);
          };
          check();
        }),
    },
  });
  postMessage(setup.initialize, "*");

  return true;
}

/** Returns the expression that installs the harness for `request` in a preview page. */
function harness(request: CanvasPreviewRequest): string {
  const setup: HarnessSetup = {
    initialize: initializeResult(
      1,
      { name: "nyte-preview", version: String(CANVAS_RUNTIME) },
      hostContext(request.theme),
    ),
    render: renderNotification(request.module),
    quietMs: SETTLE_QUIET_MS,
    timeoutMs: SETTLE_TIMEOUT_MS,
    consoleKept: CONSOLE_KEPT,
  };

  return `(${installHarness.toString()})(${JSON.stringify(setup)})`;
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
