import { NOOP_TELEMETRY_CONTEXT } from "./index.ts";
import type {
  SpanAttributes,
  SpanOptions,
  SpanStatus,
  TelemetryContext,
  TelemetrySpan,
} from "./index.ts";

export interface RecordedEvent {
  readonly name: string;
  readonly attributes: SpanAttributes;
}

export interface RecordedSpan {
  readonly id: number;
  readonly parentId: number | undefined;
  readonly name: string;
  attributes: SpanAttributes;
  readonly events: readonly RecordedEvent[];
  status: SpanStatus;
  ended: boolean;
}

function defined(attributes: SpanAttributes): SpanAttributes {
  return Object.fromEntries(Object.entries(attributes).filter(([, value]) => value !== undefined));
}

/** Records spans in start order with deterministic ids and no timestamps. For tests. */
export class InMemoryTelemetryContext implements TelemetryContext {
  readonly #spans: RecordedSpan[] = [];

  spans(): readonly RecordedSpan[] {
    return this.#spans;
  }

  startSpan<T>(options: SpanOptions, fn: (span: TelemetrySpan) => T | Promise<T>): Promise<T> {
    return this.#startSpan(options, fn, undefined);
  }

  async #startSpan<T>(
    options: SpanOptions,
    fn: (span: TelemetrySpan) => T | Promise<T>,
    parentId: number | undefined,
  ): Promise<T> {
    const events: RecordedEvent[] = [];
    const recorded: RecordedSpan = {
      id: this.#spans.length + 1,
      parentId,
      name: options.name,
      attributes: defined(options.attributes ?? {}),
      events,
      status: { status: "ok" },
      ended: false,
    };
    this.#spans.push(recorded);
    let explicitStatus = false;
    const span: TelemetrySpan = {
      startSpan: (child, callback) =>
        recorded.ended
          ? NOOP_TELEMETRY_CONTEXT.startSpan(child, callback)
          : this.#startSpan(child, callback, recorded.id),
      setAttributes(attributes) {
        if (recorded.ended) return;
        recorded.attributes = { ...recorded.attributes, ...defined(attributes) };
      },
      addEvent(name, attributes = {}) {
        if (recorded.ended) return;
        events.push({ name, attributes: defined(attributes) });
      },
      setStatus(status) {
        if (recorded.ended) return;
        explicitStatus = true;
        recorded.status = status;
      },
    };
    try {
      return await fn(span);
    } catch (error) {
      if (!explicitStatus) recorded.status = { status: "error" };
      throw error;
    } finally {
      recorded.ended = true;
    }
  }
}
