/**
 * Hooks: the points where plugin code intercepts a run and returns a typed
 * result. This file holds the contract (which hooks exist, what each sees,
 * what each may return, how results combine) and the `HookRegistry` that runs
 * handlers in registration order, applies the combining rule, and contains
 * failures.
 *
 * Hooks are a separate list from events (`events.ts`). An event listener has
 * no return value the runner reads; a hook handler does. That split is what
 * keeps an observer from becoming an interceptor by accident.
 *
 * Combining rules, per hook:
 * - `transform_context`: chained replacement of messages and system prompt.
 * - `before_request`: each patch applied in order over the stream options.
 * - `before_tool`: policies run in registration order; `modify` decisions
 *   chain and `continue` is not terminal, so no decision bypasses a later
 *   policy. The first `reject` or `error` stops the chain. A throwing handler
 *   becomes `error` (fail-closed).
 * - `after_tool`: field-wise chained patch.
 * - `before_compaction`: first provider checkpoint wins; failed attempts carry
 *   usage into later handlers or portable compaction. Only exhausted failures
 *   report a fallback warning.
 *
 * Based on https://github.com/earendil-works/pi/blob/dev/packages/agent/src/harness/agent-harness.ts (HookMap)
 * Synced with pi 7ebf9087e.
 */
import type { Context, JsonValue, Message, Usage } from "@nyte-ai/schema";
import type { ProviderCompaction } from "../kernel/compaction.ts";
import { isJsonObject, toJsonValue, type JsonObject } from "@nyte-ai/client";
import { addUsage } from "@nyte-ai/client";
import type { AgentToolResult, StreamOptions, StreamOptionsPatch } from "../kernel/loop/types.ts";

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
  transform_context: {
    event: { messages: Message[]; systemPrompt: string };
    result: { messages?: Message[]; systemPrompt?: string } | undefined;
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
  after_tool: {
    event: {
      toolCallId: string;
      toolName: string;
      args: JsonObject;
      content: AgentToolResult<unknown>["content"];
      details?: JsonValue;
      isError: boolean;
      usage?: Usage;
    };
    result:
      | {
          content?: AgentToolResult<unknown>["content"];
          details?: JsonValue;
          isError?: boolean;
          usage?: Usage;
        }
      | undefined;
  };
}

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
function isToolCallDecision(value: JsonValue): value is ToolCallDecision {
  if (!isJsonObject(value)) return false;
  switch (value.action) {
    case "continue":
      return true;
    case "modify":
      return isJsonObject(value.args);
    case "reject":
    case "error":
      return typeof value.message === "string";
    default:
      return false;
  }
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

/** The registration half of the hook API, as a plugin sees it. */
export interface Hooks {
  on<TName extends HookName>(
    name: TName,
    handler: HookHandler<TName>,
    options?: { id?: string },
  ): () => void;
}

interface HookRegistration<TName extends HookName> {
  id?: string;
  handler: HookHandler<TName>;
}

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
    before_compaction: [],
    before_request: [],
    before_tool: [],
    after_tool: [],
  };
  private readonly runners: HookRunners;
  private readonly reportError: HookErrorReporter;
  private closedError: Error | undefined;

  constructor(reportError: HookErrorReporter) {
    this.reportError = reportError;
    this.runners = {
      transform_context: (event, signal) => this.transformContext(event, signal),
      before_compaction: (event, signal) => this.beforeCompaction(event, signal),
      before_request: (event, signal) => this.beforeRequest(event, signal),
      before_tool: (event, signal) => this.beforeTool(event, signal),
      after_tool: (event, signal) => this.afterTool(event, signal),
    };
  }

  on<TName extends HookName>(
    name: TName,
    handler: HookHandler<TName>,
    options: { id?: string } = {},
  ): () => void {
    if (this.closedError !== undefined) throw this.closedError;
    const registrations = this.registrations[name];
    const registration: HookRegistration<TName> =
      options.id === undefined ? { handler } : { id: options.id, handler };
    registrations.push(registration);
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
    let systemPrompt = event.systemPrompt;
    for (const registration of this.registrationsFor("transform_context")) {
      try {
        const result = await registration.handler({ ...event, messages, systemPrompt }, signal);
        if (result?.messages !== undefined) messages = result.messages;
        if (result?.systemPrompt !== undefined) systemPrompt = result.systemPrompt;
      } catch (error) {
        await this.reportError(normalizeError(error), "transform_context", event.head);
      }
    }
    return { messages, systemPrompt };
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
        const result = await registration.handler(event, signal);
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
        const result = await registration.handler({ ...event, streamOptions }, signal);
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
          await registration.handler({ ...event, args: modified ?? event.args }, signal),
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
    let content = event.content;
    let details = event.details;
    let isError = event.isError;
    let usage = event.usage;
    const aggregate: NonNullable<HookMap["after_tool"]["result"]> = {};
    for (const registration of this.registrationsFor("after_tool")) {
      try {
        const result = await registration.handler(
          afterToolInvocation(event, content, details, isError, usage),
          signal,
        );
        if (result === undefined) continue;
        if (result.content !== undefined) aggregate.content = result.content;
        if (result.details !== undefined) aggregate.details = result.details;
        if (result.isError !== undefined) aggregate.isError = result.isError;
        if (result.usage !== undefined) aggregate.usage = result.usage;
        content = result.content ?? content;
        details = result.details ?? details;
        isError = result.isError ?? isError;
        usage = result.usage ?? usage;
      } catch (error) {
        await this.reportError(normalizeError(error), "after_tool", event.head);
      }
    }
    return Object.keys(aggregate).length === 0 ? undefined : aggregate;
  }

  private registrationsFor<TName extends HookName>(name: TName): HookRegistration<TName>[] {
    return [...this.registrations[name]];
  }
}

