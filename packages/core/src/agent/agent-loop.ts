import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Failure,
  Model,
} from "@nyte-ai/schema/model";
import type {
  Delivery,
  MessageId,
  MessageSource,
  ModelInfo,
  ModelRequest,
  ToolOutcome,
  Usage,
} from "@nyte-ai/schema";
import type { AssistantMessageEventStream } from "@nyte-ai/ai";
import { abortableSleep, isRetryableAssistantError, retryDelayMs } from "@nyte-ai/ai/utils/retry";
import type { RetryPolicy } from "@nyte-ai/ai/utils/retry";
import { isContextOverflow, isRecoverableLength } from "@nyte-ai/ai/utils/overflow";
import { classifyAssistantFailure } from "@nyte-ai/ai/utils/failure";

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

export interface LoopConfig<P extends PreparedRequest = PreparedRequest> {
  readonly attempt: number;
  readonly retry: RetryPolicy;
  prepareRequest(request: LoopRequest, signal: AbortSignal): Promise<Prepared<P>>;
  stream(prepared: P, signal: AbortSignal): Promise<LoopResponse>;
  readonly tools: {
    execute(call: ModelToolCall, signal: AbortSignal): Promise<ToolResult>;
  };

  finishTurn(
    turn: {
      readonly message: AssistantMessage;
      readonly calls: readonly ModelToolCall[];
      readonly usage: Usage;
      readonly prepared: P;
    },
    signal: AbortSignal,
  ): Promise<void>;

  boundary(signal: AbortSignal): Promise<readonly LoopInput[]>;
}

export interface FailedResponse<P extends PreparedRequest = PreparedRequest> {
  readonly usage: Usage;
  readonly prepared: P;
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

export type LoopEvent<P extends PreparedRequest = PreparedRequest> =
  | { readonly type: "turn_start"; readonly attempt: number }
  | {
      readonly type: "message_start";
      readonly kind: "text" | "thinking" | "toolCall";
      readonly index: number;
    }
  | { readonly type: "message_update"; readonly event: AssistantMessageEvent }
  | { readonly type: "message_end"; readonly message: AssistantMessage; readonly usage: Usage }
  | {
      readonly type: "turn_retry";
      readonly attempt: number;
      readonly until: number;
      readonly failure: Failure;
      readonly response: FailedResponse<P>;
    }
  | { readonly type: "tool_start"; readonly call: ModelToolCall }
  | { readonly type: "tool_end"; readonly call: ModelToolCall; readonly result: ToolResult }
  | {
      readonly type: "turn_end";
      readonly message: AssistantMessage;
      readonly calls: readonly ModelToolCall[];
      readonly usage: Usage;
    }
  | { readonly type: "loop_end"; readonly end: LoopEnd<P> };

interface LoopStream<P extends PreparedRequest = PreparedRequest> extends AsyncIterable<
  LoopEvent<P>
> {
  result(): Promise<LoopEnd<P>>;
}

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
      readonly usage: Usage;
    }
  | { readonly kind: "unfinished" }
  | { readonly kind: "stopped"; readonly usage: Usage };

const STOPPED = { reason: "stopped", response: null } as const;

const UNFINISHED: Failure = {
  class: "provider",
  message: "The response ended without a result.",
};

export function agentLoop<P extends PreparedRequest>(
  config: LoopConfig<P>,
  signal: AbortSignal,
): LoopStream<P> {
  const events = run(config, signal);
  const ended = Promise.withResolvers<LoopEnd<P>>();
  ended.promise.catch(() => undefined);

  return {
    async *[Symbol.asyncIterator]() {
      try {
        ended.resolve(yield* events);
      } catch (error) {
        ended.reject(error);

        throw error;
      }
    },
    result: () => ended.promise,
  };
}

