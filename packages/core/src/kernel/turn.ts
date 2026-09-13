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
import type { TelemetryContext } from "@nyte-ai/telemetry";
import { schemas } from "@nyte-ai/protocol";
import { Type } from "typebox";
import { Value } from "typebox/value";
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
import type { ToolWaitOptions } from "../types.ts";
import { ToolError, toolResultContent } from "../utils/tool-result.ts";
import {
  DEFAULT_COMPACTION_SETTINGS,
  finishCompaction,
  isOverflow,
  retainCompactionUsage,
  shouldCompact,
  startCompaction,
  summarizeCheckpoint,
  validateCompactionSettings,
} from "./compaction.ts";
import type { CompactionSettings, ProviderCompaction } from "./compaction.ts";
import { contextMessages, modelContext } from "./context.ts";
import {
  decideRecovery,
  expireEffect,
  openEffect,
  parkEffect,
  settleEffect,
  type EffectView,
} from "./effects.ts";
import { toJsonValue } from "./json.ts";
import type { JsonValue } from "./json.ts";
import type {
  Choice,
  Commit,
  CommitBody,
  EventBody,
  Lease,
  Oid,
  Run,
  Selection,
  ToolProgress,
} from "./model.ts";
import type { Session } from "./store.ts";
import { startSpan } from "./telemetry.ts";
import { estimateModelContextTokens, lastAssistantUsageInfo } from "./views/context.ts";
import { usageTokens } from "./views/usage.ts";

/** Based on https://github.com/earendil-works/pi/blob/dev/packages/agent/src/harness/config.ts */
const DEFAULT_RETRY_POLICY: RetryPolicy = {
  enabled: true,
  maxRetries: 3,
  baseDelayMs: 1_000,
};

const NonNegativeNumber = Type.Number({ minimum: 0 });
const ProgressPayloadSchema = Type.Object({
  content: Type.Optional(
    Type.Array(
      Type.Union([
        Type.Object({
          type: Type.Literal("text"),
          text: Type.String(),
          textSignature: Type.Optional(Type.String()),
        }),
        Type.Object({
          type: Type.Literal("image"),
          data: Type.String(),
          mimeType: Type.String(),
        }),
      ]),
    ),
  ),
  title: Type.Optional(Type.String()),
  details: Type.Optional(Type.Unknown()),
});

