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

export const CANVAS_PREVIEW_WIDTHS = { chat: 808, phone: 358 } as const;

const WIDTH_NAMES = { chat: "the chat column", phone: "a phone" } as const;

const SETTLE_TIMEOUT_MS = 8000;

const SETTLE_QUIET_MS = 400;

const CONSOLE_KEPT = 40;

export type CanvasPreviewRequest = {
  readonly module: CanvasModule;
  readonly theme: "light" | "dark";
};

export type CanvasPreviewError = {
  readonly phase: "load" | "render";
  readonly message: string;
  readonly stack: string | null;
};

export type CanvasPreviewLog = { readonly level: string; readonly text: string };

export type CanvasPreviewReport = {
  readonly png: Uint8Array;
  readonly heights: { readonly chat: number; readonly phone: number };
  readonly errors: readonly CanvasPreviewError[];
  readonly console: readonly CanvasPreviewLog[];
};

export type CanvasPreviewOutcome =
  | { readonly kind: "rendered"; readonly report: CanvasPreviewReport }
  | { readonly kind: "unavailable"; readonly reason: string };

export type CanvasPreviewer = (
  request: CanvasPreviewRequest,
  signal: AbortSignal,
) => Promise<CanvasPreviewOutcome>;

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

type HarnessPage = {
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
  postMessage(message: unknown, targetOrigin: string): void;
};

type HarnessSetup = {
  readonly initialize: ReturnType<typeof initializeResult>;
  readonly render: ReturnType<typeof renderNotification>;
  readonly quietMs: number;
  readonly timeoutMs: number;
  readonly consoleKept: number;
};

function installHarness(this: HarnessPage, setup: HarnessSetup): boolean {
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

  this.addEventListener("message", (event) => {
    const data = event.data;

    if (typeof data !== "object" || data === null || !("method" in data)) return;
    const params = "params" in data && typeof data.params === "object" ? data.params : null;

    if (data.method === "ui/notifications/initialized") this.postMessage(setup.render, "*");

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
  this.postMessage(setup.initialize, "*");

  return true;
}

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

  return `(${installHarness.toString()}).call(globalThis, ${JSON.stringify(setup)})`;
}

async function settle(page: CanvasPreviewPage) {
  const answer = await page.evaluate("globalThis.__nytePreview.settle()");

  if (!Value.Check(settled, answer))
    throw new Error("The canvas preview harness answered something unreadable.");

  return answer;
}

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
