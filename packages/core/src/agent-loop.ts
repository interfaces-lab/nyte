import type { AssistantMessageEventStream } from "@nyte-ai/ai";
import { classifyAssistantFailure } from "@nyte-ai/ai/utils/failure";
import { isContextOverflow, isRecoverableLength } from "@nyte-ai/ai/utils/overflow";
import { abortableSleep, isRetryableAssistantError, retryDelayMs } from "@nyte-ai/ai/utils/retry";
import type { RetryPolicy } from "@nyte-ai/ai/utils/retry";
import type {
  Delivery,
  Json,
  MessageId,
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

/**
 * Returns what `prepareRequest` is asked for, once per provider request: the attempt the request
 * is, and the context overflow a retry follows (null otherwise), which the config must compact for.
 * The loop owns no messages and no configuration; the config builds every request.
 */
export interface LoopRequest {
  readonly attempt: number;
  readonly overflow: Failure | null;
}

/**
 * Returns a prepared provider request: the `before_request` payload as the hooks left it, the model
 * it goes to with its catalog info (whose `maxOutput` a length stop is measured against), the
 * provider context it sends, when it was prepared, and what one response is charged.
 */
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
export type Prepared = PreparedRequest | { readonly kind: "failed"; readonly failure: Failure };

/**
 * Returns a request on its way: the response's events, unconsumed, and what settles once the
 * config is done with the response's end (core moves the catalog generation there). The loop awaits
 * `settled` before it classifies the end.
 */
export interface LoopResponse {
  readonly events: AssistantMessageEventStream;
  readonly settled: Promise<void>;
}

/** Returns one tool call as the provider streamed it. */
export type ModelToolCall = Extract<
  AssistantMessage["content"][number],
  { readonly type: "toolCall" }
>;

/** Returns one progress report a tool sends while it runs. */
export type ToolProgress = Json;

/** Returns how a tool call ended in the loop: its outcome, or parked until something wakes it. */
export type ToolResult = ToolOutcome | { readonly kind: "parked" };

/** Returns one input a boundary landed: its message and how it was delivered; only a non-attach one asks for another request. */
export interface LoopInput {
  readonly message: MessageId;
  readonly delivery: Delivery;
}

/** Returns a turn's decision from `finishTurn`: end the loop after this turn's calls, ask for another request, or leave it to the calls and the boundary. */
export type TurnDecision = "end" | "continue" | undefined;

/** Returns what the loop runs on, as plain functions. A function that throws rejects the stream. */
export interface LoopConfig {
  /** The attempt the first request is. */
  readonly attempt: number;
  /** How a retryable failure is retried: at most `maxRetries` per request, `retryDelayMs` apart. */
  readonly retry: RetryPolicy;
  /** Builds the next provider request: context, compaction (always when `overflow` is set), `before_request`. */
  prepareRequest(request: LoopRequest, signal: AbortSignal): Promise<Prepared>;
  /** Sends a prepared request and returns it on its way. */
  stream(prepared: PreparedRequest, signal: AbortSignal): Promise<LoopResponse>;
  readonly tools: {
    /** Runs one call until it settles or parks. */
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
      readonly prepared: PreparedRequest;
    },
    signal: AbortSignal,
  ): Promise<TurnDecision>;
  /** Lands the inputs queued for this point and returns them. */
  boundary(signal: AbortSignal): Promise<readonly LoopInput[]>;
}

/** Returns how a loop ended: `done` and `parked` with the usage of the response that ended it, `stopped` when its signal aborted, `failed` with why. */
export type LoopEnd =
  | { readonly reason: "done"; readonly usage: Usage }
  | { readonly reason: "parked"; readonly usage: Usage }
  | { readonly reason: "stopped" }
  | { readonly reason: "failed"; readonly failure: Failure };

/**
 * Returns one thing the loop did. `message_start` opens a content block, `message_update` carries
 * every other provider event of the response but its end, and `message_end` comes for a done
 * response only; a failed one ends in `turn_retry` or `loop_end`.
 */
export type LoopEvent =
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
      readonly usage: Usage;
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
  | { readonly type: "loop_end"; readonly end: LoopEnd };

