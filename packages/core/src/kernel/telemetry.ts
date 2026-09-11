/**
 * The span vocabulary core emits, one entry per span name: what a caller
 * supplies at start and what the span may record before it ends. Attributes
 * are ids, names, counts, kinds, and durations. Never prompts, message text,
 * tool arguments or output, file paths, or error text.
 */
import type { StopReason } from "@nyte-ai/schema";
import type { RunPhase } from "@nyte-ai/protocol";
import type { TelemetryContext, TelemetrySpan } from "@nyte-ai/telemetry";
import type { HookInvocation } from "../plugins/hooks.ts";
import type { PublishOutcome, StepOutcome } from "./step.ts";
import type { RespondOutcome } from "./turn.ts";

export interface SpanCatalog {
  "nyte.step": {
    start: {
      "nyte.session.id": string;
      "nyte.head": string;
      "nyte.run.id"?: string;
      "nyte.run.phase"?: RunPhase["kind"];
    };
    end: { "nyte.step.outcome": StepOutcome["kind"] };
  };
  "nyte.respond": {
    start: {
      "nyte.run.id": string;
      "nyte.attempt": number;
      "nyte.model.provider": string;
      "nyte.model.id": string;
    };
    end: {
      "nyte.respond.outcome": RespondOutcome["kind"];
      "nyte.stop_reason": StopReason;
      "nyte.usage.input_tokens": number;
      "nyte.usage.output_tokens": number;
      "nyte.usage.cache_read_tokens": number;
      "nyte.usage.cache_write_tokens": number;
      "nyte.usage.total_tokens": number;
      "nyte.usage.cost": number;
    };
  };
  "nyte.ai.request": {
    start: {
      "nyte.model.provider": string;
      "nyte.model.id": string;
      "nyte.model.api": string;
      "nyte.request.step": HookInvocation<"before_request">["step"];
    };
    end: {
      "nyte.ai.time_to_first_event_ms": number;
      "nyte.ai.time_to_first_text_ms": number;
      "nyte.ai.event_count": number;
      "nyte.stop_reason": StopReason;
    };
  };
  "nyte.tool": {
    start: { "nyte.run.id": string; "nyte.tool.name": string; "nyte.call.id": string };
    end: { "nyte.tool.is_error": boolean; "nyte.tool.parked": boolean };
  };
  "nyte.compaction": {
    start: { "nyte.run.id": string; "nyte.compaction.reason": "threshold" | "overflow" };
    end: { "nyte.compaction.outcome": "summarized" | "skipped" };
  };
  "nyte.compaction.publish": {
    start: { "nyte.session.id": string; "nyte.head": string; "nyte.run.id": string };
    end: { "nyte.compaction.publication": "published" | Exclude<PublishOutcome, "ok"> };
  };
}

export type CatalogSpan<N extends keyof SpanCatalog> = Omit<TelemetrySpan, "setAttributes"> & {
  setAttributes(attributes: Partial<SpanCatalog[N]["end"]>): void;
};

export function startSpan<N extends keyof SpanCatalog, T>(
  telemetry: TelemetryContext,
  name: N,
  attributes: SpanCatalog[N]["start"],
  fn: (span: CatalogSpan<N>) => T | Promise<T>,
): Promise<T> {
  // SAFETY: every catalog `end` field is an AttributeValue, so the narrowed setter only restricts
  // callers to that span's keys. TypeScript cannot relate `Partial<SpanCatalog[N]["end"]>` to the
  // index signature for a generic `N` without giving `end` an index signature, which would allow any key.
  return telemetry.startSpan({ name, attributes }, (span) => fn(span as CatalogSpan<N>));
}
