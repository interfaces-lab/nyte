/**
 * Hooks: the points where plugin code intercepts a run and returns a typed
 * result. This file holds the contract (which hooks exist, what each sees,
 * what each may return, how results combine) and the `HookRegistry` that runs
 * handlers in plugin order, applies the combining rule, and contains
 * failures. Every handler runs under a wall-clock budget: one that never
 * settles is a failure like any other, not a run that never moves.
 *
 * Hooks are a separate list from events (`events.ts`). An event listener has
 * no return value the runner reads; a hook handler does. That split is what
 * keeps an observer from becoming an interceptor by accident.
 *
 * Combining rules, per hook:
 * - `transform_context`: chained replacement of the conversation (the messages
 *   without system messages) and of the system prompt. A returned prompt
 *   replaces the request's leading prompt for that request only.
 * - `transform_transcript`: chained replacement of the whole transcript,
 *   system messages included; the result is sent as returned.
 * - `before_request`: each patch applied in order over the stream options.
 * - `before_tool`: policies run in plugin order; `modify` decisions
 *   chain and `continue` is not terminal, so no decision bypasses a later
 *   policy. The first `reject` or `error` stops the chain. A throwing handler
 *   becomes `error` (fail-closed).
 * - `after_tool`: field-wise chained patch; `outcome` replaces how the call settled.
 * - `before_compaction`: first provider checkpoint wins; failed attempts carry
 *   usage into later handlers or portable compaction. Only exhausted failures
 *   report a fallback warning.
 * - `cache_warming_decision`: the last handler to return an action wins; a
 *   failing handler leaves the action as it stood.
 *
 * Based on https://github.com/earendil-works/pi/blob/dev/packages/agent/src/harness/agent-harness.ts (HookMap)
 * Synced with pi 7ebf9087e.
 */
import type { Context, JsonValue, Message, Usage } from "@nyte-ai/schema";
import { schemas, type ToolOutcome } from "@nyte-ai/protocol";
import type { ProviderCompaction } from "../kernel/compaction.ts";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { isJsonObject, toJsonValue, type JsonObject } from "@nyte-ai/client";
import { addUsage } from "@nyte-ai/client";
import type { AgentToolResult } from "../kernel/loop/types.ts";
import {
  applyStreamOptionsPatch,
  createStreamOptionsPatch,
  type StreamOptions,
  type StreamOptionsPatch,
} from "../kernel/stream-options.ts";
import type { CacheWarmingAction, CacheWarmingDecisionEvent } from "../kernel/cache-warmer.ts";
import { withBudget } from "./scope.ts";

/**
 * The model a request is about. pi carries its full `Model<Api>` here; Nyte's
 * provider layer identifies a model by provider id and model id, and the rest
 * of the description lives in `@nyte-ai/ai`. Grows fields when a hook needs them.
 */
export interface HookModelRef {
  provider: string;
  modelId: string;
}

export interface HookMap {
  /**
   * `messages` holds the conversation without system
   * messages. The prompt and tool state belong to the kernel, which restores
   * them after the handlers return, so a handler cannot drop them and does not
   * need to preserve them. `systemPrompt` is the rendered current prompt; a
   * returned one heads the request for that request only and is never stored.
   */
  transform_context: {
    event: { messages: Message[]; systemPrompt: string };
    result: { messages?: Message[]; systemPrompt?: string } | undefined;
  };
  /**
   * After every `transform_context` handler:
   * the full transcript including system messages, sent as returned. The
   * handler owns the prompt and tool declarations.
   */
  transform_transcript: {
    event: { messages: Message[] };
    result: { messages?: Message[] } | undefined;
  };
  before_compaction: {
    event: {
      model: HookModelRef;
      context: Context;
      reason: "manual" | "threshold" | "overflow";
      customInstructions?: string;
      tokensBefore: number;
    };
    result: Awaited<ReturnType<ProviderCompaction>>;
  };
  before_request: {
    event: {
      sessionId: string;
      model: HookModelRef;
      step: "assistant" | "deferred" | "compaction" | "branch_summary";
      attempt: number;
      streamOptions: StreamOptions;
    };
    result: { streamOptions?: StreamOptionsPatch } | undefined;
  };
  before_tool: {
    event: ToolCallRequest;
    result: ToolCallDecision;
  };
  /** Fired before each prompt-cache refresh with the kernel's decision filled in. */
  cache_warming_decision: {
    event: Omit<CacheWarmingDecisionEvent, "type"> & { sessionId: string; model: HookModelRef };
    /** `stop` ends warming until the next real request. */
    result: { action?: CacheWarmingAction } | undefined;
  };
  after_tool: {
    event: { toolCallId: string; toolName: string; args: JsonObject } & ToolOutcomeView;
    result: Partial<ToolOutcomeView> | undefined;
  };
}

