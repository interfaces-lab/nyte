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
  Usage,
} from "@nyte-ai/ai";
import { MODEL_THINKING_LEVELS } from "@nyte-ai/schema";
import type { JsonValue } from "@nyte-ai/schema";
import type { Selection, ToolClass, ToolOutcome, ToolReason } from "@nyte-ai/protocol";
import type { JsonObject } from "@nyte-ai/client";
import { Type } from "typebox";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import type { ExecutionEnv } from "./env.ts";

/**
 * Stream function used by the agent loop. `Models.streamSimple` satisfies
 * this contract.
 *
 * The loop passes a normalized transcript: the system prompt and tool
 * declarations are carried by the transcript's system messages, never by
 * `context.systemPrompt` or `context.tools`.
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
 * `cause` is the typed reason that result settles with: `denied` for a policy objection. Default `error`.
 * The result's text names the cause, then `reason` when given.
 */
export interface BeforeToolCallResult {
  block?: boolean;
  reason?: string;
  cause?: ToolReason;
  /**
   * Replacement arguments. The loop validates them against the tool's schema
   * before the tool runs, exactly as it validated the model's proposal.
   */
  args?: JsonObject;
}

/**
 * Partial override returned from `afterToolCall`. A field present replaces the
 * executed result's in full; `outcome` replaces how the call settled. Omitted
 * fields keep their values. Nothing is deep-merged.
 */
export type AfterToolCallResult = Partial<
  Pick<AgentToolResult<unknown>, "content" | "details" | "structuredContent" | "usage">
> & { readonly outcome?: ToolOutcome };

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

/** Context passed to `afterToolCall`: the executed outcome before any overrides. */
export type AfterToolCallContext = BeforeToolCallContext & ToolCallOutcome;

/** A call ready to run: its executor, and the arguments the result hooks see. */
export interface ReadyToolCall {
  readonly args: unknown;
  execute(
    this: void,
    signal: AbortSignal | undefined,
    onUpdate: AgentToolUpdateCallback,
  ): Promise<AgentToolResult<unknown>>;
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
   * Answers a call the host decides for itself, before the loop looks its tool
   * up, validates its arguments, or asks the policy: one the host already
   * recorded, or one it will not start. Undefined leaves the call to the loop.
   */
  recoverToolCall?: (toolCall: AgentToolCall) => Promise<ReadyToolCall | undefined>;

  /**
   * Called after a tool finishes executing, before `tool_execution_end` and tool-result message events are emitted.
   *
   * Return an `AfterToolCallResult` to override parts of the executed tool result:
   * - `content` replaces the full content array
   * - `details` replaces the full details payload
   * - `structuredContent` replaces the structured content
   * - `usage` replaces the tool result usage
   * - `outcome` replaces how the call settled
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
  structuredContent?: JsonValue;
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

/** How a tool call settled: the wire outcome with its typed reason, and the result it carries. */
export type ToolCallOutcome<TDetails = unknown> = ToolOutcome & {
  readonly result: AgentToolResult<TDetails>;
};

// ---------------------------------------------------------------------------
// Durable tool wait (Core guide: "Tools")
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
 *
 * A plugin's wait names at least one of the two, so every parked call can
 * end: someone can answer it, or the runner expires it. Only the kernel parks
 * with neither, for work it wakes itself (`backgroundWait`).
 */
const TOOL_WAIT_BRAND = Symbol.for("nyte.toolWait");

export type ToolWaitOptions =
  | { readonly selection: Selection; readonly until?: number }
  | { readonly selection?: Selection; readonly until: number };

const BACKGROUND_WAIT: unique symbol = Symbol("nyte.toolWait.background");

/** Kernel-only: a wait with nothing to ask and no deadline, woken by the runner itself. */
export interface BackgroundWait {
  readonly [BACKGROUND_WAIT]: true;
}

export const backgroundWait: BackgroundWait = { [BACKGROUND_WAIT]: true };

type WaitOptions = ToolWaitOptions | BackgroundWait;

/** The selection and deadline a wait parks with; none for a background wait. */
export function waitTerms(options: WaitOptions) {
  if (BACKGROUND_WAIT in options) return { selection: undefined, until: undefined };

  return { selection: options.selection, until: options.until };
}

export class ToolWait {
  /** Shared-symbol brand: `instanceof` fails across duplicated bundles. */
  readonly [TOOL_WAIT_BRAND] = true;
  readonly selection: Selection | undefined;
  readonly until: number | undefined;

