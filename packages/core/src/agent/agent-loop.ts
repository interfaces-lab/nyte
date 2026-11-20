import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Model,
} from "@nyte-ai/schema/model";
import type {
  Delivery,
  Failure,
  MessageId,
  MessageSource,
  ModelInfo,
  ModelRequest,
  ToolOutcome,
  Usage,
} from "@nyte-ai/schema";
import type { AssistantMessageEventStream } from "@nyte-ai/ai";
import {
  abortableSleep,
  assistantRetryDelayMs,
  failedTransiently,
  retryDelayMs,
} from "@nyte-ai/ai/utils/retry";
import type { RetryPolicy } from "@nyte-ai/ai/utils/retry";
import { overflowsContext, stoppedShort } from "@nyte-ai/ai/utils/overflow";
import { classifyAssistantFailure, requestUnsent } from "@nyte-ai/ai/utils/failure";

export interface LoopRequest {
  readonly attempt: number;
  readonly overflow: Failure | null;
}

export interface PreparedRequest {
  readonly kind: "request";
  readonly request: ModelRequest;
  readonly model: Model<Api>;
  readonly info: ModelInfo;
  readonly context: Context;
  readonly at: number;
  usage(message: AssistantMessage): Usage;
}

export type Prepared<P extends PreparedRequest = PreparedRequest> =
  | P
  | { readonly kind: "failed"; readonly failure: Failure };

export interface LoopResponse {
  readonly events: AssistantMessageEventStream;
  readonly settled: Promise<void>;
}

export type ModelToolCall = Extract<
  AssistantMessage["content"][number],
  { readonly type: "toolCall" }
>;

type ToolResult = ToolOutcome | { readonly kind: "parked" };

export interface LoopInput {
  readonly message: MessageId;
  readonly delivery: Delivery;
  readonly source: MessageSource;
}

export interface OutagePolicy {
  readonly budgetMs: number;
  readonly maxDelayMs: number;
}

export interface FailedResponse<P extends PreparedRequest = PreparedRequest> {
  readonly usage: Usage;
  readonly prepared: P;
}

export interface SettledResponse<P extends PreparedRequest = PreparedRequest> {
  readonly message: AssistantMessage;
  readonly calls: readonly ModelToolCall[];
  readonly usage: Usage;
  readonly prepared: P;
}

export interface LoopRetry<P extends PreparedRequest = PreparedRequest> {
  readonly attempt: number;
  readonly until: number;
  readonly failure: Failure;
  readonly response: FailedResponse<P>;
}

export interface LoopConfig<P extends PreparedRequest = PreparedRequest> {
  readonly attempt: number;
  readonly retry: RetryPolicy;
  readonly outage: OutagePolicy;
  ready(signal: AbortSignal): Promise<void>;
  prepareRequest(request: LoopRequest, signal: AbortSignal): Promise<Prepared<P>>;
  stream(prepared: P, signal: AbortSignal): Promise<LoopResponse>;
  blockStarted(kind: "text" | "thinking" | "toolCall", index: number): Promise<void>;
  blockUpdated(event: AssistantMessageEvent): void;
  retrying(retry: LoopRetry<P>): Promise<void>;
  settleResponse(response: SettledResponse<P>, signal: AbortSignal): Promise<void>;
  readonly tools: { execute(call: ModelToolCall, signal: AbortSignal): Promise<ToolResult> };
  boundary(signal: AbortSignal): Promise<readonly LoopInput[]>;
}

export type LoopEnd<P extends PreparedRequest = PreparedRequest> =
  | { readonly reason: "done"; readonly usage: Usage }
  | { readonly reason: "parked"; readonly usage: Usage }
  | { readonly reason: "stopped"; readonly response: FailedResponse<P> | null }
  | {
      readonly reason: "failed";
      readonly failure: Failure;
      readonly response: FailedResponse<P> | null;
    };

type Outcome =
  | {
      readonly kind: "done";
      readonly message: AssistantMessage;
      readonly calls: readonly ModelToolCall[];
      readonly usage: Usage;
    }
  | { readonly kind: "overflow"; readonly failure: Failure; readonly usage: Usage }
  | {
      readonly kind: "failed";
      readonly failure: Failure;
      readonly retryable: boolean;
      readonly unsent: boolean;
      readonly usage: Usage;
    }
  | { readonly kind: "unfinished" }
  | { readonly kind: "interrupted"; readonly usage: Usage }
  | { readonly kind: "stopped"; readonly usage: Usage };

const STOPPED = { reason: "stopped", response: null } as const;

const CUT_OFF =
  "the response reached the output token limit before it finished, so this call did not run. Re-issue it with smaller arguments, for example by splitting the change across several calls.";

const UNFINISHED: Failure = {
  class: "provider",
  message: "The response ended without a result.",
};

export const INTERRUPTED: Failure = {
  class: "runner",
  message: "The response was interrupted before it finished.",
};

