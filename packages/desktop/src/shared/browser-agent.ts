import type { SessionId } from "@nyte-ai/sdk";

export function sessionSurfaceId(sessionId: SessionId): string {
  return `stage:session:${encodeURIComponent(sessionId)}`;
}

export type BrowserOwner =
  | { readonly kind: "home" }
  | { readonly kind: "project"; readonly path: string };

export type BrowserHolder = `view:${string}` | `session:${string}`;

export interface BrowserRect {
  readonly x: number;
  readonly y: number;
  readonly width: number;
  readonly height: number;
}

export interface BrowserNode {
  readonly ref: string;
  readonly role: string;
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

export interface BrowserPageState {
  readonly url: string;
  readonly title: string;
  readonly loading: boolean;
  readonly snapshot: number;
  readonly viewport: { readonly width: number; readonly height: number };
  readonly scroll: { readonly y: number; readonly height: number };
  readonly nodes: readonly BrowserNode[];
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
  | { readonly kind: "no_window" }
  | { readonly kind: "closed" }
  | { readonly kind: "crashed"; readonly reason: string };

export type BrowserActionResult =
  | { readonly kind: "ok"; readonly state: BrowserPageState }
  | { readonly kind: "failed"; readonly failure: BrowserActionFailure };

interface BrowserTypeInput {
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

export type BrowserEvaluateResult =
  | { readonly kind: "value"; readonly json: string }
  | { readonly kind: "threw"; readonly message: string };

export interface BrowserAgent {
  open(input: {
    readonly session: SessionId;
    readonly owner: BrowserOwner;
    readonly url: string;
    readonly signal?: AbortSignal;
  }): Promise<BrowserActionResult>;
  snapshot(input: {
    readonly session: SessionId;
    readonly ref?: string;
    readonly signal?: AbortSignal;
  }): Promise<BrowserActionResult>;
  click(input: {
    readonly session: SessionId;
    readonly ref: string;
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
  console(input: {
    readonly session: SessionId;
    readonly limit: number;
    readonly clear?: boolean;
  }): Promise<readonly BrowserConsoleEntry[]>;
  evaluate(input: {
    readonly session: SessionId;
    readonly expression: string;
    readonly ref?: string;
    readonly signal?: AbortSignal;
  }): Promise<BrowserEvaluateResult>;
  capture(input: { readonly session: SessionId }): Promise<Uint8Array | undefined>;
  release(input: { readonly session: SessionId }): void;

  sessionSurfaceId(sessionId: SessionId): string;
}
