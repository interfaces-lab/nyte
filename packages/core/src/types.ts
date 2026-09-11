/**
 * Public agent-loop contracts.
 *
 * Based on https://github.com/earendil-works/pi/blob/dev/packages/agent/src/types.ts
 * Synced with pi d4edf066f.
 */
import type {
  Api,
  AssistantMessage,
  AssistantMessageEvent,
  AssistantMessageEventStream,
  CacheRetention,
  Context,
  ImageContent,
  ProviderCheckpointMaterial,
  Message,
  Model,
  ModelThinkingLevel,
  SimpleStreamOptions,
  TextContent,
  Tool,
  ToolResultMessage,
  Transport,
  Usage,
} from "@nyte-ai/ai";
import { MODEL_THINKING_LEVELS } from "@nyte-ai/schema";
import type { JsonValue } from "@nyte-ai/schema";
import type { Selection } from "@nyte-ai/protocol";
import type { JsonObject } from "./kernel/json.ts";
import type { Static, TSchema } from "typebox";

/**
 * Stream function used by the agent loop. `Models.streamSimple` satisfies
 * this contract.
 *
 * Contract:
 * - Must not throw or return a rejected promise for request/model/runtime failures.
 * - Must return an AssistantMessageEventStream.
 * - Failures must be encoded in the returned stream via protocol events and a
 *   final AssistantMessage with stopReason "error" or "aborted" and errorMessage.
 */
export type StreamFn = (
  model: Model<Api>,
  context: Context,
  options?: SimpleStreamOptions,
) => AssistantMessageEventStream | Promise<AssistantMessageEventStream>;

/**
 * Provider request options snapshotted per turn and available to
 * `before_request` hooks.
 *
 * Based on https://github.com/earendil-works/pi/blob/dev/packages/agent/src/harness/types.ts
 * Synced with pi 7ebf9087e.
 */
type SamplingParams = NonNullable<SimpleStreamOptions["samplingParams"]>;

export interface StreamOptions {
  /** Maximum provider retry attempts. */
  maxRetries?: number;
  /** Optional cap for provider-requested retry delays. */
  maxRetryDelayMs?: number;
  /** Preferred transport for providers that support more than one. */
  transport?: Transport;
  /** Prompt cache retention preference. */
  cacheRetention?: CacheRetention;
  /** Request the selected model's advertised fast inference mode. */
  fast?: boolean;
  temperature?: number;
  maxTokens?: number;
  /** Additional request headers merged with auth and lifecycle headers. */
  headers?: Record<string, string>;
  /** Sampling parameters merged into OpenAI-compatible request bodies. */
  samplingParams?: SamplingParams;
}

/** Per-request stream option patch returned by provider hooks. */
export interface StreamOptionsPatch extends Omit<
  Partial<StreamOptions>,
  "headers" | "samplingParams"
> {
  /** Header patch. `undefined` values delete keys; an undefined field clears all headers. */
  headers?: Record<string, string | undefined> | undefined;
  /** Sampling patch. `undefined` values delete keys; an undefined field clears all parameters. */
  samplingParams?: SamplingParams | undefined;
}

/**
 * Controls how many queued user messages are injected when the agent loop reaches a queue drain point.
 *
 * - "all": drain and inject every queued message at that point.
 * - "one-at-a-time": drain and inject only the oldest queued message, leaving the rest queued for later drain points.
 */

/** A single tool call content block emitted by an assistant message. */
export type AgentToolCall = Extract<AssistantMessage["content"][number], { type: "toolCall" }>;

/**
 * Result returned from `beforeToolCall`.
 *
 * Returning `{ block: true }` prevents the tool from executing. The loop emits an error tool result instead.
 * `reason` becomes the text shown in that error result. If omitted, a default blocked message is used.
 */
export interface BeforeToolCallResult {
  block?: boolean;
  reason?: string;
  /**
   * Replacement arguments. The loop validates them against the tool's schema
   * before the tool runs, exactly as it validated the model's proposal.
   */
  args?: JsonObject;
}

