/**
 * The turn as the step sees it: two calls, one commit boundary between them.
 *
 * `respond` streams one assistant message over the branch's context.
 * `tools` executes that message's tool calls, each inside the effect sandwich
 * (`effects.ts`), and may park on calls that wait for the world. The step
 * commits after each call and decides whether another follows. The turn keeps
 * nothing across calls: a resumed run reaches `tools` again with the same
 * assistant message and recovers each call from its effect ref.
 *
 * `bindTurn` builds a `Turn` over `agent-loop.ts`, the pi-derived loop; tests
 * hand `step` a fake.
 */
import { isRetryableAssistantError, retryDelayMs } from "@nyte-ai/ai";
import type { Api, Model, RetryPolicy, SimpleStreamOptions } from "@nyte-ai/ai";
import type {
  AssistantMessage,
  ImageContent,
  TextContent,
  ToolResultMessage,
  Usage,
} from "@nyte-ai/schema";
import {
  executeToolCalls,
  failToolCallsFromTruncatedMessage,
  generateAssistant,
  toolResultMessage,
} from "../agent-loop.ts";
import type {
  AgentContext,
  AgentEvent,
  AgentLoopConfig,
  AgentTool,
  AgentToolResult,
  StreamFn,
  ThinkingLevel,
  WaitingCall,
} from "../types.ts";
import { isToolWait } from "../types.ts";
import { ToolError, toolResultContent } from "../utils/tool-result.ts";
import {
  DEFAULT_COMPACTION_SETTINGS,
  isOverflow,
  shouldCompact,
  summarizeCheckpoint,
  validateCompactionSettings,
} from "./compaction.ts";
import type { CompactionSettings, ProviderCompaction } from "./compaction.ts";
import { contextMessages, modelContext } from "./context.ts";
import {
  openEffect,
  parkEffect,
  decideRecovery,
  settleEffect,
  type EffectView,
} from "./effects.ts";
import { toJsonValue } from "./json.ts";
import type { Commit, CommitBody, EventBody, Lease, Oid, Run, ToolProgress } from "./model.ts";
import type { Session } from "./store.ts";
import {
  calculateContextTokens,
  estimateModelContextTokens,
  lastAssistantUsageInfo,
} from "./views/context.ts";

/** Based on https://github.com/earendil-works/pi/blob/dev/packages/agent/src/harness/config.ts */
const DEFAULT_RETRY_POLICY: RetryPolicy = {
  enabled: true,
  maxRetries: 3,
  baseDelayMs: 1_000,
};

export interface TurnInput {
  readonly session: Session;
  /** The runner's lease; every effect write carries it. */
  readonly lease: Lease;
  readonly run: Run;
  /** The response this call produces: `run.attempts + 1`. Deltas key on it. */
  readonly attempt: number;
  /** The branch from its newest checkpoint to the tip, oldest first. */
  readonly commits: readonly { readonly oid: Oid; readonly commit: Commit }[];
  /** Streams deltas and progress into the session's event stream. Never throws. */
  readonly emit: (event: EventBody) => void;
  readonly signal: AbortSignal;
}

export type RespondOutcome =
  /** No response yet: the step commits the checkpoint and calls `respond` again. */
  | {
      readonly kind: "checkpoint";
      readonly body: Extract<CommitBody, { kind: "checkpoint" }>;
    }
  | { readonly kind: "complete"; readonly message: AssistantMessage }
  /** The message carries tool calls; the step commits it and calls `tools` next. */
  | { readonly kind: "tools"; readonly message: AssistantMessage }
  /** A transient provider failure; the message is the failed attempt, kept as history. */
  | {
      readonly kind: "retry";
      readonly message: AssistantMessage;
      readonly at: number;
      readonly error: string;
    }
  | { readonly kind: "failed"; readonly message: AssistantMessage; readonly error: string }
  | { readonly kind: "aborted"; readonly message: AssistantMessage };

export type ToolBatchOutcome =
  /** Every call settled; one result per call, in the assistant message's call order. */
  | { readonly kind: "complete"; readonly messages: readonly ToolResultMessage[] }
  /** Some calls are parked on their effect refs. Nothing is committed until they settle. */
  | { readonly kind: "waiting"; readonly calls: readonly string[] }
  /** Every call settled, and the run must end: a policy could not decide, or the batch is unusable. */
  | {
      readonly kind: "failed";
      readonly messages: readonly ToolResultMessage[];
      readonly error: string;
    };

