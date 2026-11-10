import { contentText } from "@nyte-ai/schema/model";
import type {
  Api,
  AssistantMessage,
  Context,
  Message,
  Model,
  ProviderCheckpointMaterial,
  Tool,
} from "@nyte-ai/schema/model";
import { SdkError } from "@nyte-ai/schema";
import type {
  DurableEvent,
  Failure,
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
import { check, convertJsonSchema } from "../util/json-schema.ts";
import { addUsage, ZERO_USAGE } from "../util/usage.ts";
import type { OutagePolicy } from "./agent-loop.ts";

interface Answered {
  readonly message: AssistantMessage;
  readonly usage: Usage;
  readonly failure: Failure | null;
}

interface Completed extends Answered {
  readonly info: ModelInfo;
}

interface Asked {
  readonly request: Pick<ModelRequest, "model" | "thinking" | "options">;
  readonly system: string | undefined;
  readonly messages: readonly Message[];
  readonly maxOutput?: number;
  readonly signal?: AbortSignal;
}

export const RETRY_POLICY: RetryPolicy = {
  enabled: true,
  maxRetries: 3,
  baseDelayMs: 2_000,
  maxAgentDelayMs: 60_000,
};

export const OUTAGE_POLICY: OutagePolicy = { budgetMs: 3_600_000, maxDelayMs: 30_000 };

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
    model: info.ref,
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
      (await commit(kernel, [{ name, target: ref.target, expect: ref.revision, events: [event] }]))
        .kind === "set"
    )
      return;
  }
}

export async function complete(
  kernel: Kernel,
  models: Models,
  runtime: PluginRuntime,
  input: Asked & {
    readonly where: HookContext;
    readonly step: "compaction" | "summary" | "plugin";
  },
): Promise<Completed | null> {
  const { request, where } = input;
  const model = models.getModel(request.model.provider, request.model.id);
  const info = modelInfo(models, request.model, runtime);

  if (model === undefined || info === null) return null;
  dev("request", "start", { session: where.session, model: model.id, step: input.step });

  const message = await exchange(kernel, models, model, where.session, input, async (sent) => {
    void runtime.hooks.observe(
      "after_request",
      {
        model: request.model,
        thinking: request.thinking,
        usage: sent.usage,
        durationMs: sent.durationMs,
        step: input.step,
      },
      where,
    );

    if (unanswered(sent.message))
      await chargeFailed(
        kernel,
        where,
        requestEvent(where.head, input.step, sent.usage, info),
        sent.usage,
      );
  });

  return { ...answered(message, model), info };
}

async function exchange(
  kernel: Kernel,
  models: Models,
  model: Model<Api>,
  session: SessionId | null,
  input: Asked,
  attempted: (sent: {
    readonly message: AssistantMessage;
    readonly usage: Usage;
    readonly durationMs: number;
  }) => Promise<void>,
): Promise<AssistantMessage> {
  const { request, signal } = input;

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
          sessionId: session ?? undefined,
        },
      ),
    );

    const usage = calculateUsage(message, model);
    dev("request", "end", { session, stop: message.stopReason, tokens: usage.total });
    await attempted({ message, usage, durationMs: Date.now() - started });

    return message;
  };

  return retryAssistantCall(send, RETRY_POLICY, signal, {
    onRetryScheduled: (attempt, _max, ms) => dev("request", "retry", { attempt, ms }),
  });
}

function answered(message: AssistantMessage, model: Model<Api>): Answered {
  return {
    message,
    usage: calculateUsage(message, model),
    failure: unanswered(message) ? classifyAssistantFailure(message) : null,
  };
}

function unanswered(message: AssistantMessage): boolean {
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
      kernel.store,
      await kernel.store.refs.get(runRef(session, run)),
      decodeRunRecord,
    );

    if (found === null) return undefined;

    const outcome = await commit(kernel, [
      {
        name: found.ref.name,
        target: await put(kernel.store, "run", charge(found.record, usage, true)),
        expect: found.ref.revision,
        events: [event],
      },
    ]);

    return outcome.kind === "set" ? undefined : STALE;
  });
}

const REFUSALS = ["refusal", "content_filter", "SAFETY"] as const;

export function createRequest(kernel: Kernel, models: Models): Kernel["request"] {
  function request<T>(
    session: SessionId | null,
    input: ModelRequestInput<T>,
  ): Promise<ModelRequestOutcome<T>>;
  async function request(
    session: SessionId | null,
    input: ModelRequestInput<unknown>,
  ): Promise<ModelRequestOutcome<unknown>> {
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

    const asked: Asked = {
      request: { model: input.model, thinking, options: { sampling: {}, headers: {} } },
      system,
      messages: input.messages,
      maxOutput: input.maxOutput,
      signal: input.signal,
    };

    const sent =
      session === null
        ? await answerAlone(kernel, models, asked)
        : await answerIn(kernel, models, session, asked);

    if (sent === null)
      throw new SdkError(
        "invalid",
        `No model ${input.model.provider}/${input.model.id} is in the catalog.`,
      );

    const { message, usage, failure } = sent;
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

async function answerIn(
  kernel: Kernel,
  models: Models,
  session: SessionId,
  asked: Asked,
): Promise<Answered | null> {
  await requireSession(kernel.store, session);

  const sent = await complete(kernel, models, kernel.plugins.runtime(session), {
    ...asked,
    where: { session, head: null, run: null, principal: LOCAL },
    step: "plugin",
  });

  if (sent !== null && sent.failure === null)
    await rideRef(kernel, sessionRef(session), requestEvent(null, "plugin", sent.usage, sent.info));

  return sent;
}

async function answerAlone(kernel: Kernel, models: Models, asked: Asked): Promise<Answered | null> {
  const model = models.getModel(asked.request.model.provider, asked.request.model.id);

  if (model === undefined) return null;
  dev("request", "start", { session: null, model: model.id, step: "plugin" });

  return answered(await exchange(kernel, models, model, null, asked, async () => undefined), model);
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
