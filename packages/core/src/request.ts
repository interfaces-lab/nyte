import type { Models } from "@nyte-ai/ai";
import { classifyAssistantFailure } from "@nyte-ai/ai/utils/failure";
import { retryAssistantCall } from "@nyte-ai/ai/utils/retry";
import type { RetryPolicy } from "@nyte-ai/ai/utils/retry";
import type {
  DurableEvent,
  HeadName,
  ModelInfo,
  ModelRequest,
  ModelRequestInput,
  ModelRequestOutcome,
  SessionId,
  Transcript,
  Usage,
} from "@nyte-ai/schema";
import { contentText } from "@nyte-ai/schema/model";
import type {
  AssistantMessage,
  Context,
  Failure,
  Message,
  ProviderCheckpointMaterial,
  Tool,
} from "@nyte-ai/schema/model";
import { jsonSchemaOf } from "./catalog.ts";
import { dev } from "./dev-log.ts";
import { SdkError } from "./error.ts";
import type { HookContext } from "./hooks.ts";
import { check } from "./json-schema.ts";
import type { Kernel } from "./kernel.ts";
import { modelInfo, withLimits } from "./models.ts";
import type { PluginRuntime } from "./plugin-runtime.ts";
import { LOCAL } from "./principals.ts";
import type { RunRecord } from "./records.ts";
import { sessionRef } from "./refs.ts";
import { commit, requireSession } from "./session-state.ts";
import type { ToolSource } from "./tool-runner.ts";

/** Returns a sent request's response, the usage it was charged and its model's info. */
interface Completed {
  readonly message: AssistantMessage;
  readonly usage: Usage;
  readonly info: ModelInfo;
  /** Why the request failed after its retries, or null. */
  readonly failure: Failure | null;
}

/** The provider retry policy every request core sends follows (§38j). */
export const RETRY_POLICY: RetryPolicy = {
  enabled: true,
  maxRetries: 3,
  baseDelayMs: 2_000,
  maxAgentDelayMs: 60_000,
};

export const ZERO_USAGE: Usage = {
  input: 0,
  output: 0,
  cacheRead: 0,
  cacheWrite: 0,
  reasoning: null,
  total: 0,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** Returns the usage a provider message reports (§38l): counts as reported, `cost` the adapter's priced cost when above zero, else priced at `info.cost` per million. */
export function usageOf(message: AssistantMessage, info: ModelInfo): Usage {
  const reported = message.usage;
  const { input, output, cacheRead, cacheWrite } = reported;
  const rates = info.cost;

  const priced = {
    input: (input * rates.input) / 1_000_000,
    output: (output * rates.output) / 1_000_000,
    cacheRead: (cacheRead * rates.cacheRead) / 1_000_000,
    cacheWrite: (cacheWrite * rates.cacheWrite) / 1_000_000,
  };

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    reasoning: reported.reasoning ?? null,
    total:
      reported.totalTokens > 0 ? reported.totalTokens : input + output + cacheRead + cacheWrite,
    cost:
      reported.cost.total > 0
        ? {
            input: reported.cost.input,
            output: reported.cost.output,
            cacheRead: reported.cost.cacheRead,
            cacheWrite: reported.cost.cacheWrite,
            total: reported.cost.total,
          }
        : {
            ...priced,
            total: priced.input + priced.output + priced.cacheRead + priced.cacheWrite,
          },
  };
}

export function addUsage(left: Usage, right: Usage): Usage {
  return {
    input: left.input + right.input,
    output: left.output + right.output,
    cacheRead: left.cacheRead + right.cacheRead,
    cacheWrite: left.cacheWrite + right.cacheWrite,
    reasoning:
      left.reasoning === null && right.reasoning === null
        ? null
        : (left.reasoning ?? 0) + (right.reasoning ?? 0),
    total: left.total + right.total,
    cost: {
      input: left.cost.input + right.cost.input,
      output: left.cost.output + right.cost.output,
      cacheRead: left.cost.cacheRead + right.cost.cacheRead,
      cacheWrite: left.cost.cacheWrite + right.cost.cacheWrite,
      total: left.cost.total + right.cost.total,
    },
  };
}