async function* run<P extends PreparedRequest>(
  config: LoopConfig<P>,
  signal: AbortSignal,
): AsyncGenerator<LoopEvent<P>, LoopEnd<P>> {
  let attempt = config.attempt;
  let retries = 0;
  let overflowed = false;

  let overflow: { readonly failure: Failure; readonly response: FailedResponse<P> } | null = null;

  for (;;) {
    const next = overflow === null ? attempt : attempt + 1;
    yield { type: "turn_start", attempt: next };

    if (signal.aborted)
      return yield* end({ reason: "stopped", response: overflow?.response ?? null });

    const prepared = await config.prepareRequest(
      { attempt: next, overflow: overflow?.failure ?? null },
      signal,
    );

    if (prepared.kind === "failed")
      return yield* end({
        reason: "failed",
        failure: prepared.failure,
        response: overflow?.response ?? null,
      });

    if (overflow !== null) {
      attempt = next;
      yield { type: "turn_retry", attempt, until: Date.now(), ...overflow };
      overflow = null;
    }

    const outcome = yield* respond(config, prepared, signal);

    switch (outcome.kind) {
      case "stopped":
        return yield* end({ reason: "stopped", response: { usage: outcome.usage, prepared } });
      case "unfinished":
        return yield* end({ reason: "failed", failure: UNFINISHED, response: null });
      case "failed": {
        const { failure } = outcome;
        const response = { usage: outcome.usage, prepared };

        if (!outcome.retryable || retries >= config.retry.maxRetries)
          return yield* end({ reason: "failed", failure, response });
        retries += 1;
        attempt += 1;
        const until = Date.now() + retryDelayMs(config.retry, retries);
        yield { type: "turn_retry", attempt, until, failure, response };

        const slept = await abortableSleep(until - Date.now(), signal).then(
          () => true,
          () => false,
        );

        if (!slept) return yield* end(STOPPED);
        continue;
      }

      case "overflow":
        overflow = { failure: outcome.failure, response: { usage: outcome.usage, prepared } };

        if (overflowed) return yield* end({ reason: "failed", ...overflow });
        overflowed = true;
        continue;
      case "done":
        break;
    }

    retries = 0;
    overflowed = false;
    const { message, calls, usage } = outcome;
    yield { type: "message_end", message, usage };
    await config.finishTurn({ message, calls, usage, prepared }, signal);
    let parked = false;

    for (const call of calls) {
      if (signal.aborted) return yield* end(STOPPED);
      yield { type: "tool_start", call };
      const result = await config.tools.execute(call, signal);
      yield { type: "tool_end", call, result };

      if (result.kind === "parked") parked = true;
    }

    yield { type: "turn_end", message, calls, usage };

    if (parked) return yield* end({ reason: "parked", usage });
    const landed = await config.boundary(signal);

    const asked = landed.some(
      (input) =>
        input.delivery !== "attach" || input.source.kind === "child" || input.source.kind === "job",
    );

    if (calls.length === 0 && !asked) return yield* end({ reason: "done", usage });
  }
}

async function* respond<P extends PreparedRequest>(
  config: LoopConfig<P>,
  prepared: P,
  signal: AbortSignal,
): AsyncGenerator<LoopEvent<P>, Outcome> {
  const response = await config.stream(prepared, signal);
  let final: AssistantMessage | null = null;

  for await (const event of response.events) {
    switch (event.type) {
      case "start":
        break;
      case "text_start":
        yield { type: "message_start", kind: "text", index: event.contentIndex };
        break;
      case "thinking_start":
        yield { type: "message_start", kind: "thinking", index: event.contentIndex };
        break;
      case "toolcall_start":
        yield { type: "message_start", kind: "toolCall", index: event.contentIndex };
        break;
      case "done":
        final = event.message;
        break;
      case "error":
        final = event.error;
        break;
      default:
        yield { type: "message_update", event };
    }
  }

  if (final === null) return { kind: "unfinished" };
  await response.settled;

  const usage = prepared.usage(final);

  if (final.stopReason === "aborted") return { kind: "stopped", usage };

  if (final.stopReason === "error")
    return isContextOverflow(final)
      ? { kind: "overflow", failure: buildContextOverflowFailure(final), usage }
      : {
          kind: "failed",
          failure: classifyAssistantFailure(final),
          retryable: isRetryableAssistantError(final),
          usage,
        };

  if (final.stopReason === "length" && isRecoverableLength(final, prepared.info.maxOutput))
    return { kind: "overflow", failure: buildContextOverflowFailure(final), usage };

  return {
    kind: "done",
    message: final,
    calls: final.content.filter((block): block is ModelToolCall => block.type === "toolCall"),
    usage,
  };
}

async function* end<P extends PreparedRequest>(
  loopEnd: LoopEnd<P>,
): AsyncGenerator<LoopEvent<P>, LoopEnd<P>> {
  yield { type: "loop_end", end: loopEnd };

  return loopEnd;
}

function buildContextOverflowFailure(message: AssistantMessage): Failure {
  const failure = classifyAssistantFailure(message);

  return failure.class === "context_window"
    ? failure
    : { class: "context_window", message: "The response ran out of context." };
}