/**
 * Partial override returned from `afterToolCall`.
 *
 * Merge semantics are field-by-field:
 * - `content`: if provided, replaces the tool result content array in full
 * - `details`: if provided, replaces the tool result details value in full
 * - `isError`: if provided, replaces the tool result error flag
 * - `usage`: if provided, replaces the tool result usage
 *
 * Omitted fields keep the original executed tool result values.
 * There is no deep merge for `content`, `details`, or `usage`.
 */
export interface AfterToolCallResult {
  content?: (TextContent | ImageContent)[];
  details?: unknown;
  isError?: boolean;
  /** Usage from the final tool execution itself, if available. Not used for main LLM context accounting. */
  usage?: Usage;
}

/** Context passed to `beforeToolCall`. */
export interface BeforeToolCallContext {
  /** The assistant message that requested the tool call. */
  assistantMessage: AssistantMessage;
  /** The raw tool call block from `assistantMessage.content`. */
  toolCall: AgentToolCall;
  /** Validated tool arguments for the target tool schema. */
  args: unknown;
  /** Current agent context at the time the tool call is prepared. */
  context: AgentContext;
}

/** Context passed to `afterToolCall`. */
export interface AfterToolCallContext {
  /** The assistant message that requested the tool call. */
  assistantMessage: AssistantMessage;
  /** The raw tool call block from `assistantMessage.content`. */
  toolCall: AgentToolCall;
  /** Validated tool arguments for the target tool schema. */
  args: unknown;
  /** The executed tool result before any `afterToolCall` overrides are applied. */
  result: AgentToolResult<unknown>;
  /** Whether the executed tool result is currently treated as an error. */
  isError: boolean;
  /** Current agent context at the time the tool call is finalized. */
  context: AgentContext;
}

export interface AgentLoopConfig extends SimpleStreamOptions {
  model: Model<Api>;

  /**
   * Optional transform applied to the context before the request.
   *
   * Use this for operations that work on the whole message list:
   * - Context window management (pruning old messages)
   * - Injecting context from external sources
   *
   * Contract: must not throw or reject. Return the original messages or another
   * safe fallback value instead.
   *
   * @example
   * ```typescript
   * transformContext: async (messages) => {
   *   if (estimateTokens(messages) > MAX_TOKENS) {
   *     return pruneOldMessages(messages);
   *   }
   *   return messages;
   * }
   * ```
   */
  transformContext?: (messages: Message[], signal?: AbortSignal) => Promise<Message[]>;

  /**
   * Called before a tool is executed, after arguments have been validated.
   *
   * Return `{ block: true }` to prevent execution. The loop emits an error tool result instead.
   * The hook receives the agent abort signal and is responsible for honoring it.
   */
  beforeToolCall?: (
    context: BeforeToolCallContext,
    signal?: AbortSignal,
  ) => Promise<BeforeToolCallResult | undefined>;

  /**
   * Called after a tool finishes executing, before `tool_execution_end` and tool-result message events are emitted.
   *
   * Return an `AfterToolCallResult` to override parts of the executed tool result:
   * - `content` replaces the full content array
   * - `details` replaces the full details payload
   * - `isError` replaces the error flag
   * - `usage` replaces the tool result usage
   *
   * Any omitted fields keep their original values. No deep merge is performed.
   * The hook receives the agent abort signal and is responsible for honoring it.
   */
  afterToolCall?: (
    context: AfterToolCallContext,
    signal?: AbortSignal,
  ) => Promise<AfterToolCallResult | undefined>;
}

/**
 * Thinking/reasoning level for models that support it, including "off".
 * Derived from @nyte-ai/schema's MODEL_THINKING_LEVELS tuple — the
 * ordered runtime list and both unions live there, not here.
 * Note: "xhigh" and "max" are only supported by selected model families. Use model
 * thinking-level metadata from @earendil-works/pi-ai to detect support for a concrete model.
 */
