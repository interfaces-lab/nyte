/**
 * `TelemetryContext` over an OpenTelemetry `Tracer`. Depends on
 * `@opentelemetry/api` only; the host supplies the tracer, the processor, and
 * the exporter. Parents are explicit (`trace.setSpan`), never ambient.
 */
import { context, SpanStatusCode, trace } from "@opentelemetry/api";
import type { Attributes, Span, Tracer } from "@opentelemetry/api";
import { NOOP_TELEMETRY_CONTEXT } from "./index.ts";
import type { SpanAttributes, SpanStatus, TelemetryContext, TelemetrySpan } from "./index.ts";

/** A backend failure must never change what the business callback returns or throws. */
function record(fn: () => void): void {
  try {
    fn();
  } catch {
    // Nowhere to report a failing telemetry backend but the backend itself.
  }
}

/** OTel keeps `undefined` values; drop them so an exporter never sees one. */
function otelAttributes(attributes: SpanAttributes): Attributes {
  return Object.fromEntries(Object.entries(attributes).filter(([, value]) => value !== undefined));
}

export function createOtelTelemetry(tracer: Tracer): TelemetryContext {
  const contextUnder = (parent?: Span): TelemetryContext => ({
    async startSpan(options, fn) {
      let backend: Span | undefined;
      record(() => {
        backend = tracer.startSpan(
          options.name,
          { attributes: otelAttributes(options.attributes ?? {}) },
          parent === undefined ? context.active() : trace.setSpan(context.active(), parent),
        );
      });
      let ended = false;
      let status: SpanStatus | undefined;
      const span: TelemetrySpan = {
        startSpan: (child, callback) =>
          ended
            ? NOOP_TELEMETRY_CONTEXT.startSpan(child, callback)
            : contextUnder(backend ?? parent).startSpan(child, callback),
        setAttributes(attributes) {
          if (ended) return;
          record(() => backend?.setAttributes(otelAttributes(attributes)));
        },
        addEvent(name, attributes = {}) {
          if (ended) return;
          record(() => backend?.addEvent(name, otelAttributes(attributes)));
        },
        setStatus(next) {
          // OTel makes OK irreversible, so the status is written once, at settlement.
          if (!ended) status = next;
        },
      };
      try {
        return await fn(span);
      } catch (error) {
        status ??= { status: "error" };
        throw error;
      } finally {
        ended = true;
        const code =
          (status ?? { status: "ok" }).status === "ok" ? SpanStatusCode.OK : SpanStatusCode.ERROR;
        record(() => backend?.setStatus({ code }));
        record(() => backend?.end());
      }
    },
  });
  return contextUnder();
}