  constructor(options: WaitOptions) {
    const terms = waitTerms(options);
    this.selection = terms.selection;
    this.until = terms.until;
  }
}

export function isToolWait(error: unknown): error is ToolWait {
  return (
    Value.Check(Type.Object({}), error) &&
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
  readonly head: string;
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

/**
 * Settle the call as `success` or `error`, or park again with `wait`, carrying
 * what the new wait asks and when it expires, as `ToolWait` takes them.
 */
export type ToolWakeOutcome = ToolCallOutcome | ({ readonly kind: "wait" } & WaitOptions);

/**
 * Settle a waiting call on wake, or keep waiting. Runs on whichever host
 * claims the run after wake input arrives, so it derives everything from
 * `wait` and durable state; it holds no memory of the process that
 * waiting. It must not write anything before deciding to settle: a `wait`
 * outcome may be invoked again.
 */
export type ToolWake = (wait: WaitingCall, context: ToolWakeContext) => Promise<ToolWakeOutcome>;

/** The durable run executing a call: its identity, its transcript so far, and the tools it may call. */
export interface ToolRun {
  readonly id: string;
  readonly head: string;
  /** The call that invoked this one through `tools.execute`. */
  readonly parentToolCallId?: string;
  history(this: void): Promise<readonly Message[]>;
  readonly tools: {
    list(): readonly ExecutableTool[];
    execute(
      name: string,
      args: unknown,
      options?: { signal?: AbortSignal; onUpdate?: AgentToolUpdateCallback },
    ): Promise<ToolCallOutcome>;
    /** Bring deferred or codemode tools into the model's declared set from the next request on. */
    activate(names: readonly string[]): void;
  };
}

/**
 * One call of a tool, as the runtime hands it to `execute` beside the parsed
 * input. `run` is absent in the bare loop, which executes tools outside any
 * run, and for a job, which outlives the call that started it.
 */
export interface ToolCall<TDetails = unknown> {
  readonly id: string;
  readonly signal: AbortSignal;
  /** Stream a partial result. A call made after `execute` settles is ignored. */
  update(this: void, partial: AgentToolResult<TDetails>): void;
  readonly run?: ToolRun;
}

/** A call as a session's tool receives it: the call, and where it acts. */
export interface ToolContext<TDetails = unknown> extends ToolCall<TDetails> {
  readonly env: ExecutionEnv;
}

/** The call `present` classifies: the run and head that committed it, and its call id. */
export interface ToolPresentContext {
  readonly runId: string;
  readonly head: string;
  readonly callId: string;
}

/**
 * Tool definition used by the agent runtime. A session's tools take a
 * `ToolContext`; the session binds its environment before the loop runs them.
 */
export interface AgentTool<
  TParameters extends TSchema = TSchema,
  TDetails = unknown,
  TCall extends ToolCall<TDetails> = ToolContext<TDetails>,
> extends Tool<TParameters> {
  exposure?: "direct" | "codemode" | "deferred" | "model-only" | "hidden";
  namespace?: { name: string; description?: string; instructions?: string };
  outputSchema?: TSchema;
  /**
   * Optional compatibility shim for raw tool-call arguments before schema validation.
   * The returned value is validated against `TParameters` before execution.
   */
  prepareArguments?: (args: AgentToolCall["arguments"]) => AgentToolCall["arguments"];
  /** Execute the tool call. Throw on failure instead of encoding errors in `content`. */
  execute: (
    // An erased schema cannot prove an input type. Bind typed definitions before storage.
    input: TSchema extends TParameters ? unknown : Static<TParameters>,
    call: TCall,
  ) => Promise<AgentToolResult<TDetails>>;
  /** Available only while the session is foreground work with a participant present. */
  availability?: "foreground";
  /**
   * What this call is, for the record. Called with the parsed args and the
   * call's identity when the call is committed, and again with the result
   * when it settles, whatever the outcome.
   * A method, so its parameters are bivariant: a typed tool still erases to
   * `AgentTool` for the registry, which hands it back its own result.
   */
  present?(
    this: void,
    args: TSchema extends TParameters ? unknown : Static<TParameters>,
    context: ToolPresentContext,
    result?: AgentToolResult<TDetails>,
  ): ToolClass;
  /** Human label for a tool without `present`; the default is the tool name. */
  label?: string;
  /** Recovery policy for an effect whose durable intent exists but whose outcome is unknown. */
  replay?: "never" | "safe";
  /** Settles this tool's waiting calls on wake. */
  wake?: ToolWake;
}

/** A tool as its author writes it. The registry stamps `name` from the key it is added under. */
export type ToolDefinition<TParameters extends TSchema = TSchema, TDetails = unknown> = Omit<
  AgentTool<TParameters, TDetails>,
  "name"
>;

/** A tool the loop runs: its environment is already bound, so its call carries none. */
export type ExecutableTool<TParameters extends TSchema = TSchema, TDetails = unknown> = AgentTool<
  TParameters,
  TDetails,
  ToolCall<TDetails>
>;

/**
 * Context snapshot passed into the low-level agent loop. The prompt and the
 * declared tools are carried by the transcript's system messages; `tools` is
 * what the runtime can execute.
 */
export interface AgentContext {
  /** Provider-native replacement for the history before `messages`. */
  checkpoint?: ProviderCheckpointMaterial;
  /** Transcript visible to the model after the checkpoint, if any. */
  messages: Message[];
  /** Executable tools for this run. */
  tools?: ExecutableTool[];
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
  | ({ type: "tool_execution_end"; toolCallId: string; toolName: string } & ToolCallOutcome);