export async function agentLoop<P extends PreparedRequest>(
  config: LoopConfig<P>,
  signal: AbortSignal,
): Promise<LoopEnd<P>> {
  let attempt = config.attempt;
  let retries = 0;
  let outageStart: number | null = null;
  let outageAttempts = 0;
  let overflowed = false;

  let overflow: { readonly failure: Failure; readonly response: FailedResponse<P> } | null = null;

  for (;;) {
    const next = overflow === null ? attempt : attempt + 1;
    await config.ready(signal);

    if (signal.aborted) return { reason: "stopped", response: overflow?.response ?? null };

    const prepared = await config.prepareRequest(
      { attempt: next, overflow: overflow?.failure ?? null },
      signal,
    );

    if (prepared.kind === "failed")
      return { reason: "failed", failure: prepared.failure, response: overflow?.response ?? null };

    if (overflow !== null) {
      attempt = next;
      await config.retrying({ attempt, until: Date.now(), ...overflow });
      overflow = null;
    }

    const outcome = await respond(config, prepared, signal);

    switch (outcome.kind) {
      case "stopped":
        return { reason: "stopped", response: { usage: outcome.usage, prepared } };
      case "unfinished":
        return { reason: "failed", failure: UNFINISHED, response: null };
      case "interrupted":
        attempt += 1;

        await config.retrying({
          attempt,
          until: Date.now(),
          failure: INTERRUPTED,
          response: { usage: outcome.usage, prepared },
        });

        continue;
      case "failed": {
        const { failure } = outcome;
        const response = { usage: outcome.usage, prepared };

        if (outcome.retryable && outcome.unsent) {
          outageStart ??= Date.now();

          if (Date.now() - outageStart < config.outage.budgetMs) {
            outageAttempts += 1;
            attempt += 1;

            const until =
              Date.now() +
              Math.min(retryDelayMs(config.retry, outageAttempts), config.outage.maxDelayMs);

            await config.retrying({ attempt, until, failure, response });

            const slept = await abortableSleep(until - Date.now(), signal).then(
              () => true,
              () => false,
            );

            if (!slept) return STOPPED;
            continue;
          }

          return { reason: "failed", failure, response };
        }

        const delay = outcome.retryable
          ? assistantRetryDelayMs(config.retry, retries + 1, failure.retryAfterMs)
          : null;

        if (delay === null || retries >= config.retry.maxRetries)
          return { reason: "failed", failure, response };
        retries += 1;
        attempt += 1;
        const until = Date.now() + delay;
        await config.retrying({ attempt, until, failure, response });

        const slept = await abortableSleep(until - Date.now(), signal).then(
          () => true,
          () => false,
        );

        if (!slept) return STOPPED;
        continue;
      }

      case "overflow":
        overflow = { failure: outcome.failure, response: { usage: outcome.usage, prepared } };

        if (overflowed) return { reason: "failed", ...overflow };
        overflowed = true;
        continue;
      case "done":
        break;
    }

    retries = 0;
    outageStart = null;
    outageAttempts = 0;
    overflowed = false;
    const { message, calls, usage } = outcome;
    await config.settleResponse({ message, calls, usage, prepared }, signal);
    let parked = false;

    for (const call of calls) {
      if (signal.aborted) return STOPPED;
      const result = await config.tools.execute(call, signal);

      if (result.kind === "parked") parked = true;
    }

    if (parked) return { reason: "parked", usage };
    const landed = await config.boundary(signal);

    const asked = landed.some(
      (input) =>
        input.delivery !== "attach" ||
        input.source.kind === "child" ||
        input.source.kind === "job" ||
        input.source.kind === "answer",
    );

    if (calls.length === 0 && !asked) return { reason: "done", usage };
  }
}

async function respond<P extends PreparedRequest>(
  config: LoopConfig<P>,
  prepared: P,
  signal: AbortSignal,
): Promise<Outcome> {
  const response = await config.stream(prepared, signal);
  let final: AssistantMessage | null = null;

  for await (const event of response.events) {
    switch (event.type) {
      case "start":
        break;
      case "text_start":
        await config.blockStarted("text", event.contentIndex);
        break;
      case "thinking_start":
        await config.blockStarted("thinking", event.contentIndex);
        break;
      case "toolcall_start":
        await config.blockStarted("toolCall", event.contentIndex);
        break;
      case "done":
        final = event.message;
        break;
      case "error":
        final = event.error;
        break;
      default:
        config.blockUpdated(event);
    }
  }

  if (final === null) return { kind: "unfinished" };
  await response.settled;

  const usage = prepared.usage(final);

  if (final.stopReason === "aborted")
    return signal.aborted ? { kind: "stopped", usage } : { kind: "interrupted", usage };

  if (final.stopReason === "error")
    return overflowsContext(final)
      ? { kind: "overflow", failure: buildContextOverflowFailure(final), usage }
      : {
          kind: "failed",
          failure: classifyAssistantFailure(final),
          retryable: failedTransiently(final),
          unsent: requestUnsent(final),
          usage,
        };

  if (final.stopReason === "length" && stoppedShort(final, prepared.info.maxOutput))
    return { kind: "overflow", failure: buildContextOverflowFailure(final), usage };
  const message = final.stopReason === "length" ? failCutOffCalls(final) : final;

  return {
    kind: "done",
    message,
    calls: message.content.filter((block): block is ModelToolCall => block.type === "toolCall"),
    usage,
  };
}

function failCutOffCalls(message: AssistantMessage): AssistantMessage {
  return {
    ...message,
    content: message.content.map((block) =>
      block.type === "toolCall" ? { ...block, argumentsError: CUT_OFF } : block,
    ),
  };
}

function buildContextOverflowFailure(message: AssistantMessage): Failure {
  const failure = classifyAssistantFailure(message);

  return failure.class === "context_window"
    ? failure
    : { class: "context_window", message: "The response ran out of context." };
}