function afterToolInvocation(
  event: HookInvocation<"after_tool">,
  content: AgentToolResult<unknown>["content"],
  details: JsonValue | undefined,
  isError: boolean,
  usage: Usage | undefined,
): HookInvocation<"after_tool"> {
  const base = {
    head: event.head,
    runId: event.runId,
    toolCallId: event.toolCallId,
    toolName: event.toolName,
    args: event.args,
    content,
    isError,
  };
  const withDetails = details === undefined ? base : { ...base, details };
  return usage === undefined ? withDetails : { ...withDetails, usage };
}

const SCALAR_STREAM_OPTION_KEYS = [
  "maxRetries",
  "maxRetryDelayMs",
  "transport",
  "cacheRetention",
  "fast",
  "temperature",
  "maxTokens",
] as const;

export function applyStreamOptionsPatch(
  base: StreamOptions,
  patch: StreamOptionsPatch,
): StreamOptions {
  const next: StreamOptions = { ...base };
  for (const key of SCALAR_STREAM_OPTION_KEYS) {
    if (!(key in patch)) continue;
    const value = patch[key];
    if (value === undefined) delete next[key];
    else Object.assign(next, { [key]: value });
  }
  if ("headers" in patch) {
    if (patch.headers === undefined) delete next.headers;
    else {
      const headers = { ...next.headers };
      for (const [key, value] of Object.entries(patch.headers)) {
        if (value === undefined) delete headers[key];
        else headers[key] = value;
      }
      next.headers = headers;
    }
  }
  if ("samplingParams" in patch) {
    if (patch.samplingParams === undefined) delete next.samplingParams;
    else {
      const samplingParams = { ...next.samplingParams };
      for (const [key, value] of Object.entries(patch.samplingParams)) {
        if (value === undefined) delete samplingParams[key];
        else samplingParams[key] = value;
      }
      next.samplingParams = samplingParams;
    }
  }
  return next;
}

function createStreamOptionsPatch(base: StreamOptions, value: StreamOptions): StreamOptionsPatch {
  const patch: StreamOptionsPatch = {};
  for (const key of SCALAR_STREAM_OPTION_KEYS) {
    if (base[key] !== value[key]) Object.assign(patch, { [key]: value[key] });
  }
  if (base.headers !== value.headers) {
    if (value.headers === undefined) patch.headers = undefined;
    else {
      const headers: Record<string, string | undefined> = {};
      for (const key of Object.keys(base.headers ?? {})) {
        if (!(key in value.headers)) headers[key] = undefined;
      }
      for (const [key, header] of Object.entries(value.headers)) {
        if (base.headers?.[key] !== header) headers[key] = header;
      }
      if (base.headers === undefined && Object.keys(headers).length === 0) patch.headers = {};
      else if (Object.keys(headers).length !== 0) patch.headers = headers;
    }
  }
  if (base.samplingParams !== value.samplingParams) {
    if (value.samplingParams === undefined) patch.samplingParams = undefined;
    else {
      const samplingParams: NonNullable<StreamOptions["samplingParams"]> = {};
      for (const key of Object.keys(base.samplingParams ?? {})) {
        if (!(key in value.samplingParams)) samplingParams[key] = undefined;
      }
      for (const [key, samplingParamsValue] of Object.entries(value.samplingParams)) {
        if (base.samplingParams?.[key] !== samplingParamsValue)
          samplingParams[key] = samplingParamsValue;
      }
      if (base.samplingParams === undefined && Object.keys(samplingParams).length === 0)
        patch.samplingParams = {};
      else if (Object.keys(samplingParams).length !== 0) patch.samplingParams = samplingParams;
    }
  }
  return patch;
}