/** Returns a run record charged one request's usage, its `requests` bumped when the request publishes a `request` event (§38v, w). */
export function charge(record: RunRecord, usage: Usage | null, requested: boolean): RunRecord {
  return {
    ...record,
    usage: usage === null ? record.usage : addUsage(record.usage ?? ZERO_USAGE, usage),
    requests: record.requests + (requested ? 1 : 0),
  };
}

/** Returns the `request` event one charged request publishes on `head` (null for every head), with the context it leaves against the model's window. */
export function requestEvent(
  head: HeadName | null,
  step: Extract<DurableEvent, { readonly kind: "request" }>["step"],
  usage: Usage,
  info: ModelInfo,
): DurableEvent {
  return {
    head,
    kind: "request",
    usage,
    step,
    context: {
      tokens: usage.input + usage.cacheRead + usage.cacheWrite + usage.output,
      window: info.contextWindow,
      lastRequest: usage,
    },
  };
}

/** Publishes an event riding a ref at its current target; nothing when the ref is gone or moves twice. */
export async function rideRef(kernel: Kernel, name: string, event: DurableEvent): Promise<void> {
  for (let tries = 0; tries < 2; tries += 1) {
    const ref = await kernel.store.refs.get(name);

    if (ref === null || ref.target === null) return;

    if (
      (await commit(kernel, [{ name, target: ref.target, expect: ref.revision, event }])).kind ===
      "set"
    )
      return;
  }
}

/** Sends one model request outside a turn: each attempt through `withLimits` under `RETRY_POLICY`, `after_request` observed on `runtime`. Null when the catalog lacks the model. */
export async function complete(
  kernel: Kernel,
  models: Models,
  runtime: PluginRuntime,
  input: {
    readonly where: HookContext;
    readonly step: "compaction" | "summary" | "plugin";
    readonly request: Pick<ModelRequest, "model" | "thinking" | "options">;
    readonly system: string | undefined;
    readonly messages: readonly Message[];
    readonly maxOutput?: number;
    readonly signal?: AbortSignal;
  },
): Promise<Completed | null> {
  const { request, where, signal } = input;
  const model = models.getModel(request.model.provider, request.model.id);
  const info = await modelInfo(kernel, models, request.model, runtime);

  if (model === undefined || info === null) return null;
  const started = Date.now();
  dev("request", "start", { session: where.session, model: model.id, step: input.step });

  const message = await retryAssistantCall(
    () =>
      withLimits(kernel, models, model.provider, () =>
        models.completeSimple(
          model,
          { systemPrompt: input.system, messages: [...input.messages] },
          {
            signal,
            reasoning: request.thinking === "off" ? undefined : request.thinking,
            samplingParams: { ...request.options.sampling },
            headers: { ...request.options.headers },
            maxTokens: input.maxOutput,
            sessionId: where.session,
          },
        ),
      ),
    RETRY_POLICY,
    signal,
    { onRetryScheduled: (attempt, _max, ms) => dev("request", "retry", { attempt, ms }) },
  );

  const usage = usageOf(message, info);
  dev("request", "end", { session: where.session, stop: message.stopReason, tokens: usage.total });

  void runtime.hooks.observe(
    "after_request",
    {
      model: request.model,
      thinking: request.thinking,
      usage,
      durationMs: Date.now() - started,
      step: input.step,
    },
    where,
  );

  const failed = message.stopReason === "error" || message.stopReason === "aborted";

  return { message, usage, info, failure: failed ? classifyAssistantFailure(message) : null };
}

const REFUSALS = ["refusal", "content_filter", "SAFETY"] as const;

/**
 * Returns `PluginApi.request`: one `completeSimple` under `RETRY_POLICY`, charged as a `request`
 * event with step `plugin`. A provider refusal (§38h) is `refused`; with `output` the system prompt
 * asks for JSON matching the schema and the answer is parsed and validated (§38g).
 */