export interface TurnInput {
  readonly session: Session;
  /** The step's span: the response, tool, and compaction spans nest under it. */
  readonly telemetry: TelemetryContext;
  /** The runner's lease; every effect write carries it. */
  readonly lease: Lease;
  readonly run: Run;
  /** One clock read from the step, shared by every deadline decision in this call. */
  readonly now: number;
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
  | { readonly kind: "fenced" }
  | { readonly kind: "conflict" }
  /** Every call settled; one result per call, in the assistant message's call order. */
  | { readonly kind: "complete"; readonly messages: readonly ToolResultMessage[] }
  /** Some calls are parked on their effect refs. Nothing is committed until they settle. */
  | { readonly kind: "waiting"; readonly calls: readonly string[] }
  /** Every call settled, and the run must end: a policy could not decide, or the batch is unusable. */
  | {
      readonly kind: "failed";
      readonly messages: readonly ToolResultMessage[];
      readonly error: string;
      readonly cause?: unknown;
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
  readonly compactAt?: number;
  readonly compactionStreamFn?: StreamFn;
  readonly providerCompaction?: ProviderCompaction;
}

/** Bind one store-independent agent turn to the kernel's durable effects. */
export function bindTurn(options: TurnOptions): Turn {
  validateCompactionSettings(options.compaction ?? DEFAULT_COMPACTION_SETTINGS);
  return {
    respond: (input) =>
      startSpan(
        input.telemetry,
        "nyte.respond",
        {
          "nyte.run.id": input.run.id,
          "nyte.attempt": input.attempt,
          "nyte.model.provider": options.model.provider,
          "nyte.model.id": options.model.id,
        },
        async (span) => {
          const outcome = await respond(options, { ...input, telemetry: span });
          span.setAttributes({ "nyte.respond.outcome": outcome.kind });
          // Checkpoint outcomes carry no assistant; overflow responses are retained separately.
          if (outcome.kind === "checkpoint") return outcome;
          const { usage, stopReason } = outcome.message;
          span.setAttributes({
            "nyte.stop_reason": stopReason,
            "nyte.usage.input_tokens": usage.input,
            "nyte.usage.output_tokens": usage.output,
            "nyte.usage.cache_read_tokens": usage.cacheRead,
            "nyte.usage.cache_write_tokens": usage.cacheWrite,
            "nyte.usage.total_tokens": usage.totalTokens,
            "nyte.usage.cost": usage.cost.total,
          });
          if (stopReason === "error") span.setStatus({ status: "error" });
          return outcome;
        },
      ),
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
        : usageTokens(usage);
  if (
    !input.signal.aborted &&
    !newestIsRunCheckpoint(input) &&
    contextTokens !== undefined &&
    (options.compactAt === undefined
      ? shouldCompact(contextTokens, options.model.contextWindow, settings)
      : settings.enabled && contextTokens >= options.compactAt)
  ) {
    const checkpoint = await checkpointOutcome(options, input, settings, "threshold");
    if (checkpoint !== undefined) return checkpoint;
  }

  const context = agentContext({ options, input, tools: [...options.tools] });
  const message = await generateAssistant(
    context,
    agentConfig(options, input.telemetry),
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
        if (checkpoint !== undefined) {
          // Recovery replaces this response with a checkpoint. Keep the original
          // model spend without adding the failed response to the branch context.
          await input.session.objects.put([
            {
              kind: "commit",
              parent: input.commits.at(-1)?.oid ?? null,
              body: { kind: "message", message },
              run: input.run.id,
              at: Date.now(),
            },
          ]);
          return checkpoint;
        }
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
  return startSpan(
    input.telemetry,
    "nyte.compaction",
    { "nyte.run.id": input.run.id, "nyte.compaction.reason": reason },
    async (span) => {
      await startCompaction(input.session, {
        head: input.run.head,
        lease: input.lease,
        reason,
      });
      const summarized = await summarizeCheckpoint({
        commits: input.commits,
        streamFn: (model, context, requestOptions) =>
          (options.compactionStreamFn ?? options.streamFn)(model, context, {
            ...requestOptions,
            telemetryContext: span,
          }),
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
      span.setAttributes({ "nyte.compaction.outcome": summarized.ok ? "summarized" : "skipped" });
      if (summarized.ok) return { kind: "checkpoint", body: summarized.value };
      await retainCompactionUsage(input.session, {
        parent: input.commits.at(-1)?.oid ?? null,
        usage: summarized.error.usage,
      });
      await finishCompaction(input.session, {
        head: input.run.head,
        lease: input.lease,
      });
      return undefined;
    },
  );
}

interface ToolBatchState {
  stopped?: Extract<ToolBatchOutcome, { readonly kind: "fenced" | "conflict" | "failed" }>;
}

function stopBatch(state: ToolBatchState, outcome: NonNullable<ToolBatchState["stopped"]>): void {
  if (state.stopped === undefined || outcome.kind === "fenced") state.stopped = outcome;
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
  const state: ToolBatchState = {};
  const tools = durableTools({ options, input, parked, settling, state });
  const context = agentContext({ options, input, tools });
  const callerBeforeToolCall = options.loop?.beforeToolCall;
  const callerAfterToolCall = options.loop?.afterToolCall;
  const config = agentConfig(options, input.telemetry, {
    beforeToolCall: async (hookContext, signal) =>
      callerBeforeToolCall?.(hookContext, signal ?? input.signal),
    afterToolCall: async (hookContext, signal) => {
      if (state.stopped !== undefined || !settling.has(hookContext.toolCall.id)) return undefined;
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
        if (state.stopped !== undefined || view === undefined) return;
        await settleCall({
          session: input.session,
          lease: input.lease,
          view,
          result,
          isError,
          state,
        });
      },
    );
    if (state.stopped !== undefined) return state.stopped;
    if (parked.size > 0) {
      return {
        kind: "waiting",
        calls: toolCalls.flatMap((call) => (parked.has(call.id) ? [call.id] : [])),
      };
    }
    return { kind: "complete", messages };
  } catch (error) {
    if (state.stopped !== undefined) return state.stopped;
    return {
      kind: "failed",
      cause: error,
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
  telemetryContext: TelemetryContext,
  hooks: Pick<AgentLoopConfig, "beforeToolCall" | "afterToolCall"> = {},
): AgentLoopConfig {
  return {
    ...options.loop,
    telemetryContext,
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
      if (Value.Check(NonNegativeNumber, value)) return value;
    }
  }
  const match = message.errorMessage?.match(/server requested ([0-9]+(?:\.[0-9]+)?)s retry delay/i);
  if (match === null || match === undefined) return undefined;
  const seconds = Number(match[1]);
  return Number.isFinite(seconds) && seconds >= 0 ? seconds * 1_000 : undefined;
}

function durableTools(options: {
  readonly options: TurnOptions;
  readonly input: TurnInput;
  readonly parked: Set<string>;
  readonly settling: Map<string, EffectView>;
  readonly state: ToolBatchState;
}): AgentTool[] {
  return options.options.tools.map((tool) => {
    const execute: AgentTool["execute"] = async (callId, params, signal, onUpdate) => {
      if (options.state.stopped !== undefined) return waitingResult();
      const args = toJsonValue(params);
      let opened;
      try {
        opened = await openEffect(options.input.session, {
          lease: options.input.lease,
          runId: options.input.run.id,
          callId,
          tool: tool.name,
          args,
          replay: tool.replay ?? "never",
        });
      } catch (cause) {
        stopBatch(options.state, {
          kind: "failed",
          messages: [],
          cause,
          error: cause instanceof Error ? cause.message : String(cause),
        });
        return waitingResult();
      }
      if (opened.kind === "fenced" || opened.kind === "conflict") {
        stopBatch(options.state, opened);
        return waitingResult();
      }
      // Another call may have lost ownership while this open was in flight.
      if (options.state.stopped !== undefined) return waitingResult();
      let view = opened.view;
      let recovery = opened.kind === "opened" ? "execute" : decideRecovery(view);
      const executionSignal = signal ?? options.input.signal;
      if (
        recovery === "blocked" &&
        view.effect.state === "waiting" &&
        view.effect.until !== undefined &&
        view.effect.until <= options.input.now &&
        !executionSignal.aborted
      ) {
        const expiration = await expireEffect(options.input.session, {
          lease: options.input.lease,
          view,
          now: options.input.now,
        });
        if (expiration.kind !== "expired") {
          stopBatch(options.state, expiration);
          return waitingResult();
        }
        view = expiration.view;
        recovery = "wake";
      }
      if (recovery !== "reuse") options.settling.set(callId, view);
      const waiting = (): AgentToolResult<unknown> => {
        options.settling.delete(callId);
        options.parked.add(callId);
        return waitingResult();
      };

      switch (recovery) {
        case "execute": {
          try {
            return await tool.execute(callId, params, executionSignal, onUpdate, {
              runId: options.input.run.id,
              head: options.input.run.head,
            });
          } catch (error) {
            if (!isToolWait(error)) throw error;
            await parkCall({
              session: options.input.session,
              lease: options.input.lease,
              view,
              state: options.state,
              ...parkedWait(tool.name, error),
            });
            return waiting();
          }
        }
        case "interrupted":
          throw new Error(
            `Tool call "${tool.name}" was interrupted before completing and was not replayed.`,
          );
        case "blocked": {
          if (!executionSignal.aborted) return waiting();
          if (tool.wake !== undefined) {
            const outcome = await tool.wake(waitingCall(view), {
              signal: executionSignal,
              aborted: true,
              expired: false,
            });
            if (outcome.kind === "settle") {
              if (outcome.isError === true) throw new ToolError(outcome.result);
              return outcome.result;
            }
          }
          throw new Error(`Tool call "${tool.name}" was aborted while waiting.`);
        }
        case "wake": {
          if (view.effect.state !== "signal" && view.effect.state !== "expired") {
            throw new Error(
              `Effect ${view.ref} was classified for wake without a signal or expiry`,
            );
          }
          if (tool.wake === undefined) {
            if (view.effect.state === "expired") {
              throw new Error(`Tool call "${tool.name}" timed out while waiting.`);
            }
            throw new Error(
              `Tool call "${tool.name}" cannot resume because it has no wake handler.`,
            );
          }
          const outcome = await tool.wake(
            waitingCall(view),
            view.effect.state === "expired"
              ? {
                  signal: executionSignal,
                  aborted: executionSignal.aborted,
                  expired: true,
                }
              : {
                  signal: executionSignal,
                  aborted: options.input.run.abortRequested === true,
                  expired: false,
                  reply: view.effect.signal,
                },
          );
          if (outcome.kind === "settle") {
            if (outcome.isError === true) throw new ToolError(outcome.result);
            return outcome.result;
          }
          await parkCall({
            session: options.input.session,
            lease: options.input.lease,
            view,
            state: options.state,
            ...parkedWait(tool.name, outcome),
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
    };
    return {
      ...tool,
      execute: (callId, params, signal, onUpdate) =>
        startSpan(
          options.input.telemetry,
          "nyte.tool",
          {
            "nyte.run.id": options.input.run.id,
            "nyte.tool.name": tool.name,
            "nyte.call.id": callId,
          },
          async (span) => {
            try {
              const result = await execute(callId, params, signal, onUpdate);
              span.setAttributes({
                "nyte.tool.is_error": false,
                "nyte.tool.parked": options.parked.has(callId),
              });
              return result;
            } catch (error) {
              span.setAttributes({ "nyte.tool.is_error": true, "nyte.tool.parked": false });
              throw error;
            }
          },
        ),
    };
  });
}

async function settleCall(options: {
  readonly session: Session;
  readonly lease: Lease;
  readonly view: EffectView;
  readonly result: AgentToolResult<unknown>;
  readonly isError: boolean;
  readonly state: ToolBatchState;
}): Promise<void> {
  try {
    const outcome = await settleEffect(options.session, {
      lease: options.lease,
      view: options.view,
      result: toolResultMessage(
        { toolCallId: options.view.intent.callId, toolName: options.view.intent.tool },
        options.result,
        options.isError,
      ),
    });
    if (outcome.kind !== "settled") stopBatch(options.state, outcome);
  } catch (cause) {
    stopBatch(options.state, {
      kind: "failed",
      messages: [],
      cause,
      error: cause instanceof Error ? cause.message : String(cause),
    });
  }
}

/** What a tool parked with, checked at the plugin boundary. */
function parkedWait(
  tool: string,
  options: ToolWaitOptions,
): { readonly selection: Selection | undefined; readonly until: number | undefined } {
  const until: unknown = options.until;
  if (until !== undefined && (typeof until !== "number" || !Number.isFinite(until))) {
    throw new Error(`Tool "${tool}" parked with a malformed deadline`);
  }
  return { selection: parkedSelection(tool, options.selection), until };
}

/**
 * A plugin is outside the type system's reach, so what it parks with is
 * made durable before it is trusted: `toJsonValue` reads every field once,
 * so a getter cannot answer the check with one value and the store with
 * another, and the stored object is rebuilt from the checked fields alone,
 * so nothing a plugin attached beside them reaches the ref. A malformed
 * selection fails this call as a tool error rather than becoming an effect
 * object no reader can parse.
 */
function parkedSelection(tool: string, selection: unknown): Selection | undefined {
  if (selection === undefined) return undefined;
  const malformed = (reason: string) =>
    new Error(`Tool "${tool}" parked with a malformed selection: ${reason}`);
  let json: JsonValue;
  try {
    json = toJsonValue(selection);
  } catch (cause) {
    throw malformed(cause instanceof Error ? cause.message : String(cause));
  }
  if (!Value.Check(schemas.Selection, json)) throw malformed("does not match the schema");
  if (json.title.trim() === "") throw malformed("the title is blank");
  if (json.other !== undefined && json.other.trim() === "") {
    throw malformed("the own-answer prompt is blank");
  }
  const ids = new Set<string>();
  for (const choice of json.choices) {
    if (choice.id === "") throw malformed("a choice has an empty id");
    if (choice.label.trim() === "") throw malformed(`choice "${choice.id}" has a blank label`);
    if (choice.description !== undefined && choice.description.trim() === "") {
      throw malformed(`choice "${choice.id}" has a blank description`);
    }
    if (ids.has(choice.id)) throw malformed(`choice id "${choice.id}" appears twice`);
    ids.add(choice.id);
  }
  const [first, ...rest] = json.choices;
  const durable: Selection = {
    title: json.title,
    choices: [durableChoice(first), ...rest.map(durableChoice)],
  };
  const withMultiple: Selection =
    json.multiple === undefined ? durable : { ...durable, multiple: true };
  if (json.other === undefined) return withMultiple;
  const withOther: Selection = { ...withMultiple, other: json.other };
  return withOther;
}

function durableChoice({ id, label, description }: Choice): Choice {
  return description === undefined ? { id, label } : { id, label, description };
}

async function parkCall(options: {
  readonly session: Session;
  readonly lease: Lease;
  readonly view: EffectView;
  readonly state: ToolBatchState;
  readonly selection: Selection | undefined;
  readonly until: number | undefined;
}): Promise<void> {
  if (options.state.stopped !== undefined) return;
  try {
    const outcome = await parkEffect(options.session, {
      lease: options.lease,
      view: options.view,
      ...(options.selection === undefined ? {} : { selection: options.selection }),
      ...(options.until === undefined ? {} : { until: options.until }),
    });
    if (outcome.kind !== "parked") stopBatch(options.state, outcome);
  } catch (cause) {
    stopBatch(options.state, {
      kind: "failed",
      messages: [],
      cause,
      error: cause instanceof Error ? cause.message : String(cause),
    });
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
type ToolExecutionUpdate = Extract<AgentEvent, { readonly type: "tool_execution_update" }>;

/** The part of a tool's partial `AgentToolResult` that reaches the event stream. */
interface ProgressPayload {
  readonly content?: readonly ProgressPart[];
  readonly title?: string;
  readonly details?: unknown;
}

/** Whether a partial tool result carries progress the event stream can carry. */
function isProgressPayload(value: ToolExecutionUpdate["partialResult"]): value is ProgressPayload {
  return Value.Check(ProgressPayloadSchema, value);
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
