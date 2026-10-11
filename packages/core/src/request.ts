import type { Models } from "@nyte-ai/ai";
import { classifyAssistantFailure } from "@nyte-ai/ai/utils/failure";
import { retryAssistantCall } from "@nyte-ai/ai/utils/retry";
import type { RetryPolicy } from "@nyte-ai/ai/utils/retry";
import type {
  DurableEvent,
  HeadName,
  ModelInfo,
  ModelRequestInput,
  ModelRequestOutcome,
  SessionId,
  Usage,
} from "@nyte-ai/schema";
import type { AssistantMessage } from "@nyte-ai/schema/model";
import { jsonSchemaOf } from "./catalog.ts";
import { dev } from "./dev-log.ts";
import { SdkError } from "./error.ts";
import { check } from "./json-schema.ts";
import type { Kernel } from "./kernel.ts";
import { modelInfo, withLimits } from "./models.ts";
import { LOCAL } from "./principals.ts";
import { sessionRef } from "./refs.ts";
import { commit, requireSession } from "./session-state.ts";

/** The raw stop reasons a provider refuses with (§38h, t): a reason that equals or ends with one is a refusal. */
const REFUSALS = ["refusal", "content_filter", "SAFETY"] as const;

/** The provider retry policy every request core sends follows (§38j; ai ships the loop and the backoff in `@nyte-ai/ai/utils/retry`, not the numbers): three retries of a retryable failure (`isRetryableAssistantError`: rate limit, overload, network), backing off `retryDelayMs` from 2 s, each delay capped at 60 s. */
export const RETRY_POLICY: RetryPolicy = {
  enabled: true,
  maxRetries: 3,
  baseDelayMs: 2_000,
  maxAgentDelayMs: 60_000,
};

/** Returns `PluginApi.request`: what `kernel.request(session, input)` runs. Throws `SdkError("unknown")` when the session is gone and `SdkError("invalid")` when `models.getModel` has no `input.model`. Sends one `models.completeSimple(model, context, options)`, each attempt through `withLimits` (a response that changed the provider's account limits moves the catalog generation), under `retryAssistantCall` (`@nyte-ai/ai/utils/retry`) with `RETRY_POLICY` and `input.signal`: `context` is `{ systemPrompt, messages }` from `input.system` and `input.messages` (no tools); with `input.output`, the system prompt gains an instruction to answer with one JSON value matching the schema's input JSON Schema (`jsonSchemaOf`), since ai carries no structured-output option (§38g); `options` has `signal`, `reasoning` from `input.thinking` (`"off"` and absent send none, ai lowering a level through the model's `thinkingLevelMap`, §38i), `maxTokens` from `input.maxOutput` and `sessionId` the session. Outcomes: a provider refusal (§38h, t: the message's `rawStopReason` equals or ends with `refusal`, `content_filter` or `SAFETY`, as OpenAI Responses' `incomplete.content_filter` does) → `refused { reason }`, never retried; an error or abort after the policy → `failed { failure }` (`classifyAssistantFailure` from `@nyte-ai/ai/utils/failure`); otherwise `ok` with `stop` `length` for a length stop and `end` else, and `value` the text content joined, or with `output` that text parsed as JSON (a surrounding code fence dropped) and validated against the schema, a parse or validation failure being `failed { failure: { class: "provider", message } }`. Every settled request (all but a pre-request throw) is charged: `usageOf(message, info)` reported to `after_request` (observe, step `plugin`, `durationMs` from the first attempt to settlement) and published as a `request` event with step `plugin`, head null and `context` `{ tokens: input + cacheRead + cacheWrite + output, window: info.contextWindow, lastRequest: usage }`, riding the session ref at its current target. */
export function createRequest(kernel: Kernel, models: Models): Kernel["request"] {
  /** Without `output`, `T` is the default `string` and the text is returned as it: the one unchecked widening of a request, like `Durable.memo`'s (§34a). */
  function request<T>(
    session: SessionId,
    input: ModelRequestInput<T>,
  ): Promise<ModelRequestOutcome<T>>;
  async function request(
    session: SessionId,
    input: ModelRequestInput<unknown>,
  ): Promise<ModelRequestOutcome<unknown>> {
    await requireSession(kernel, session);
    const model = models.getModel(input.model.provider, input.model.id);
    const info = await modelInfo(kernel, models, input.model, session);

    if (model === undefined || info === null)
      throw new SdkError(
        "invalid",
        `No model ${input.model.provider}/${input.model.id} is in the catalog.`,
      );

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

    const started = Date.now();
    dev("request", "start", { session, model: input.model.id, thinking });

    const message = await retryAssistantCall(
      () =>
        withLimits(kernel, models, model.provider, () =>
          models.completeSimple(
            model,
            { systemPrompt: system, messages: [...input.messages] },
            {
              signal: input.signal,
              reasoning: thinking === "off" ? undefined : thinking,
              maxTokens: input.maxOutput,
              sessionId: session,
            },
          ),
        ),
      RETRY_POLICY,
      input.signal,
      { onRetryScheduled: (attempt, _max, ms) => dev("request", "retry", { attempt, ms }) },
    );

    const usage = usageOf(message, info);
    dev("request", "end", { session, stop: message.stopReason, tokens: usage.total });

    void kernel
      .runtimes()
      .get(session)
      ?.hooks.observe(
        "after_request",
        { model: input.model, thinking, usage, durationMs: Date.now() - started, step: "plugin" },
        { session, head: null, run: null, principal: LOCAL },
      );

    await rideRef(kernel, sessionRef(session), requestEvent(null, "plugin", usage, info));
    const refusal = refusalOf(message);

    if (refusal !== null) return { kind: "refused", reason: refusal };

    if (message.stopReason === "error" || message.stopReason === "aborted") {
      dev("request", "failed", { session, class: classifyAssistantFailure(message).class });

      return { kind: "failed", failure: classifyAssistantFailure(message) };
    }

    const stop = message.stopReason === "length" ? "length" : "end";
    const text = textOf(message);

    if (output === undefined) return { kind: "ok", value: text, usage, stop };
    const parsed = parseJson(text);

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

/** Returns the usage a provider message reports (§38l): token counts as reported (`reasoning` null when the provider gave none, `total` the reported total or the sum of the four counts); `cost` the adapter's priced cost (`message.usage.cost`, which prices tiers, 1 h cache writes and fast mode) when its total is above zero, else each count times `info.cost` per million and their sum. Shared by `request`, the turn, compaction and summaries. */
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

/** Returns two usages summed: what a run's total adds each request it is charged into. */
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

/** Returns the `request` event one settled request publishes: its usage and step on `head` (null for every head), with the context it leaves: `tokens` the input, cache and output tokens it reported, against the model's window. */
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

/** Publishes an event riding a ref at its current target, read again once when the ref moved meanwhile; nothing is published when the ref is gone or moves twice. */
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

/** Returns why the provider refused, or null when it did not. */
function refusalOf(message: AssistantMessage): string | null {
  const raw = message.rawStopReason;

  if (raw === undefined || !REFUSALS.some((reason) => raw === reason || raw.endsWith(reason)))
    return null;

  return message.errorMessage ?? `The provider refused to answer (${raw}).`;
}

/** Returns a message's text content joined. */
function textOf(message: AssistantMessage): string {
  return message.content.flatMap((block) => (block.type === "text" ? [block.text] : [])).join("");
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