export interface Turn {
  respond(input: TurnInput): Promise<RespondOutcome>;
  tools(input: TurnInput & { readonly assistant: AssistantMessage }): Promise<ToolBatchOutcome>;
}

export interface TurnOptions {
  readonly streamFn: StreamFn;
  readonly model: Model<Api>;
  readonly systemPrompt: string;
  readonly tools: readonly AgentTool[];
  readonly thinkingLevel?: ThinkingLevel;
  readonly loop?: Pick<AgentLoopConfig, "transformContext" | "beforeToolCall" | "afterToolCall"> &
    Omit<SimpleStreamOptions, "reasoning" | "signal">;
  readonly retry?: RetryPolicy;
  readonly compaction?: CompactionSettings;
  readonly compactionStreamFn?: StreamFn;
  readonly providerCompaction?: ProviderCompaction;
}

/** Bind one store-independent agent turn to the kernel's durable effects. */
export function bindTurn(options: TurnOptions): Turn {
  validateCompactionSettings(options.compaction ?? DEFAULT_COMPACTION_SETTINGS);
  return {
    respond: async (input) => respond(options, input),
    tools: async (input) => runTools(options, input),
  };
}

async function respond(options: TurnOptions, input: TurnInput): Promise<RespondOutcome> {
  const settings = options.compaction ?? DEFAULT_COMPACTION_SETTINGS;
  const usage = newestAssistantUsage(input.commits);
  const checkpoint = input.commits[0]?.commit.body;
  const contextTokens =
    checkpoint?.kind === "checkpoint" && checkpoint.material !== undefined
      ? estimateModelContextTokens(
          input.commits.map((entry) => entry.commit),
          { provider: options.model.provider, api: options.model.api, model: options.model.id },
        ).tokens
      : usage === undefined
        ? undefined
        : calculateContextTokens(usage);
  if (
    !input.signal.aborted &&
    !newestIsRunCheckpoint(input) &&
    contextTokens !== undefined &&
    shouldCompact(contextTokens, options.model.contextWindow, settings)
  ) {
    const checkpoint = await checkpointOutcome(options, input, settings, "threshold");
    if (checkpoint !== undefined) return checkpoint;
  }

  const context = agentContext({ options, input, tools: [...options.tools] });
  const message = await generateAssistant(
    context,
    agentConfig(options),
    input.signal,
    (event) => emitAssistantDelta(input, event),
    options.streamFn,
  );

  switch (message.stopReason) {
    case "aborted":
      return { kind: "aborted", message };
    case "error": {
      const error = message.errorMessage ?? "Unknown error";
      if (settings.enabled && isOverflow(message, options.model) && !newestIsRunCheckpoint(input)) {
        const checkpoint = await checkpointOutcome(options, input, settings, "overflow");
        if (checkpoint !== undefined) return checkpoint;
      }
      const at = retryAt({
        policy: options.retry ?? DEFAULT_RETRY_POLICY,
        run: input.run,
        message,
      });
      return at === undefined
        ? { kind: "failed", message, error }
        : { kind: "retry", message, at, error };
    }
    case "toolUse":
    case "stop":
    case "length":
    case "pending":
    case "deferred":
      return message.content.some((part) => part.type === "toolCall")
        ? { kind: "tools", message }
        : { kind: "complete", message };
    default: {
      const _exhaustive: never = message.stopReason;
      return _exhaustive;
    }
  }
}

function newestAssistantUsage(
  commits: readonly { readonly oid: Oid; readonly commit: Commit }[],
): Usage | undefined {
  let start = 0;
  for (let index = commits.length - 1; index >= 0; index -= 1) {
    if (commits[index]?.commit.body.kind === "checkpoint") {
      start = index + 1;
      break;
    }
  }
  const messages = contextMessages(commits.slice(start).map((entry) => entry.commit));
  return lastAssistantUsageInfo(messages)?.usage;
}

function newestIsRunCheckpoint(input: TurnInput): boolean {
  const newest = input.commits.at(-1)?.commit;
  return newest?.run === input.run.id && newest.body.kind === "checkpoint";
}