export type ThinkingLevel = ModelThinkingLevel;

/** Whether a stored string is a thinking level this build knows. */
export function isThinkingLevel(value: string): value is ThinkingLevel {
  return MODEL_THINKING_LEVELS.some((level) => level === value);
}

/** Final or partial result produced by a tool. */
export interface AgentToolResult<T> {
  /** Text or image content returned to the model. */
  content: (TextContent | ImageContent)[];
  /** Arbitrary structured details for logs or UI rendering. */
  details: T;
  /** Heading the tool chose for this call, e.g. the path it read. Clients fall back to the tool name. */
  title?: string;
  /** Usage from the final tool execution itself, if available. Not used for main LLM context accounting. */
  usage?: Usage;
  /** Names of tools introduced by this result and available from this transcript point onward. */
  addedToolNames?: string[];
}

/**
 * Callback used by tools to stream partial execution updates.
 *
 * The callback is scoped to the current `execute()` invocation. Calls made after
 * the tool promise settles are ignored.
 */
export type AgentToolUpdateCallback<T = unknown> = (partialResult: AgentToolResult<T>) => void;

// ---------------------------------------------------------------------------
// Durable tool wait (design record: "Wait and wake")
// ---------------------------------------------------------------------------

/**
 * Thrown by a tool's `execute` to park the call: the runner moves the effect
 * ref to `waiting`, releases the head, and the run stops consuming any process
 * anywhere. A reply arrives through `runs.reply`; whichever host next acquires
 * the head settles the call through the tool's `wake` handler.
 *
 * The wait carries no state for the wake. Everything a wake needs is already
 * durable and typed: the intent's schema-validated arguments, the run and
 * call ids, and ids derived from them. What it may carry is a `selection`: what
 * a participant is asked to pick, stored with the waiting effect so any
 * client, on any host, at any later time, can render it and answer it without
 * knowing the tool. A wait without one is background work, not a request for
 * input. It may also carry `until`, an epoch-ms deadline: a runner that steps
 * the run past it wakes the call with `expired` set, so a human who never
 * answers does not hold the run forever. Like a retry's `at`, the deadline is
 * durable state, never a timer in a process.
 */
const TOOL_WAIT_BRAND = Symbol.for("nyte.toolWait");

export interface ToolWaitOptions {
  readonly selection?: Selection;
  readonly until?: number;
}

export class ToolWait {
  /** Shared-symbol brand: `instanceof` fails across duplicated bundles. */
  readonly [TOOL_WAIT_BRAND] = true;
  readonly selection: Selection | undefined;
  readonly until: number | undefined;

  constructor(options: ToolWaitOptions = {}) {
    this.selection = options.selection;
    this.until = options.until;
  }
}

export function isToolWait(error: unknown): error is ToolWait {
  return (
    typeof error === "object" &&
    error !== null &&
    TOOL_WAIT_BRAND in error &&
    error[TOOL_WAIT_BRAND] === true
  );
}

/**
 * One waiting call, as the runner hands it to the tool's `wake` handler.
 * `args` are the intent's effective arguments, schema-validated before the
 * intent committed; the tool re-derives its typed view through the same parse
 * `execute` used.
 */
export interface WaitingCall {
  readonly runId: string;
  readonly toolCallId: string;
  readonly resultEntryId: string;
  readonly args: JsonValue;
}

export interface ToolWakeContext {
  readonly signal: AbortSignal;
  /**
   * A durable abort request holds for this run. The handler should settle
   * (its own abort settlement may say more than the generic one); a `wait`
   * outcome is overridden by a generic aborted settlement, because a wait
   * must not outlive an abort.
   */
  readonly aborted: boolean;
  /** The wait's `until` passed with no reply. The handler should settle; a `wait` parks again. */
  readonly expired: boolean;
  /**
   * The first durable reply recorded for this call (`runs.reply`), if any.
   * Queued conversation messages are never offered to a wake handler.
   */
  readonly reply?: JsonValue;
}

