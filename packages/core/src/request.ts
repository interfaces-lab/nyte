import type { Models } from "@nyte-ai/ai";
import type { RetryPolicy } from "@nyte-ai/ai/utils/retry";
import type { ModelInfo, Usage } from "@nyte-ai/schema";
import type { AssistantMessage } from "@nyte-ai/schema/model";
import type { Kernel } from "./kernel.ts";

/** The provider retry policy every request core sends follows (§38j; ai ships the loop and the backoff in `@nyte-ai/ai/utils/retry`, not the numbers): three retries of a retryable failure (`isRetryableAssistantError`: rate limit, overload, network), backing off `retryDelayMs` from 2 s, each delay capped at 60 s. */
export const RETRY_POLICY: RetryPolicy = {
  enabled: true,
  maxRetries: 3,
  baseDelayMs: 2_000,
  maxAgentDelayMs: 60_000,
};

/** Returns `PluginApi.request`: what `kernel.request(session, input)` runs. Throws `SdkError("unknown")` when the session is gone and `SdkError("invalid")` when `models.getModel` has no `input.model`. Sends one `models.completeSimple(model, context, options)` under `retryAssistantCall` (`@nyte-ai/ai/utils/retry`) with `RETRY_POLICY` and `input.signal`: `context` is `{ systemPrompt, messages }` from `input.system` and `input.messages` (no tools); with `input.output`, the system prompt gains an instruction to answer with one JSON value matching the schema's input JSON Schema (`jsonSchemaOf`), since ai carries no structured-output option (§38g); `options` has `signal`, `reasoning` from `input.thinking` (`"off"` and absent send none, ai lowering a level through the model's `thinkingLevelMap`, §38i), `maxTokens` from `input.maxOutput` and `sessionId` the session. Outcomes: a provider refusal (§38h, t: the message's `rawStopReason` equals or ends with `refusal`, `content_filter` or `SAFETY`, as OpenAI Responses' `incomplete.content_filter` does) → `refused { reason }`, never retried; an error or abort after the policy → `failed { failure }` (`classifyAssistantFailure` from `@nyte-ai/ai/utils/failure`); otherwise `ok` with `stop` `length` for a length stop and `end` else, and `value` the text content joined, or with `output` that text parsed as JSON (a surrounding code fence dropped) and validated against the schema, a parse or validation failure being `failed { failure: { class: "provider", message } }`. Every settled request (all but a pre-request throw) is charged: `usageOf(message, info)` reported to `after_request` (observe, step `plugin`, `durationMs` from the first attempt to settlement) and published as a `request` event with step `plugin`, head null and `context` `{ tokens: input + cacheRead + cacheWrite + output, window: info.contextWindow, lastRequest: usage }`, riding the session ref at its current target. */
export function createRequest(kernel: Kernel, models: Models): Kernel["request"] {
  throw new Error("not implemented");
}

/** Returns the usage a provider message reports (§38l): token counts as reported (`reasoning` null when the provider gave none, `total` the reported total or the sum of the four counts); `cost` the adapter's priced cost (`message.usage.cost`, which prices tiers, 1 h cache writes and fast mode) when its total is above zero, else each count times `info.cost` per million and their sum. Shared by `request`, the turn, compaction and summaries. */
export function usageOf(message: AssistantMessage, info: ModelInfo): Usage {
  throw new Error("not implemented");
}