/** A settled call as hooks see it: the loop's outcome with JSON details. */
type ToolOutcomeView = Pick<AgentToolResult<unknown>, "content" | "structuredContent" | "usage"> & {
  details?: JsonValue;
  outcome: ToolOutcome;
};

export type HookName = keyof HookMap;

/**
 * The model's proposed tool call at the last typed boundary before its
 * effect. `args` is read-only input: a policy that wants different arguments
 * returns `modify`, so the change is a decision later policies see.
 */
export interface ToolCallRequest {
  readonly toolCallId: string;
  readonly toolName: string;
  readonly args: Readonly<JsonObject>;
}

/**
 * One policy handler's decision. `continue` has no objection and `modify`
 * passes new arguments to later handlers; neither ends the chain. `reject` is
 * a policy objection: the call never runs, the model sees `message` as the
 * tool's error result, and the run goes on. `error` is a policy-system
 * failure: the call settles the same way, then the runner fails the run with
 * a `policy` operation error, because a policy that cannot decide must not be
 * mistaken for one that allowed the call.
 */
export type ToolCallDecision =
  | { readonly action: "continue" }
  | { readonly action: "modify"; readonly args: JsonObject }
  | { readonly action: "reject"; readonly message: string }
  | { readonly action: "error"; readonly message: string };

/**
 * The runtime half of the decision contract. An untyped plugin can still
 * return malformed data, so every claimed field is checked before use.
 */
const ToolCallDecisionSchema = Type.Union([
  Type.Object({ action: Type.Literal("continue") }),
  Type.Object({ action: Type.Literal("modify"), args: Type.Record(Type.String(), Type.Unknown()) }),
  Type.Object({ action: Type.Literal("reject"), message: Type.String() }),
  Type.Object({ action: Type.Literal("error"), message: Type.String() }),
]);

function isToolCallDecision(value: JsonValue): value is ToolCallDecision {
  return Value.Check(ToolCallDecisionSchema, value);
}

/**
 * Normalize a `modify` decision's arguments to the durable JSON object the
 * effect intent stores, under the same strict contract the object store applies, so a
 * Date, a function, `Infinity`, or a cycle fails here as a policy error and
 * never reaches the effect write as an ordinary tool error.
 */
function durableArgs(value: JsonObject, policy: string): JsonObject {
  let json: JsonValue;

  try {
    json = toJsonValue(value);
  } catch (cause) {
    throw new Error(`${policy} modify args are not durable JSON: ${normalizeError(cause).message}`);
  }

  if (!isJsonObject(json)) {
    throw new Error(`${policy} modify args must be a JSON object`);
  }

  return json;
}

/** Every hook event also says which head and run it belongs to. */
export type HookInvocation<TName extends HookName> = HookMap[TName]["event"] & {
  head: string;
  runId: string;
};

export type HookHandler<TName extends HookName> = (
  event: HookInvocation<TName>,
  signal?: AbortSignal,
) => Promise<HookMap[TName]["result"]> | HookMap[TName]["result"];

/** Who registered a handler and where its plugin sits in the activation order. */
export interface HookOptions {
  id?: string;
  /** Handlers run sorted by it, then by registration. Default 0. */
  order?: number;
}

/** The registration half of the hook API, as a plugin sees it. */
export interface Hooks {
  on<TName extends HookName>(
    name: TName,
    handler: HookHandler<TName>,
    options?: HookOptions,
  ): () => void;
}

interface HookRegistration<TName extends HookName> {
  id?: string;
  order: number;
  handler: HookHandler<TName>;
}

/**
 * Wall-clock budget per handler. Compaction is a provider request and gets
 * the room one takes; the rest are process-local decisions.
 */
export type HookBudgets = Readonly<Record<HookName, number>>;

export const HOOK_BUDGETS_MS: HookBudgets = {
  transform_context: 5_000,
  transform_transcript: 5_000,
  before_compaction: 300_000,
  before_request: 5_000,
  before_tool: 5_000,
  after_tool: 5_000,
  cache_warming_decision: 5_000,
};

type HookRegistrations = {
  [TName in HookName]: HookRegistration<TName>[];
};

type HookRunners = {
  [TName in HookName]: (
    event: HookInvocation<TName>,
    signal: AbortSignal | undefined,
  ) => Promise<HookMap[TName]["result"]>;
};

/** Reports hook failures. Compaction reports only after its providers are exhausted. */
export type HookErrorReporter = (
  error: Error,
  hook: HookName,
  head: string,
) => void | Promise<void>;

function normalizeError(cause: unknown): Error {
  return cause instanceof Error ? cause : new Error(String(cause));
}

/**
 * Ordered hook registry and aggregate runner. One difference from pi's class:
 * pi admits each call through the effect gate first; Nyte has no gate.
 */
