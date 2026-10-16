import { contentText } from "@nyte-ai/schema/model";
import type {
  Api,
  AssistantMessage,
  Context,
  Failure,
  Message,
  Model,
  ProviderCheckpointMaterial,
  Tool,
} from "@nyte-ai/schema/model";
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
import { retryAssistantCall } from "@nyte-ai/ai/utils/retry";
import type { RetryPolicy } from "@nyte-ai/ai/utils/retry";
import { calculateCost } from "@nyte-ai/ai";
import type { Models } from "@nyte-ai/ai";
import { classifyAssistantFailure } from "@nyte-ai/ai/utils/failure";
import { LOCAL } from "../contract/host.ts";
import type { HookContext, Kernel, PluginRuntime, ToolSource } from "../contract/kernel.ts";
import { decodeRunRecord } from "../contract/records.ts";
import type { RunRecord } from "../contract/records.ts";
import { modelInfo, withLimits } from "../extend/models.ts";
import { commit } from "../fold/commit.ts";
import { runRef, sessionRef } from "../store/refs.ts";
import { attempt, load, put, requireSession, STALE } from "../store/session.ts";
import { dev } from "../util/dev-log.ts";
import { SdkError } from "../util/error.ts";
import { check, convertJsonSchema } from "../util/json-schema.ts";

interface Completed {
  readonly message: AssistantMessage;
  readonly usage: Usage;
  readonly info: ModelInfo;

  readonly failure: Failure | null;
}

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

/** A response's usage as runs record it: the adapter's price, or the model's own rates when the adapter left it unpriced. */
export function calculateUsage(message: AssistantMessage, model: Model<Api>): Usage {
  const reported = message.usage;
  const { input, output, cacheRead, cacheWrite } = reported;

  const cost =
    reported.cost.total > 0
      ? reported.cost
      : calculateCost(model, { ...reported, cost: { ...reported.cost } });

  return {
    input,
    output,
    cacheRead,
    cacheWrite,
    reasoning: reported.reasoning ?? null,
    total:
      reported.totalTokens > 0 ? reported.totalTokens : input + output + cacheRead + cacheWrite,
    cost: {
      input: cost.input,
      output: cost.output,
      cacheRead: cost.cacheRead,
      cacheWrite: cost.cacheWrite,
      total: cost.total,
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

export function charge(record: RunRecord, usage: Usage | null, requested: boolean): RunRecord {
  return {
    ...record,
    usage: usage === null ? record.usage : addUsage(record.usage ?? ZERO_USAGE, usage),
    requests: record.requests + (requested ? 1 : 0),
  };
}

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
  const info = modelInfo(models, request.model, runtime);

  if (model === undefined || info === null) return null;
  dev("request", "start", { session: where.session, model: model.id, step: input.step });

  const send = async (): Promise<AssistantMessage> => {
    const started = Date.now();

    const message = await withLimits(kernel, models, model.provider, () =>
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
    );

    const usage = calculateUsage(message, model);
    dev("request", "end", {
      session: where.session,
      stop: message.stopReason,
      tokens: usage.total,
    });

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

    if (isFailedResponse(message))
      await chargeFailed(kernel, where, requestEvent(where.head, input.step, usage, info), usage);

    return message;
  };

  const message = await retryAssistantCall(send, RETRY_POLICY, signal, {
    onRetryScheduled: (attempt, _max, ms) => dev("request", "retry", { attempt, ms }),
  });

  return {
    message,
    usage: calculateUsage(message, model),
    info,
    failure: isFailedResponse(message) ? classifyAssistantFailure(message) : null,
  };
}

function isFailedResponse(message: AssistantMessage): boolean {
  return message.stopReason === "error" || message.stopReason === "aborted";
}

async function chargeFailed(
  kernel: Kernel,
  where: HookContext,
  event: DurableEvent,
  usage: Usage,
): Promise<void> {
  const { session, run } = where;

  if (run === null) return rideRef(kernel, sessionRef(session), event);

  await attempt(`Charging run ${run}`, async () => {
    const found = await load(
      kernel,
      await kernel.store.refs.get(runRef(session, run)),
      decodeRunRecord,
    );

    if (found === null) return undefined;

    const outcome = await commit(kernel, [
      {
        name: found.ref.name,
        target: await put(kernel, "run", charge(found.record, usage, true)),
        expect: found.ref.revision,
        event,
      },
    ]);

    return outcome.kind === "set" ? undefined : STALE;
  });
}

const REFUSALS = ["refusal", "content_filter", "SAFETY"] as const;

export function createRequest(kernel: Kernel, models: Models): Kernel["request"] {
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
            `Answer with one JSON value and nothing else. It must match this JSON Schema:\n${JSON.stringify(convertJsonSchema(output, "input"))}`,
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

    if (failure === null)
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
