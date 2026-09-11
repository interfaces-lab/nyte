/**
 * The span contract core emits through and a host adapts to a backend.
 * Explicit parents only: a span is the context for its children, and no
 * ambient (AsyncLocalStorage) context exists. Modelled on
 * `@earendil-works/pi-telemetry`; the adapter rules live in the README.
 */
export type AttributeValue = string | number | boolean;

export interface SpanAttributes {
  readonly [name: string]: AttributeValue | undefined;
}

export interface SpanOptions {
  readonly name: string;
  readonly attributes?: SpanAttributes;
}

export type SpanStatus = { readonly status: "ok" } | { readonly status: "error" };

export interface TelemetryContext {
  /** Calls `fn` synchronously, exactly once, and keeps the span open until its result settles. */
  startSpan<T>(options: SpanOptions, fn: (span: TelemetrySpan) => T | Promise<T>): Promise<T>;
}

export interface TelemetrySpan extends TelemetryContext {
  /** Merges; `undefined` values are ignored. */
  setAttributes(attributes: SpanAttributes): void;
  addEvent(name: string, attributes?: SpanAttributes): void;
  /** Overrides the automatic status (ok on return, error on throw); the last call wins. */
  setStatus(status: SpanStatus): void;
}

const noopSpan: TelemetrySpan = {
  setAttributes() {},
  addEvent() {},
  setStatus() {},
  async startSpan(_options, fn) {
    return fn(noopSpan);
  },
};

export const NOOP_TELEMETRY_CONTEXT: TelemetryContext = noopSpan;

export { InMemoryTelemetryContext, type RecordedSpan, type RecordedEvent } from "./memory.ts";