export class HookRegistry implements Hooks {
  private readonly registrations: HookRegistrations = {
    transform_context: [],
    transform_transcript: [],
    before_compaction: [],
    before_request: [],
    before_tool: [],
    after_tool: [],
    cache_warming_decision: [],
  };
  private readonly runners: HookRunners;
  private readonly reportError: HookErrorReporter;
  private readonly budgets: HookBudgets;
  private closedError: Error | undefined;

  constructor(reportError: HookErrorReporter, budgets: HookBudgets = HOOK_BUDGETS_MS) {
    this.reportError = reportError;
    this.budgets = budgets;
    this.runners = {
      transform_context: (event, signal) => this.transformContext(event, signal),
      transform_transcript: (event, signal) => this.transformTranscript(event, signal),
      before_compaction: (event, signal) => this.beforeCompaction(event, signal),
      before_request: (event, signal) => this.beforeRequest(event, signal),
      before_tool: (event, signal) => this.beforeTool(event, signal),
      after_tool: (event, signal) => this.afterTool(event, signal),
      cache_warming_decision: (event, signal) => this.cacheWarmingDecision(event, signal),
    };
  }

  on<TName extends HookName>(
    name: TName,
    handler: HookHandler<TName>,
    options: HookOptions = {},
  ): () => void {
    if (this.closedError !== undefined) throw this.closedError;
    const registrations = this.registrations[name];
    const order = options.order ?? 0;

    const registration: HookRegistration<TName> =
      options.id === undefined ? { order, handler } : { id: options.id, order, handler };

    const at = registrations.findLastIndex((existing) => existing.order <= order) + 1;
    registrations.splice(at, 0, registration);

    return () => {
      const index = registrations.indexOf(registration);

      if (index !== -1) registrations.splice(index, 1);
    };
  }

  has(name: HookName): boolean {
    return this.registrations[name].length !== 0;
  }

  /** Run every handler registered for `name` and combine their results per the hook's rule. */
  async run<TName extends HookName>(
    name: TName,
    event: HookInvocation<TName>,
    signal?: AbortSignal,
  ): Promise<HookMap[TName]["result"]> {
    if (this.closedError !== undefined) throw this.closedError;

    return this.runners[name](event, signal);
  }

  /** Refuse further registrations and runs after activation closes. */
  close(error: Error): void {
    this.closedError ??= error;
  }

  private async transformContext(
    event: HookInvocation<"transform_context">,
    signal: AbortSignal | undefined,
  ): Promise<HookMap["transform_context"]["result"]> {
    let messages = event.messages;
    let systemPrompt: string | undefined;

    for (const registration of this.registrationsFor("transform_context")) {
      try {
        const result = await this.call(
          "transform_context",
          registration,
          { ...event, messages, systemPrompt: systemPrompt ?? event.systemPrompt },
          signal,
        );

        if (result?.messages !== undefined) messages = result.messages;

        if (result?.systemPrompt !== undefined) systemPrompt = result.systemPrompt;
      } catch (error) {
        await this.reportError(normalizeError(error), "transform_context", event.head);
      }
    }

    return systemPrompt === undefined ? { messages } : { messages, systemPrompt };
  }

  private async transformTranscript(
    event: HookInvocation<"transform_transcript">,
    signal: AbortSignal | undefined,
  ): Promise<HookMap["transform_transcript"]["result"]> {
    let messages = event.messages;

    for (const registration of this.registrationsFor("transform_transcript")) {
      try {
        const hadLeadingSystemMessage = messages[0]?.role === "system";

        const result = await this.call(
          "transform_transcript",
          registration,
          { ...event, messages },
          signal,
        );

        messages = result?.messages ?? messages;

        // Providers read the prompt and initial tools from the leading system message.
        // Losing it is never intended; report it but honor the handler's output.
        if (hadLeadingSystemMessage && messages[0]?.role !== "system") {
          await this.reportError(
            new Error(
              "Handler removed the leading system message; the request has no prompt or initial tool declarations. Keep it at index 0 or replace a dropped prefix with getCurrentSystemMessage().",
            ),
            "transform_transcript",
            event.head,
          );
        }
      } catch (error) {
        await this.reportError(normalizeError(error), "transform_transcript", event.head);
      }
    }

    return { messages };
  }

