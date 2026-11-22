import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import {
  CANVAS_LAYOUT_GLOBAL,
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

const FINDINGS_KEPT = 24;

export const CanvasLayoutFindingType = Type.Object({
  rule: Type.String(),
  component: Type.String(),
  at: Type.Union([Type.String(), Type.Null()]),
  measured: Type.Number(),
  floor: Type.Number(),
  message: Type.String(),
  fix: Type.String(),
});

export type CanvasLayoutFinding = Static<typeof CanvasLayoutFindingType>;

export const CanvasPreviewFindingType = Type.Intersect([
  CanvasLayoutFindingType,
  Type.Object({ widths: Type.Array(Type.Number()) }),
]);

export type CanvasPreviewFinding = Static<typeof CanvasPreviewFindingType>;

export interface CanvasPreviewRequest {
  readonly module: CanvasModule;
  readonly theme: "light" | "dark";
}

export interface CanvasPreviewError {
  readonly phase: "load" | "render";
  readonly message: string;
  readonly stack: string | null;
}

export interface CanvasPreviewLog {
  readonly level: string;
  readonly text: string;
}

export interface CanvasPreviewReport {
  readonly png: Uint8Array;
  readonly heights: { readonly chat: number; readonly phone: number };
  readonly errors: readonly CanvasPreviewError[];
  readonly console: readonly CanvasPreviewLog[];
  readonly findings: readonly CanvasPreviewFinding[];
}

export type CanvasPreviewOutcome =
  | { readonly kind: "rendered"; readonly report: CanvasPreviewReport }
  | { readonly kind: "unavailable"; readonly reason: string };

export type CanvasPreviewer = (
  request: CanvasPreviewRequest,
  signal: AbortSignal,
) => Promise<CanvasPreviewOutcome>;

export interface CanvasPreviewPage {
  evaluate(expression: string): Promise<unknown>;
  resize(width: number, height: number): Promise<void>;
  capture(): Promise<Uint8Array>;
}

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

interface HarnessPage {
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
  postMessage(message: unknown, targetOrigin: string): void;
}

interface HarnessSetup {
  readonly initialize: ReturnType<typeof initializeResult>;
  readonly render: ReturnType<typeof renderNotification>;
  readonly quietMs: number;
  readonly timeoutMs: number;
  readonly consoleKept: number;
  readonly layout: string;
}

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
      if (state.console.length < setup.consoleKept) {
        state.console.push({ level, text: values.map(text).join(" ").slice(0, 2000) });
      }
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

    if (data.method === "notifications/message" && params !== null && "data" in params) {
      state.errors.push(params.data);
    }
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
            ) {
              resolve({ height: state.height, errors: state.errors, console: state.console });
            } else setTimeout(check, 50);
          };
          check();
        }),
    },
  });
  const layout: unknown = Object.getOwnPropertyDescriptor(globalThis, setup.layout)?.value;

  if (
    typeof layout === "object" &&
    layout !== null &&
    "arm" in layout &&
    typeof layout.arm === "function"
  ) {
    layout.arm();
  }
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
    layout: CANVAS_LAYOUT_GLOBAL,
  };

  return `(${installHarness.toString()}).call(globalThis, ${JSON.stringify(setup)})`;
}

async function settle(page: CanvasPreviewPage) {
  const answer = await page.evaluate("globalThis.__nytePreview.settle()");

  if (!Value.Check(settled, answer)) {
    throw new Error("The canvas preview harness answered something unreadable.");
  }

  return answer;
}

const checked = Type.Array(CanvasLayoutFindingType);

async function checkLayout(page: CanvasPreviewPage): Promise<readonly CanvasLayoutFinding[]> {
  const answer = await page.evaluate(
    `globalThis[${JSON.stringify(CANVAS_LAYOUT_GLOBAL)}]?.check() ?? []`,
  );

  if (!Value.Check(checked, answer)) {
    throw new Error("The canvas shell answered its layout check with something unreadable.");
  }

  return answer;
}

function mergeFindings(
  checks: readonly { readonly width: number; readonly findings: readonly CanvasLayoutFinding[] }[],
): CanvasPreviewFinding[] {
  const merged = new Map<string, CanvasPreviewFinding>();

  for (const check of checks) {
    for (const finding of check.findings) {
      const key = `${finding.rule} ${finding.message.replaceAll(/-?\d+(?:\.\d+)?(?= px| ×)/gu, "#")}`;
      const seen = merged.get(key);

      const worse =
        seen === undefined ||
        Math.abs(finding.floor - finding.measured) > Math.abs(seen.floor - seen.measured);

      merged.set(key, {
        ...(worse ? finding : seen),
        widths: [...new Set([...(seen?.widths ?? []), check.width])],
      });
    }
  }

  return [...merged.values()].slice(0, FINDINGS_KEPT);
}

export async function runCanvasPreview(
  page: CanvasPreviewPage,
  request: CanvasPreviewRequest,
): Promise<CanvasPreviewReport> {
  const { chat, phone } = CANVAS_PREVIEW_WIDTHS;
  await page.resize(chat, 900);

  if ((await page.evaluate(harness(request))) !== true) {
    throw new Error("The canvas shell did not start in the preview.");
  }

  const wide = await settle(page);
  await page.resize(chat, clampCanvasHeight(wide.height > 0 ? wide.height : 240));
  const narrow = await settle(page);
  const wideFindings = await checkLayout(page);
  const png = await page.capture();
  await page.resize(phone, 900);
  const last = await settle(page);
  const phoneFindings = await checkLayout(page);

  return {
    png,
    heights: { chat: narrow.height, phone: last.height },
    errors: last.errors.map((error) => ({ ...error, stack: error.stack ?? null })),
    console: last.console,
    findings: mergeFindings([
      { width: chat, findings: wideFindings },
      { width: phone, findings: phoneFindings },
    ]),
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
    ...(report.findings.length === 0
      ? ["No layout findings."]
      : describeCanvasFindings(report.findings)),
    ...logs,
  ].join("\n");
}

/**
 * The findings as an agent reads them: each rule's fix once, then one line per place it broke. A width is named only
 * when the finding shows at one of them, since most show at both.
 */
export function describeCanvasFindings(findings: readonly CanvasPreviewFinding[]): string[] {
  if (findings.length === 0) return [];
  const widths = Object.values(CANVAS_PREVIEW_WIDTHS).length;

  return [
    `Layout findings (${String(findings.length)}):`,
    ...[...new Set(findings.map((finding) => finding.rule))].flatMap((rule) => {
      const broken = findings.filter((finding) => finding.rule === rule);

      return [
        `${rule}: ${broken[0]?.fix ?? ""}.`,
        ...broken.map((finding) =>
          finding.widths.length === widths
            ? `- ${finding.message}.`
            : `- ${finding.message} (${finding.widths.join(", ")} px).`,
        ),
      ];
    }),
  ];
}