export type ToolWakeOutcome =
  | { kind: "settle"; result: AgentToolResult<unknown>; isError?: boolean }
  /** Park again, with what the new wait asks and when it expires, as `ToolWait` takes them. */
  | ({ kind: "wait" } & ToolWaitOptions);

/**
 * Settle a waiting call on wake, or keep waiting. Runs on whichever host
 * claims the run after wake input arrives, so it derives everything from
 * `wait` and durable state; it holds no memory of the process that
 * waiting. It must not write anything before deciding to settle: a `wait`
 * outcome may be invoked again.
 */
export type ToolWake = (wait: WaitingCall, context: ToolWakeContext) => Promise<ToolWakeOutcome>;

/** The durable run and head executing a tool call. */
export interface ToolExecutionContext {
  readonly runId: string;
  readonly head: string;
}

/** Tool definition used by the agent runtime. */
export interface AgentTool<
  TParameters extends TSchema = TSchema,
  TDetails = unknown,
> extends Tool<TParameters> {
  /**
   * Optional compatibility shim for raw tool-call arguments before schema validation.
   * The returned value is validated against `TParameters` before execution.
   */
  prepareArguments?: (args: AgentToolCall["arguments"]) => unknown;
  /** Execute the tool call. Throw on failure instead of encoding errors in `content`. */
  execute: (
    toolCallId: string,
    // An erased schema cannot prove an input type. Bind typed definitions before storage.
    params: TSchema extends TParameters ? unknown : Static<TParameters>,
    signal?: AbortSignal,
    onUpdate?: AgentToolUpdateCallback<TDetails>,
    context?: ToolExecutionContext,
  ) => Promise<AgentToolResult<TDetails>>;
  /** Available only while the session is foreground work with a participant present. */
  availability?: "foreground";
  /** Recovery policy for an effect whose durable intent exists but whose outcome is unknown. */
  replay?: "never" | "safe";
  /** Settles this tool's waiting calls on wake (design record: "Wait and wake"). */
  wake?: ToolWake;
  /**
   * One line for the system prompt's Available-tools list. A tool without one
   * is still callable; it just goes unmentioned in the prompt (pi's rule).
   */
  promptSnippet?: string;
  /** Guideline bullets this tool contributes to the system prompt's Guidelines section. */
  promptGuidelines?: readonly string[];
}

/** Context snapshot passed into the low-level agent loop. */
export interface AgentContext {
  /** System prompt included with the request. */
  systemPrompt: string;
  /** Provider-native replacement for the history before `messages`. */
  checkpoint?: ProviderCheckpointMaterial;
  /** Transcript visible to the model after the checkpoint, if any. */
  messages: Message[];
  /** Tools available for this run. */
  tools?: AgentTool[];
}

/**
 * Events one turn emits. The runner settles them into the log; run boundaries
 * are the durable operation records.
 */
export type AgentEvent =
  // Turn lifecycle - a turn is one assistant response + any tool calls/results
  | { type: "turn_start" }
  | { type: "turn_end"; message: Message; toolResults: ToolResultMessage[] }
  // Message lifecycle - emitted for user, assistant, and toolResult messages
  | { type: "message_start"; message: Message }
  // Only emitted for assistant messages during streaming
  | { type: "message_update"; message: Message; assistantMessageEvent: AssistantMessageEvent }
  | { type: "message_end"; message: Message }
  // Tool execution lifecycle
  | { type: "tool_execution_start"; toolCallId: string; toolName: string; args: unknown }
  | {
      type: "tool_execution_update";
      toolCallId: string;
      toolName: string;
      args: unknown;
      partialResult: unknown;
    }
  | {
      type: "tool_execution_end";
      toolCallId: string;
      toolName: string;
      result: AgentToolResult<unknown>;
      isError: boolean;
    };
