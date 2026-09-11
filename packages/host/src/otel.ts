/**
 * OTLP/HTTP export of the spans core emits, for a local viewer while
 * dogfooding. Off unless an endpoint is named; on, this process owns one
 * tracer provider and never registers it globally, so nothing else in the
 * process is instrumented by accident.
 */
import process from "node:process";
import { OTLPTraceExporter } from "@opentelemetry/exporter-trace-otlp-http";
import { resourceFromAttributes } from "@opentelemetry/resources";
import { BatchSpanProcessor, TracerProvider } from "@opentelemetry/sdk-trace";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { NOOP_TELEMETRY_CONTEXT } from "@nyte-ai/telemetry";
import type { TelemetryContext } from "@nyte-ai/telemetry";
import { createOtelTelemetry } from "@nyte-ai/telemetry/otel";

export interface OtelExportOptions {
  readonly serviceName: string;
  /** The full traces URL. Defaults to `NYTE_OTEL_ENDPOINT`; an origin there gets `/v1/traces` appended. */
  readonly endpoint?: string;
}

export interface OtelExport {
  readonly telemetry: TelemetryContext;
  /** Flushes queued spans. Call after the host is closed. */
  shutdown(): Promise<void>;
}

export function createOtelExport(options: OtelExportOptions): OtelExport {
  const endpoint = options.endpoint ?? process.env.NYTE_OTEL_ENDPOINT;
  if (endpoint === undefined || endpoint === "") {
    return { telemetry: NOOP_TELEMETRY_CONTEXT, shutdown: () => Promise.resolve() };
  }
  const url = new URL(endpoint);
  if (options.endpoint === undefined && url.pathname === "/") url.pathname = "/v1/traces";
  const provider = new TracerProvider({
    resource: resourceFromAttributes({ [ATTR_SERVICE_NAME]: options.serviceName }),
    spanProcessors: [
      new BatchSpanProcessor({ exporter: new OTLPTraceExporter({ url: url.href }) }),
    ],
  });
  return {
    telemetry: createOtelTelemetry(provider.getTracer(options.serviceName)),
    shutdown: () => provider.shutdown(),
  };
}