/** Returns the loop's events, each taken before the loop goes on, and how it ended once they are consumed. */
export interface LoopStream extends AsyncIterable<LoopEvent> {
  result(): Promise<LoopEnd>;
}

/** Returns how one response ended. */
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
  | { readonly kind: "stopped" };

const STOPPED: LoopEnd = { reason: "stopped" };

/**
 * Runs the agent loop: one provider request per turn until a response asks for nothing more, a
 * call parks, the signal aborts or a request fails. A retryable failure is retried after
 * `turn_retry` and the policy's delay; a context overflow is retried once with `overflow` set.
 * A done response goes to `finishTurn`, then its calls run one at a time until each settles or
 * parks. Without calls the loop goes on only when the boundary landed an input that is not an
 * attach, or `finishTurn` said `continue`. Events are pulled: the loop waits for each to be taken.
 */
export function agentLoop(config: LoopConfig, signal: AbortSignal): LoopStream {
  const events = run(config, signal);
  const ended = Promise.withResolvers<LoopEnd>();
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

/** Runs the turns, checking the signal only before preparing a request and before each call; every other step sees the abort through what it awaits (§45g). */
async function* run(config: LoopConfig, signal: AbortSignal): AsyncGenerator<LoopEvent, LoopEnd> {
  let attempt = config.attempt;
  let retries = 0;
  let overflowed = false;
  let overflow: { readonly failure: Failure; readonly usage: Usage } | null = null;

  for (;;) {
    const next = overflow === null ? attempt : attempt + 1;
    yield { type: "turn_start", attempt: next };

    if (signal.aborted) return yield* end(STOPPED);

    const prepared = await config.prepareRequest(
      { attempt: next, overflow: overflow?.failure ?? null },
      signal,
    );

    if (prepared.kind === "failed")
      return yield* end({ reason: "failed", failure: prepared.failure });

    if (overflow !== null) {
      attempt = next;
      yield { type: "turn_retry", attempt, until: Date.now(), ...overflow };
      overflow = null;
    }

    const outcome = yield* respond(config, prepared, signal);

    switch (outcome.kind) {
      case "stopped":
        return yield* end(STOPPED);
      case "failed": {
        if (!outcome.retryable || retries >= config.retry.maxRetries)
          return yield* end({ reason: "failed", failure: outcome.failure });
        retries += 1;
        attempt += 1;
        const until = Date.now() + retryDelayMs(config.retry, retries);
        yield {
          type: "turn_retry",
          attempt,
          until,
          failure: outcome.failure,
          usage: outcome.usage,
        };

        const slept = await abortableSleep(until - Date.now(), signal).then(
          () => true,
          () => false,
        );

        if (!slept) return yield* end(STOPPED);
        continue;
      }

      case "overflow":
        if (overflowed) return yield* end({ reason: "failed", failure: outcome.failure });
        overflowed = true;
        overflow = { failure: outcome.failure, usage: outcome.usage };
        continue;
      case "done":
        break;
    }

    retries = 0;
    overflowed = false;
    const { message, calls, usage } = outcome;
    yield { type: "message_end", message, usage };
    const decision = await config.finishTurn({ message, calls, usage, prepared }, signal);
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

    if (decision === "end") return yield* end({ reason: "done", usage });
    const landed = await config.boundary(signal);

    if (
      calls.length === 0 &&
      decision !== "continue" &&
      landed.every((input) => input.delivery === "attach")
    )
      return yield* end({ reason: "done", usage });
  }
}

/** Streams one prepared request: an event per block start and per update, and how the response ended, classified; an abort is the stream's own `aborted` end. */
async function* respond(
  config: LoopConfig,
  prepared: PreparedRequest,
  signal: AbortSignal,
): AsyncGenerator<LoopEvent, Outcome> {
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

  if (final === null) return { kind: "stopped" };
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

/**
 * Runs one call, yielding its progress as it comes, and returns how it ended. The calls of a length
 * stop run like any others: core never failed a truncated response's calls as a batch, as pi does.
 */
async function* execute(
  config: LoopConfig,
  call: ModelToolCall,
  signal: AbortSignal,
): AsyncGenerator<LoopEvent, ToolResult> {
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

/** Yields `loop_end` and returns the end. */
async function* end(loopEnd: LoopEnd): AsyncGenerator<LoopEvent, LoopEnd> {
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
