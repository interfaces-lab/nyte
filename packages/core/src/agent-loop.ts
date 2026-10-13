import type { AssistantMessageEventStream } from "@nyte-ai/ai";
import { classifyAssistantFailure } from "@nyte-ai/ai/utils/failure";
import { isContextOverflow, isRecoverableLength } from "@nyte-ai/ai/utils/overflow";
import { abortableSleep, isRetryableAssistantError, retryDelayMs } from "@nyte-ai/ai/utils/retry";
import type { RetryPolicy } from "@nyte-ai/ai/utils/retry";
import type {
  Delivery,
  Json,
  MessageId,
  MessageSource,
  ModelInfo,
  ModelRequest,
  ToolOutcome,
  Usage,
} from "@nyte-ai/schema";
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  Context,
  Failure,
  Model,
} from "@nyte-ai/schema/model";

/** Returns what `prepareRequest` is asked for: the attempt, and the context overflow a retry follows, which the config must compact for. */
export interface LoopRequest {
  readonly attempt: number;
  readonly overflow: Failure | null;
}

/** Returns a prepared provider request: the `before_request` payload as the hooks left it, its model and catalog info, the provider context, when it was prepared, and what one response is charged. */
export interface PreparedRequest {
  readonly kind: "request";
  readonly request: ModelRequest;
  readonly model: Model<Api>;
  readonly info: ModelInfo;
  readonly context: Context;
  readonly at: number;
  usage(message: AssistantMessage): Usage;
}

/** Returns a prepared provider request, or why none can be sent. */
export type Prepared<P extends PreparedRequest = PreparedRequest> =
  | P
  | { readonly kind: "failed"; readonly failure: Failure };

/** Returns a request on its way: the response's events, and what settles once the config is done with the response's end. */
export interface LoopResponse {
  readonly events: AssistantMessageEventStream;
  readonly settled: Promise<void>;
}

export type ModelToolCall = Extract<
  AssistantMessage["content"][number],
  { readonly type: "toolCall" }
>;

export type ToolProgress = Json;

/** Returns how a tool call ended in the loop: its outcome, or parked until something wakes it. */
export type ToolResult = ToolOutcome | { readonly kind: "parked" };

/** Returns one input a boundary landed; a prompt, or a child's or job's report, asks for another request, and other attached context rides along unanswered. */
export interface LoopInput {
  readonly message: MessageId;
  readonly delivery: Delivery;
  readonly source: MessageSource;
}

/** Returns what the loop runs on, as plain functions. A function that throws rejects the stream. */
export interface LoopConfig<P extends PreparedRequest = PreparedRequest> {
  readonly attempt: number;
  readonly retry: RetryPolicy;
  prepareRequest(request: LoopRequest, signal: AbortSignal): Promise<Prepared<P>>;
  stream(prepared: P, signal: AbortSignal): Promise<LoopResponse>;
  readonly tools: {
    execute(
      call: ModelToolCall,
      signal: AbortSignal,
      onUpdate: (progress: ToolProgress) => void,
    ): Promise<ToolResult>;
  };
  /** Runs once a response is done, before its calls, with the request it answered. */
  finishTurn(
    turn: {
      readonly message: AssistantMessage;
      readonly calls: readonly ModelToolCall[];
      readonly usage: Usage;
      readonly prepared: P;
    },
    signal: AbortSignal,
  ): Promise<void>;
  /** Lands the inputs queued for this point and returns them. */
  boundary(signal: AbortSignal): Promise<readonly LoopInput[]>;
}

/** Returns a response that failed, with the request it answered: what the config charges and observes. */
export interface FailedResponse<P extends PreparedRequest = PreparedRequest> {
  readonly usage: Usage;
  readonly prepared: P;
}

