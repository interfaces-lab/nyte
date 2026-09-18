import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type Model,
  type SimpleStreamOptions,
} from "@nyte-ai/ai";
import { NOOP_TELEMETRY_CONTEXT, type TelemetryContext } from "@nyte-ai/telemetry";
import {
  applyStreamOptionsPatch,
  type HookRegistry,
  type HookInvocation,
} from "../../plugins/hooks.ts";
import type { StreamFn, StreamOptions } from "../loop/types.ts";
import type { ProviderCompaction } from "../compaction.ts";
import { startSpan } from "../telemetry.ts";

const STREAM_OPTION_KEYS = [
  "maxRetries",
  "maxRetryDelayMs",
  "transport",
  "cacheRetention",
  "fast",
  "temperature",
  "maxTokens",
  "headers",
  "samplingParams",
] satisfies readonly (keyof StreamOptions)[];

function pickStreamOptions(options: SimpleStreamOptions): StreamOptions {
  const picked: StreamOptions = {};
  for (const key of STREAM_OPTION_KEYS) {
    if (options[key] !== undefined) Object.assign(picked, { [key]: options[key] });
  }
  return picked;
}

function withStreamOptions(
  options: SimpleStreamOptions,
  patched: StreamOptions,
): SimpleStreamOptions {
  const next: SimpleStreamOptions = { ...options };
  for (const key of STREAM_OPTION_KEYS) {
    if (patched[key] === undefined) delete next[key];
    else Object.assign(next, { [key]: patched[key] });
  }
  return next;
}

export function failedAssistant(
  model: Pick<Model<Api>, "api" | "provider" | "id">,
  cause: unknown,
  stopReason: "error" | "aborted",
): AssistantMessage {
  return {
    role: "assistant",
    content: [],
    api: model.api,
    provider: model.provider,
    model: model.id,
    usage: {
      input: 0,
      output: 0,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 0,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
    stopReason,
    errorMessage: cause instanceof Error ? cause.message : String(cause),
    timestamp: Date.now(),
  };
}

type RequestInvocation = Pick<
  HookInvocation<"before_request">,
  "head" | "runId" | "sessionId" | "attempt"
>;

interface RequestHooks {
  readonly hooks: HookRegistry;
  readonly invocation: (signal: AbortSignal | undefined) => RequestInvocation;
}

/** Shared request options and hooks, without replacing a request's purpose or prompt. */
export function requestStream(
  options: Pick<RequestHooks, "invocation"> & {
    readonly hooks?: RequestHooks["hooks"];
    readonly streamFn: StreamFn;
    readonly telemetry?: TelemetryContext;
    readonly errorPolicy?: {
      // Provider and iterator throws are opaque host-only diagnostics, not parsed input.
      readonly capture: (cause: unknown) => void;
      readonly message: string;
    };
    readonly streamOptions?: StreamOptions;
    readonly step: HookInvocation<"before_request">["step"];
    readonly systemPrompt?: (signal: AbortSignal | undefined) => string;
  },
): StreamFn {
  return (model, context, requestOptions) => {
    const out = createAssistantMessageEventStream();
    void (async () => {
      requestOptions?.signal?.throwIfAborted();
      const invocation = options.invocation(requestOptions?.signal);
      let streamOptions: SimpleStreamOptions = {
        ...requestOptions,
        sessionId: requestOptions?.sessionId ?? invocation.sessionId,
      };
      streamOptions = withStreamOptions(
        streamOptions,
        applyStreamOptionsPatch(options.streamOptions ?? {}, pickStreamOptions(streamOptions)),
      );
      if (options.hooks?.has("before_request")) {
        const result = await options.hooks.run(
          "before_request",
          {
            ...invocation,
            model: { provider: model.provider, modelId: model.id },
            step: options.step,
            streamOptions: pickStreamOptions(streamOptions),
          },
          requestOptions?.signal,
        );
        if (result?.streamOptions !== undefined) {
          streamOptions = withStreamOptions(
            streamOptions,
            applyStreamOptionsPatch(pickStreamOptions(streamOptions), result.streamOptions),
          );
        }
      }
      const prompt = options.systemPrompt?.(requestOptions?.signal);
      requestOptions?.signal?.throwIfAborted();
      await startSpan(
        requestOptions?.telemetryContext ?? options.telemetry ?? NOOP_TELEMETRY_CONTEXT,
        "nyte.ai.request",
        {
          "nyte.model.provider": model.provider,
          "nyte.model.id": model.id,
          "nyte.model.api": model.api,
          "nyte.request.step": options.step,
        },
        async (span) => {
          const started = performance.now();
          let events = 0;
          let receivedText = false;
          try {
            const inner = await options.streamFn(
              model,
              prompt === undefined ? context : { ...context, systemPrompt: prompt },
              { ...streamOptions, telemetryContext: span },
            );
            for await (const event of inner) {
              if (events === 0) {
                span.setAttributes({
                  "nyte.ai.time_to_first_event_ms": performance.now() - started,
                });
              }
              if (!receivedText && event.type === "text_delta" && event.delta.length > 0) {
                receivedText = true;
                span.setAttributes({
                  "nyte.ai.time_to_first_text_ms": performance.now() - started,
                });
              }
              events += 1;
              if (event.type === "done" || event.type === "error") {
                span.setAttributes({ "nyte.stop_reason": event.reason });
              }
              if (event.type === "error" && event.reason === "error") {
                span.setStatus({ status: "error" });
              }
              out.push(event);
            }
            out.end();
          } catch (cause) {
            span.setAttributes({
              "nyte.stop_reason": requestOptions?.signal?.aborted ? "aborted" : "error",
            });
            throw cause;
          } finally {
            span.setAttributes({ "nyte.ai.event_count": events });
          }
        },
      );
    })().catch((cause: unknown) => {
      const reason = requestOptions?.signal?.aborted ? "aborted" : "error";
      if (options.errorPolicy !== undefined) {
        try {
          options.errorPolicy.capture(cause);
        } catch {
          // Capture is observational; a failure must still terminate the stream.
        }
      }
      out.push({
        type: "error",
        reason,
        error: failedAssistant(model, options.errorPolicy?.message ?? cause, reason),
      });
    });
    return out;
  };
}

/** A missing or failed provider hook leaves compaction to the portable summarizer. */
export function providerCompactionFor(options: RequestHooks): ProviderCompaction {
  return (request, signal) =>
    options.hooks.run(
      "before_compaction",
      {
        ...options.invocation(signal),
        ...request,
        model: { provider: request.model.provider, modelId: request.model.id },
      },
      signal,
    );
}
