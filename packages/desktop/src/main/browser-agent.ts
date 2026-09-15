/**
 * The contract between the browser capability layer (`browser.ts` and
 * `browser-runtime.ts`, which own the `WebContentsView` and speak CDP) and the
 * agent tools (`browser-tools.ts`, which never import `electron`).
 *
 * Verified against Electron 44.3.0 before this contract was written:
 * - `webContents.executeJavaScriptInIsolatedWorld` is isolated from the page's
 *   main world, shares its DOM, and is wiped by a cross-document navigation.
 * - `webContents.debugger.attach("1.3")` succeeds even with `devTools: false`.
 * - Synthesized mouse input is dropped until the window has been shown once.
 *   After that it lands while the window is blurred and while the view is
 *   hidden. Keyboard input and `capturePage` work without ever showing it.
 */
import type { SessionId } from "@nyte-ai/core";

/**
 * The workbench view key for a chat session's browser stage pane. The renderer
 * builds the same key, so an agent-opened page and the user's Browser tab are one
 * surface. Both sides import this; a second copy of the rule would let them drift
 * and make an agent's page silently invisible.
 */
export function sessionSurfaceId(sessionId: SessionId): string {
  return `stage:session:${encodeURIComponent(sessionId)}`;
}

/** Which guest session (cookie jar) a page belongs to. One per workspace, plus home. */
export type BrowserOwner =
  | { readonly kind: "home" }
  | { readonly kind: "project"; readonly path: string };

/** Why a surface is alive: the renderer holds `view:<view key>`, an agent holds `session:<id>`. */
export type BrowserHolder = `view:${string}` | `session:${string}`;

export interface BrowserRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

/** One element the model can name in a later call. */
export interface BrowserNode {
  /** Snapshot-stamped, e.g. `s4e7`. A ref from an earlier snapshot is refused, never guessed at. */
  readonly ref: string;
  readonly role: string;
  /** Accessible name, length-capped. The serializer escapes quotes and strips line breaks. */
  readonly name: string;
  readonly tag: string;
  readonly rect: BrowserRect;
  readonly value?: string;
  readonly href?: string;
  readonly level?: number;
  readonly disabled?: boolean;
  readonly checked?: boolean;
  readonly expanded?: boolean;
  readonly editable?: boolean;
}

/** Everything a tool needs to render a page report. Capping and framing happen in the tools layer. */
export interface BrowserPageState {
  readonly url: string;
  readonly title: string;
  readonly loading: boolean;
  /** Increments on every snapshot; refs carry it so drift fails loudly. */
  readonly snapshot: number;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly scroll: { readonly y: number; readonly height: number };
  readonly nodes: readonly BrowserNode[];
  /** Total before the node cap, so the tools layer can report what it withheld. */
  readonly totalNodes: number;
  readonly text: string;
  readonly blocked: number;
  readonly error: { readonly code: number; readonly description: string } | undefined;
}

export interface BrowserConsoleEntry {
  readonly level: "error" | "warning" | "info" | "debug";
  readonly message: string;
  readonly source: string;
  readonly at: number;
}

/** Why an action could not run. Returned, not thrown: the tools layer words it and re-reports. */
export type BrowserActionFailure =
  | { readonly kind: "stale_document"; readonly ref: string }
  | { readonly kind: "unknown_ref"; readonly ref: string }
  | { readonly kind: "detached"; readonly ref: string }
  | { readonly kind: "not_visible"; readonly ref: string }
  | {
      readonly kind: "occluded";
      readonly ref: string;
      readonly by: { readonly role: string; readonly name: string };
    }
  /** Mouse input needs the window to have been shown at least once. */
  | { readonly kind: "no_window" }
  | { readonly kind: "closed" }
  | { readonly kind: "crashed"; readonly reason: string };

export type BrowserActionResult =
  | { readonly kind: "ok"; readonly state: BrowserPageState }
  | { readonly kind: "failed"; readonly failure: BrowserActionFailure };

export interface BrowserTypeInput {
  readonly ref: string;
  readonly text: string;
  readonly clear?: boolean;
  readonly submit?: boolean;
}

export interface BrowserScrollInput {
  readonly direction: "up" | "down" | "top" | "bottom";
  readonly ref?: string;
  readonly pages?: number;
}

export type BrowserWaitInput =
  | { readonly until: "load" }
  | { readonly until: "text"; readonly text: string }
  | { readonly until: "gone"; readonly text: string }
  | { readonly until: "time"; readonly seconds: number };

/** A JSON-shaped value from the page. Functions and DOM nodes arrive as their string label. */
export type BrowserEvaluateResult =
  | { readonly kind: "value"; readonly json: string }
  | { readonly kind: "threw"; readonly message: string };

/** The capability surface the tools plugin is given. Page-level outcomes are returned, not thrown. */
export interface BrowserAgent {
  /** Bind a page to this session and load `url`. Resolves once it settles or fails. */
  open(input: {
    readonly session: SessionId;
    readonly owner: BrowserOwner;
    readonly url: string;
    readonly signal?: AbortSignal;
  }): Promise<BrowserActionResult>;
  /** Re-read the page and mint a new snapshot generation. `ref` narrows to one subtree. */
  snapshot(input: {
    readonly session: SessionId;
    readonly ref?: string;
    readonly signal?: AbortSignal;
  }): Promise<BrowserActionResult>;
  click(input: {
    readonly session: SessionId;
    readonly ref: string;
    /** What the caller believes it is clicking, checked against the snapshot it was shown. */
    readonly expect: string;
    readonly button?: "left" | "right" | "middle";
    readonly double?: boolean;
    readonly signal?: AbortSignal;
  }): Promise<BrowserActionResult>;
  type(
    input: BrowserTypeInput & {
      readonly session: SessionId;
      readonly expect: string;
      readonly signal?: AbortSignal;
    },
  ): Promise<BrowserActionResult>;
  press(input: {
    readonly session: SessionId;
    readonly key: string;
    readonly ref?: string;
    readonly signal?: AbortSignal;
  }): Promise<BrowserActionResult>;
  scroll(
    input: BrowserScrollInput & { readonly session: SessionId; readonly signal?: AbortSignal },
  ): Promise<BrowserActionResult>;
  wait(
    input: BrowserWaitInput & { readonly session: SessionId; readonly signal?: AbortSignal },
  ): Promise<BrowserActionResult>;
  /** Newest first. The ring buffer is per surface and survives navigation. */
  console(input: {
    readonly session: SessionId;
    readonly limit: number;
    readonly clear?: boolean;
  }): readonly BrowserConsoleEntry[];
  evaluate(input: {
    readonly session: SessionId;
    readonly expression: string;
    readonly ref?: string;
    readonly signal?: AbortSignal;
  }): Promise<BrowserEvaluateResult>;
  /** PNG bytes of the viewport, already downscaled, or undefined when nothing could be captured. */
  capture(input: { readonly session: SessionId }): Promise<Uint8Array | undefined>;
  /** Drop this session's hold. The page closes unless a panel is still showing it. */
  release(input: { readonly session: SessionId }): void;

  /** `stage:session:<encoded id>`, the same workbench view key the user's Browser tab shows. */
  sessionSurfaceId(sessionId: SessionId): string;
}