  private async beforeCompaction(
    event: HookInvocation<"before_compaction">,
    signal: AbortSignal | undefined,
  ): Promise<HookMap["before_compaction"]["result"]> {
    const failures: string[] = [];
    let usage: Usage | undefined;

    for (const registration of this.registrationsFor("before_compaction")) {
      if (signal?.aborted) break;

      try {
        const result = await this.call("before_compaction", registration, event, signal);

        if (result === undefined) continue;

        if (result.usage !== undefined) {
          usage = usage === undefined ? result.usage : addUsage(usage, result.usage);
        }

        if ("material" in result) return { ...result, usage };
        failures.push(result.error);
      } catch (error) {
        failures.push(normalizeError(error).message);
      }
    }

    // A later handler may recover. Cancellation must not announce a fallback.
    if (failures.length > 0 && !signal?.aborted) {
      await this.reportError(
        new Error(
          `Native compaction failed; trying a portable text summary. ${failures.join("; ")}`,
        ),
        "before_compaction",
        event.head,
      );
    }

    return failures.length > 0 ? { error: failures.join("; "), usage } : undefined;
  }

  private async beforeRequest(
    event: HookInvocation<"before_request">,
    signal: AbortSignal | undefined,
  ): Promise<HookMap["before_request"]["result"]> {
    let streamOptions = event.streamOptions;
    let changed = false;

    for (const registration of this.registrationsFor("before_request")) {
      try {
        const result = await this.call(
          "before_request",
          registration,
          { ...event, streamOptions },
          signal,
        );

        if (result?.streamOptions !== undefined) {
          streamOptions = applyStreamOptionsPatch(streamOptions, result.streamOptions);
          changed = true;
        }
      } catch (error) {
        await this.reportError(normalizeError(error), "before_request", event.head);
      }
    }

    return changed
      ? { streamOptions: createStreamOptionsPatch(event.streamOptions, streamOptions) }
      : undefined;
  }

  private async beforeTool(
    event: HookInvocation<"before_tool">,
    signal: AbortSignal | undefined,
  ): Promise<ToolCallDecision> {
    let modified: JsonObject | undefined;

    for (const registration of this.registrationsFor("before_tool")) {
      const policy = `before_tool policy${registration.id === undefined ? "" : ` ${registration.id}`}`;

      try {
        const result = toJsonValue(
          await this.call(
            "before_tool",
            registration,
            { ...event, args: modified ?? event.args },
            signal,
          ),
        );

        if (!isToolCallDecision(result)) {
          throw new Error(`${policy} returned a malformed decision for ${event.toolName}`);
        }

        switch (result.action) {
          case "continue":
            break;
          case "modify":
            modified = durableArgs(result.args, policy);
            break;
          case "reject":
          case "error":
            return result;
          default: {
            const _exhaustive: never = result;

            return _exhaustive;
          }
        }
      } catch (error) {
        const normalized = normalizeError(error);
        await this.reportError(normalized, "before_tool", event.head);

        return { action: "error", message: normalized.message };
      }
    }

    return modified === undefined ? { action: "continue" } : { action: "modify", args: modified };
  }

  private async afterTool(
    event: HookInvocation<"after_tool">,
    signal: AbortSignal | undefined,
  ): Promise<HookMap["after_tool"]["result"]> {
    let aggregate: HookMap["after_tool"]["result"];

    for (const registration of this.registrationsFor("after_tool")) {
      try {
        const result = await this.call(
          "after_tool",
          registration,
          { ...event, ...aggregate },
          signal,
        );

        if (result === undefined) continue;

        if (result.outcome !== undefined && !Value.Check(schemas.ToolOutcome, result.outcome)) {
          throw new Error(
            `after_tool hook${registration.id === undefined ? "" : ` ${registration.id}`} returned a malformed outcome for ${event.toolName}`,
          );
        }

        aggregate = { ...aggregate, ...result };
      } catch (error) {
        await this.reportError(normalizeError(error), "after_tool", event.head);
      }
    }

    return aggregate;
  }

  private async cacheWarmingDecision(
    event: HookInvocation<"cache_warming_decision">,
    signal: AbortSignal | undefined,
  ): Promise<HookMap["cache_warming_decision"]["result"]> {
    let action = event.action;

    for (const registration of this.registrationsFor("cache_warming_decision")) {
      try {
        const result = await this.call("cache_warming_decision", registration, event, signal);

        if (result?.action === "warm" || result?.action === "stop") action = result.action;
      } catch (error) {
        await this.reportError(normalizeError(error), "cache_warming_decision", event.head);
      }
    }

    return { action };
  }

  private registrationsFor<TName extends HookName>(name: TName): HookRegistration<TName>[] {
    return [...this.registrations[name]];
  }

  private call<TName extends HookName>(
    name: TName,
    registration: HookRegistration<TName>,
    event: HookInvocation<TName>,
    signal: AbortSignal | undefined,
  ): Promise<HookMap[TName]["result"]> {
    const what = `${name} hook${registration.id === undefined ? "" : ` ${registration.id}`}`;

    return withBudget({ what, ms: this.budgets[name], signal }, (budgeted) =>
      registration.handler(event, budgeted),
    );
  }
}