async function checkpointOutcome(
  options: TurnOptions,
  input: TurnInput,
  settings: CompactionSettings,
  reason: "threshold" | "overflow",
): Promise<Extract<RespondOutcome, { readonly kind: "checkpoint" }> | undefined> {
  const summarized = await summarizeCheckpoint({
    commits: input.commits,
    streamFn: options.compactionStreamFn ?? options.streamFn,
    model: options.model,
    thinkingLevel: options.thinkingLevel,
    settings,
    reason,
    signal: input.signal,
    retry: options.retry,
    providerCompaction: options.providerCompaction,
    systemPrompt: options.systemPrompt,
    tools: [...options.tools],
  });
  return summarized.ok ? { kind: "checkpoint", body: summarized.value } : undefined;
}

async function runTools(
  options: TurnOptions,
  input: TurnInput & { readonly assistant: AssistantMessage },
): Promise<ToolBatchOutcome> {
  const toolCalls = input.assistant.content.filter((part) => part.type === "toolCall");
  if (input.assistant.stopReason === "length") {
    return {
      kind: "complete",
      messages: await failToolCallsFromTruncatedMessage(toolCalls, () => undefined),
    };
  }

  const parked = new Set<string>();
  const settling = new Map<string, EffectView>();
  const tools = durableTools({ options, input, parked, settling });
  const context = agentContext({ options, input, tools });
  const callerBeforeToolCall = options.loop?.beforeToolCall;
  const callerAfterToolCall = options.loop?.afterToolCall;
  const config = agentConfig(options, {
    beforeToolCall: async (hookContext, signal) =>
      callerBeforeToolCall?.(hookContext, signal ?? input.signal),
    afterToolCall: async (hookContext, signal) => {
      if (!settling.has(hookContext.toolCall.id)) return undefined;
      return callerAfterToolCall?.(hookContext, signal ?? input.signal);
    },
  });

  try {
    const messages = await executeToolCalls(
      context,
      input.assistant,
      config,
      input.signal.aborted ? undefined : input.signal,
      (event) => emitToolProgress(input, event),
      async ({ toolCall, result, isError }) => {
        const view = settling.get(toolCall.id);
        if (view === undefined) return;
        await settleOrThrow({ session: input.session, lease: input.lease, view, result, isError });
      },
    );
    if (parked.size > 0) {
      return {
        kind: "waiting",
        calls: toolCalls.flatMap((call) => (parked.has(call.id) ? [call.id] : [])),
      };
    }
    return { kind: "complete", messages };
  } catch (error) {
    return {
      kind: "failed",
      messages: [],
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

function agentContext(options: {
  readonly options: TurnOptions;
  readonly input: TurnInput;
  readonly tools: AgentTool[];
}): AgentContext {
  const projected = modelContext(
    options.input.commits.map((entry) => entry.commit),
    {
      provider: options.options.model.provider,
      api: options.options.model.api,
      model: options.options.model.id,
    },
  );
  const context: AgentContext = {
    systemPrompt: options.options.systemPrompt,
    messages: projected.messages,
    tools: options.tools,
  };
  return projected.checkpoint === undefined
    ? context
    : { ...context, checkpoint: projected.checkpoint };
}

function agentConfig(
  options: TurnOptions,
  hooks: Pick<AgentLoopConfig, "beforeToolCall" | "afterToolCall"> = {},
): AgentLoopConfig {
  return {
    ...options.loop,
    model: options.model,
    reasoning: options.thinkingLevel === "off" ? undefined : options.thinkingLevel,
    beforeToolCall: hooks.beforeToolCall ?? options.loop?.beforeToolCall,
    afterToolCall: hooks.afterToolCall ?? options.loop?.afterToolCall,
  };
}

function emitAssistantDelta(input: TurnInput, event: AgentEvent): void {
  if (event.type !== "message_update") return;
  const update = event.assistantMessageEvent;
  if (update.type === "text_delta") {
    input.emit({
      kind: "delta",
      runId: input.run.id,
      attempt: input.attempt,
      index: update.contentIndex,
      part: "text",
      delta: update.delta,
    });
  } else if (update.type === "thinking_delta") {
    input.emit({
      kind: "delta",
      runId: input.run.id,
      attempt: input.attempt,
      index: update.contentIndex,
      part: "thinking",
      delta: update.delta,
    });
  }
}

function emitToolProgress(input: TurnInput, event: AgentEvent): void {
  if (event.type !== "tool_execution_update") return;
  input.emit({
    kind: "progress",
    runId: input.run.id,
    callId: event.toolCallId,
    progress: isProgressPayload(event.partialResult)
      ? toolProgress(event.partialResult)
      : { text: "" },
  });
}

function retryAt(options: {
  readonly policy: RetryPolicy;
  readonly run: Run;
  readonly message: AssistantMessage;
}): number | undefined {
  if (!options.policy.enabled || options.run.attempts >= options.policy.maxRetries) {
    return undefined;
  }
  if (!isRetryableAssistantError(options.message)) return undefined;
  const retryAttempt = options.run.attempts + 1;
  const providerDelay = providerRetryDelayMs(options.message);
  const delay = Math.max(retryDelayMs(options.policy, retryAttempt), providerDelay ?? 0);
  return Date.now() + delay;
}

function providerRetryDelayMs(message: AssistantMessage): number | undefined {
  for (const diagnostic of message.diagnostics ?? []) {
    const details = diagnostic.details;
    if (details === undefined) continue;
    for (const key of ["retryAfterMs", "retryDelayMs"]) {
      const value = details[key];
      if (isNonNegativeFiniteNumber(value)) return value;
    }
  }
  const match = message.errorMessage?.match(/server requested ([0-9]+(?:\.[0-9]+)?)s retry delay/i);
  if (match === null || match === undefined) return undefined;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : undefined;
}

function isNonNegativeFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0;
}

function durableTools(options: {
  readonly options: TurnOptions;
  readonly input: TurnInput;
  readonly parked: Set<string>;
  readonly settling: Map<string, EffectView>;
}): AgentTool[] {
  return options.options.tools.map((tool) => ({
    ...tool,
    execute: async (callId, params, signal, onUpdate) => {
      const opened = await openEffect(options.input.session, {
        lease: options.input.lease,
        runId: options.input.run.id,
        callId,
        tool: tool.name,
        args: toJsonValue(params),
        replay: tool.replay ?? "never",
      });
      const view = opened.view;
      const recovery = opened.kind === "opened" ? "execute" : decideRecovery(view);
      const executionSignal = signal ?? options.input.signal;
      if (recovery !== "reuse") options.settling.set(callId, view);
      const waiting = (): AgentToolResult<unknown> => {
        options.settling.delete(callId);
        options.parked.add(callId);
        return waitingResult();
      };

      switch (recovery) {
        case "execute": {
          try {
            return await tool.execute(callId, params, executionSignal, onUpdate);
          } catch (error) {
            if (!isToolWait(error)) throw error;
            await parkOrThrow({ session: options.input.session, lease: options.input.lease, view });
            return waiting();
          }
        }
        case "interrupted":
          throw new Error(
            `Tool call "${tool.name}" was interrupted before completing and was not replayed.`,
          );
        case "blocked":
          if (!executionSignal.aborted) return waiting();
          if (tool.wake !== undefined) {
            const outcome = await tool.wake(waitingCall(view), {
              signal: executionSignal,
              aborted: true,
            });
            if (outcome.kind === "settle") {
              if (outcome.isError === true) throw new ToolError(outcome.result);
              return outcome.result;
            }
          }
          throw new Error(`Tool call "${tool.name}" was aborted while waiting.`);
        case "wake": {
          if (view.effect.state !== "signal") {
            throw new Error(`Effect ${view.ref} was classified for wake without a signal`);
          }
          if (tool.wake === undefined) {
            throw new Error(
              `Tool call "${tool.name}" cannot resume because it has no wake handler.`,
            );
          }
          const outcome = await tool.wake(waitingCall(view), {
            signal: executionSignal,
            aborted: options.input.run.abortRequested === true,
            reply: view.effect.signal,
          });
          if (outcome.kind === "settle") {
            if (outcome.isError === true) throw new ToolError(outcome.result);
            return outcome.result;
          }
          await parkOrThrow({
            session: options.input.session,
            lease: options.input.lease,
            view,
          });
          return waiting();
        }
        case "reuse": {
          if (view.effect.state !== "result") {
            throw new Error(`Effect ${view.ref} was classified for reuse without a result`);
          }
          const stored = view.effect.result;
          const result: AgentToolResult<unknown> = {
            content: stored.content,
            details: stored.details,
          };
          const titled = stored.title === undefined ? result : { ...result, title: stored.title };
          const restored = stored.usage === undefined ? titled : { ...titled, usage: stored.usage };
          if (stored.isError) throw new ToolError(restored);
          return restored;
        }
        default: {
          const _exhaustive: never = recovery;
          return _exhaustive;
        }
      }
    },
  }));
}

async function settleOrThrow(options: {
  readonly session: Session;
  readonly lease: Lease;
  readonly view: EffectView;
  readonly result: AgentToolResult<unknown>;
  readonly isError: boolean;
}): Promise<void> {
  const outcome = await settleEffect(options.session, {
    lease: options.lease,
    view: options.view,
    result: toolResultMessage(
      { toolCallId: options.view.intent.callId, toolName: options.view.intent.tool },
      options.result,
      options.isError,
    ),
  });
  if ("kind" in outcome) {
    throw new Error(`Effect ${options.view.ref} changed before it could settle`);
  }
}

async function parkOrThrow(options: {
  readonly session: Session;
  readonly lease: Lease;
  readonly view: EffectView;
}): Promise<void> {
  const outcome = await parkEffect(options.session, {
    lease: options.lease,
    view: options.view,
  });
  if ("kind" in outcome) {
    throw new Error(`Effect ${options.view.ref} changed before it could park`);
  }
}

function waitingCall(view: EffectView): WaitingCall {
  return {
    runId: view.intent.runId,
    toolCallId: view.intent.callId,
    resultEntryId: view.ref,
    args: view.intent.args,
  };
}

function waitingResult(): AgentToolResult<unknown> {
  return { content: toolResultContent("Waiting for input."), details: {} };
}

type ProgressPart = TextContent | ImageContent;

/** The part of a tool's partial `AgentToolResult` that reaches the event stream. */
interface ProgressPayload {
  readonly content?: readonly ProgressPart[];
  readonly title?: string;
  readonly details?: unknown;
}

function isObjectValue(value: unknown): value is object {
  return typeof value === "object" && value !== null;
}

function isProgressPart(value: unknown): value is ProgressPart {
  if (!isObjectValue(value) || !("type" in value)) return false;
  if (value.type === "text") {
    return (
      "text" in value &&
      typeof value.text === "string" &&
      (!("textSignature" in value) ||
        value.textSignature === undefined ||
        typeof value.textSignature === "string")
    );
  }
  if (value.type === "image") {
    return (
      "data" in value &&
      typeof value.data === "string" &&
      "mimeType" in value &&
      typeof value.mimeType === "string"
    );
  }
  return false;
}

/** Whether a partial tool result carries progress the event stream can carry. */
export function isProgressPayload(value: unknown): value is ProgressPayload {
  if (!isObjectValue(value)) return false;
  if (
    "content" in value &&
    value.content !== undefined &&
    !(Array.isArray(value.content) && value.content.every(isProgressPart))
  ) {
    return false;
  }
  return !("title" in value) || value.title === undefined || typeof value.title === "string";
}

/** Normalize a tool's partial result for the event stream. */
export function toolProgress(payload: ProgressPayload): ToolProgress {
  const text = (payload.content ?? [])
    .map(partText)
    .filter((part) => part !== "")
    .join("\n");
  const details = jsonDetails(payload.details);
  const progress: ToolProgress =
    payload.title === undefined ? { text } : { text, title: payload.title };
  return details === undefined ? progress : { ...progress, details };
}

function jsonDetails<Value>(value: Value): ReturnType<typeof toJsonValue> | undefined {
  if (value === undefined) return undefined;
  try {
    return toJsonValue(value);
  } catch {
    return undefined;
  }
}

function partText(part: ProgressPart): string {
  switch (part.type) {
    case "text":
      return part.text;
    case "image":
      return `[image ${part.mimeType}]`;
    default: {
      const _exhaustive: never = part;
      return _exhaustive;
    }
  }
}