export function createRequest(kernel: Kernel, models: Models): Kernel["request"] {
  /** Without `output`, `T` is the default `string`: the one unchecked widening of a request (§34a). */
  function request<T>(
    session: SessionId,
    input: ModelRequestInput<T>,
  ): Promise<ModelRequestOutcome<T>>;
  async function request(
    session: SessionId,
    input: ModelRequestInput<unknown>,
  ): Promise<ModelRequestOutcome<unknown>> {
    await requireSession(kernel, session);
    const thinking = input.thinking ?? "off";
    const output = input.output;

    const system =
      output === undefined
        ? input.system
        : [
            input.system,
            `Answer with one JSON value and nothing else. It must match this JSON Schema:\n${JSON.stringify(jsonSchemaOf(output, "input"))}`,
          ]
            .filter((part) => part !== undefined && part !== "")
            .join("\n\n");

    const sent = await complete(kernel, models, kernel.pluginsFor(session), {
      where: { session, head: null, run: null, principal: LOCAL },
      step: "plugin",
      request: { model: input.model, thinking, options: { sampling: {}, headers: {} } },
      system,
      messages: input.messages,
      maxOutput: input.maxOutput,
      signal: input.signal,
    });

    if (sent === null)
      throw new SdkError(
        "invalid",
        `No model ${input.model.provider}/${input.model.id} is in the catalog.`,
      );

    const { message, usage, info, failure } = sent;
    await rideRef(kernel, sessionRef(session), requestEvent(null, "plugin", usage, info));
    const raw = message.rawStopReason;

    if (raw !== undefined && REFUSALS.some((reason) => raw === reason || raw.endsWith(reason)))
      return {
        kind: "refused",
        reason: message.errorMessage ?? `The provider refused to answer (${raw}).`,
      };

    if (failure !== null) return { kind: "failed", failure };
    const stop = message.stopReason === "length" ? "length" : "end";
    const said = contentText(message.content, "");

    if (output === undefined) return { kind: "ok", value: said, usage, stop };
    const parsed = parseJson(said);

    if (parsed === null)
      return { kind: "failed", failure: { class: "provider", message: "The answer is not JSON." } };
    const checked = await check(output, parsed.value);

    if (checked.kind === "invalid")
      return {
        kind: "failed",
        failure: {
          class: "provider",
          message: `The answer fails the output schema: ${checked.issues.map((found) => found.message).join("; ")}`,
        },
      };

    return { kind: "ok", value: checked.value, usage, stop };
  }

  return request;
}

/** Returns the JSON a text holds, a surrounding code fence dropped, or null when it is not JSON. */
function parseJson(text: string): { readonly value: unknown } | null {
  const trimmed = text.trim();
  const fenced = /^```[\w-]*\s*\n([\s\S]*?)\n?```$/.exec(trimmed);

  try {
    const value: unknown = JSON.parse(fenced === null ? trimmed : fenced[1]);

    return { value };
  } catch {
    return null;
  }
}

/**
 * Lowers a transcript to ai's request `Context`: the tools ride the leading system message as
 * `toolsAdded`, each with its JSON Schema and, when its definition has a `grammar`, constrained
 * sampling; `checkpoint` is set when given (§38e).
 */
export function providerContext(
  transcript: Transcript,
  source: ToolSource,
  checkpoint: ProviderCheckpointMaterial | null,
): Context {
  const tools = transcript.tools.map((info): Tool => {
    const grammar = source.get(info.name)?.definition.grammar;

    const declared: Tool = {
      name: info.name,
      description: info.description,
      parameters: info.parameters,
    };

    if (grammar === undefined) return declared;

    return {
      ...declared,
      constrainedSampling: {
        type: "grammar",
        variants:
          grammar.kind === "lark"
            ? { openai_lark: grammar.source }
            : { openai_regex: grammar.pattern },
      },
    };
  });

  const [first, ...rest] = transcript.messages;

  const messages: Message[] =
    tools.length === 0
      ? [...transcript.messages]
      : first?.role === "system"
        ? [{ ...first, toolsAdded: [...(first.toolsAdded ?? []), ...tools] }, ...rest]
        : [
            { role: "system", content: "", toolsAdded: tools, timestamp: 0 },
            ...transcript.messages,
          ];

  return checkpoint === null ? { messages } : { messages, checkpoint };
}