/** Returns how a loop ended; a failed or stopped end carries the response it failed on or overflowed with, not yet charged, or null when none came. */
export type LoopEnd<P extends PreparedRequest = PreparedRequest> =
  | { readonly reason: "done"; readonly usage: Usage }
  | { readonly reason: "parked"; readonly usage: Usage }
  | { readonly reason: "stopped"; readonly response: FailedResponse<P> | null }
  | {
      readonly reason: "failed";
      readonly failure: Failure;
      readonly response: FailedResponse<P> | null;
    };

/** Returns one thing the loop did; `message_end` comes for a done response only, a failed one ends in `turn_retry` or `loop_end`. */
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
  | { readonly type: "tool_update"; readonly call: ModelToolCall; readonly progress: ToolProgress }
  | { readonly type: "tool_end"; readonly call: ModelToolCall; readonly result: ToolResult }
  | {
      readonly type: "turn_end";
      readonly message: AssistantMessage;
      readonly calls: readonly ModelToolCall[];
      readonly usage: Usage;
    }
  | { readonly type: "loop_end"; readonly end: LoopEnd<P> };

/** Returns the loop's events, each taken before the loop goes on, and how it ended once they are consumed. */
export interface LoopStream<P extends PreparedRequest = PreparedRequest> extends AsyncIterable<
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
  | { readonly kind: "stopped" };

const STOPPED = { reason: "stopped", response: null } as const;

const UNFINISHED: Failure = {
  class: "provider",
  message: "The response ended without a result.",
};

/**
 * Runs the agent loop: one provider request per turn until a response asks for nothing more, a
 * call parks, the signal aborts or a request fails. A retryable failure is retried after
 * `turn_retry` and the policy's delay; a context overflow is retried once with `overflow` set.
 */
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

/** Runs the turns, checking the signal only before preparing a request and before each call. */
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
        return yield* end(STOPPED);
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
      const result = yield* execute(config, call, signal);
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

/** Streams one prepared request and classifies how the response ended; an abort is the stream's own `aborted` end. */
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

  if (final.stopReason === "aborted") return { kind: "stopped" };
  const usage = prepared.usage(final);

  if (final.stopReason === "error")
    return isContextOverflow(final)
      ? { kind: "overflow", failure: overflowOf(final), usage }
      : {
          kind: "failed",
          failure: classifyAssistantFailure(final),
          retryable: isRetryableAssistantError(final),
          usage,
        };

  if (final.stopReason === "length" && isRecoverableLength(final, prepared.info.maxOutput))
    return { kind: "overflow", failure: overflowOf(final), usage };

  return {
    kind: "done",
    message: final,
    calls: final.content.filter((block): block is ModelToolCall => block.type === "toolCall"),
    usage,
  };
}

/** Runs one call, yielding its progress as it comes; the calls of a length stop run like any others. */
async function* execute<P extends PreparedRequest>(
  config: LoopConfig<P>,
  call: ModelToolCall,
  signal: AbortSignal,
): AsyncGenerator<LoopEvent<P>, ToolResult> {
  const progress: ToolProgress[] = [];
  let wake = (): void => {};

  const running = config.tools.execute(call, signal, (update) => {
    progress.push(update);
    wake();
  });

  for (;;) {
    const settled = await Promise.race([
      running.then((result) => ({ result })),
      new Promise<null>((resolve) => {
        wake = () => resolve(null);
      }),
    ]);

    for (const update of progress.splice(0)) yield { type: "tool_update", call, progress: update };

    if (settled !== null) return settled.result;
  }
}

async function* end<P extends PreparedRequest>(
  loopEnd: LoopEnd<P>,
): AsyncGenerator<LoopEvent<P>, LoopEnd<P>> {
  yield { type: "loop_end", end: loopEnd };

  return loopEnd;
}

/** Returns a context overflow's failure: the provider's when it classifies as one, else that the response ran out of context. */
function overflowOf(message: AssistantMessage): Failure {
  const failure = classifyAssistantFailure(message);

  return failure.class === "context_window"
    ? failure
    : { class: "context_window", message: "The response ran out of context." };
}
