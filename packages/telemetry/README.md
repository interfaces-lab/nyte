# Telemetry

`TelemetryContext.startSpan({ name, attributes }, fn)` creates a child span and calls `fn` synchronously, exactly once. It returns a promise with the callback's value or rejection, preserving identity, and keeps the span open until that promise settles. A synchronous throw becomes a rejection.

Spans accept scalar or homogeneous array attributes. `setAttributes` merges defined values and ignores `undefined`; `addEvent` preserves event order. Completion sets `ok`, and throw or rejection sets `error`. Explicit `setStatus` calls override automatic status, with the last call winning. Recording is synchronous and passive: backend failures are swallowed, and calls after settlement are ignored. Starting a child after settlement still runs its callback but records nothing.

`NOOP_TELEMETRY_CONTEXT` records nothing. `InMemoryTelemetryContext.spans()` returns spans in start order with deterministic numeric ids and no timestamps. `createOtelTelemetry(tracer)` from `@nyte-ai/telemetry/otel` uses only `@opentelemetry/api`; the host supplies the tracer and exporter. Children carry explicit parents without an ambient context manager. OTel status is written at settlement; an explicit error's name maps to `error.type`, and its message maps to the status description. Automatic errors include no error text.

Pass a context as `createNyte({ ..., telemetry })` or `step(..., { ..., telemetry })`. Core owns the typed vocabulary in `kernel/telemetry.ts`:

| Span | Parent | Attributes |
| --- | --- | --- |
| `nyte.step` | Supplied context | Session, head, available run id and phase, step outcome |
| `nyte.respond` | Step | Run, attempt, model, response outcome, stop reason, token usage and cost |
| `nyte.ai.request` | Response, compaction, or SDK fallback context | Model, request step, first event and first nonempty text durations, event count, stop reason |
| `nyte.tool` | Step | Run, tool, call id, error and parked flags |
| `nyte.compaction` | Response | Run, threshold or overflow reason, `summarized` or `skipped` outcome |
| `nyte.compaction.publish` | Step | Session, head, run, `published`, `conflict`, or `fenced` publication result |

`summarized` means generation succeeded, not that a checkpoint became durable. The publication span surrounds the actual ref compare-and-swap, after checkpoint object writes and cleanup-ref reads. It records the CAS result; a thrown failure sets error status without a publication result. Publication is a sibling of the response span under the step, after the response ends.

Each request that reaches the stream function gets its own request span, including retries. Failures in earlier request hooks create no request span. Compaction can make multiple requests, so span counts are not turn or checkpoint counts. Manual SDK summary requests use the SDK telemetry fallback unless a per-request context is supplied. Manual operations still have no generation or publication spans.

Request durations start just before invoking the stream function, after request hooks and option preparation. `nyte.ai.time_to_first_event_ms` measures the first event of any kind. `nyte.ai.time_to_first_text_ms` measures the first nonempty `text_delta`; empty text and reasoning events do not qualify. Each duration is captured once when its event is consumed, before forwarding it, and is absent if no qualifying event arrives. `nyte.ai.event_count` is captured when consumption ends and includes consumed terminal events, but not an error event synthesized by the outer catch. These measurements do not establish a speedup.

Core records ids, names, counts, kinds, costs, and durations. It never records prompts, message text, tool arguments or output, file paths, headers, or error messages. A checkpoint response has no assistant message, so its response span has no stop reason or usage attributes.

Raw summary failures belong to the separate optional SDK `onDiagnostic` callback, correlated with the public failure ID. They are not telemetry attributes; spans do not automatically log arbitrary causes.
