/**
 * The bounded exponential-backoff retry loop for assistant calls. What counts as
 * transient is decided by the failure class in `failure.ts`.
 */
import type { AssistantMessage } from "@nyte-ai/schema/model";
import { sleep } from "./abort.ts";
import { classifyAssistantFailure, retryCanHelp } from "./failure.ts";

/**
 * Bounded retries with exponential backoff. `maxAgentDelayMs` defaults to 60 seconds.
 */
export interface RetryPolicy {
  enabled: boolean;
  /** Max retry attempts (0 = no retries). The initial call never counts as a retry. */
  maxRetries: number;
  /** Base delay in ms. Per-attempt delay is `baseDelayMs * 2^(attempt-1)` before jitter. */
  baseDelayMs: number;
  /** Optional cap for agent-level retry delays in ms. Defaults to 60 seconds. */
  maxAgentDelayMs?: number;
}

export const DEFAULT_MAX_AGENT_RETRY_DELAY_MS = 60_000;

/** Optional callbacks emitted by {@link retryAssistantCall} around each retry. */
export interface RetryCallbacks {
  /** Emitted before the backoff sleep of each retry attempt (1-indexed). */
  onRetryScheduled?: (
    attempt: number,
    maxAttempts: number,
    delayMs: number,
    errorMessage: string,
  ) => void | Promise<void>;
  /** Emitted after the backoff sleep, immediately before the retried call starts. */
  onRetryAttemptStart?: () => void | Promise<void>;
  /** Emitted once when the loop ends: success if a later call completed normally. */
  onRetryFinished?: (
    success: boolean,
    attempt: number,
    finalError?: string,
  ) => void | Promise<void>;
}

/**
 * Backoff before `attempt`, 1-based. The one definition: a caller that schedules its own
 * retries must compute the delay here rather than restating the formula.
 */
export function retryDelayMs(
  policy: Pick<RetryPolicy, "baseDelayMs" | "maxAgentDelayMs">,
  attempt: number,
): number {
  const delay = policy.baseDelayMs * 2 ** Math.max(0, attempt - 1);
  const safeDelay = Number.isSafeInteger(delay) ? delay : Number.MAX_SAFE_INTEGER;

  return Math.min(safeDelay, policy.maxAgentDelayMs ?? DEFAULT_MAX_AGENT_RETRY_DELAY_MS);
}

class RetrySleepAbortError extends Error {
  constructor() {
    super("Aborted");
  }
}

/** Resolves after `ms`. Rejects the moment `signal` aborts, and only then. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return sleep(ms, signal, () => new RetrySleepAbortError());
}

/**
 * Run a single assistant-producing call with bounded retry on transient errors.
 *
 * Behavior:
 * - A successful response is returned immediately. Aborts are terminal and never
 *   retried, but reported as unsuccessful if they happen after a retry was scheduled.
 *   Aborts during the backoff sleep are normalized to an aborted `AssistantMessage`
 *   too, so callers do not need to care when cancellation happened.
 * - A non-retryable error (per {@link failedTransiently}, including quota/
 *   billing exhaustion) is returned immediately so deterministic errors fail fast.
 * - Otherwise retries up to `maxRetries` times with exponential backoff, emitting
 *   `onRetryScheduled` before each sleep, `onRetryAttemptStart` after each sleep before
 *   the retried call starts, and `onRetryFinished` once at the end (whether the loop
 *   ends in success, exhausted retries, or an aborted backoff).
 *
 * When `policy` is undefined or disabled, the first response is returned unchanged
 * (equivalent to calling `produce()` directly).
 */
export async function retryAssistantCall(
  produce: () => Promise<AssistantMessage>,
  policy: RetryPolicy | undefined,
  signal: AbortSignal | undefined,
  callbacks?: RetryCallbacks,
): Promise<AssistantMessage> {
  const maxAttempts = policy?.enabled ? policy.maxRetries : 0;

  let attempt = 0;
  let lastRetry: { attempt: number; errorMessage: string } | undefined;

  for (;;) {
    const response = await produce();

    if (response.stopReason === "aborted") {
      if (lastRetry) await callbacks?.onRetryFinished?.(false, lastRetry.attempt);

      return response;
    }

    if (response.stopReason !== "error") {
      if (lastRetry) await callbacks?.onRetryFinished?.(true, lastRetry.attempt);

      return response;
    }

    if (attempt >= maxAttempts || !failedTransiently(response)) {
      if (lastRetry)
        await callbacks?.onRetryFinished?.(false, lastRetry.attempt, response.errorMessage);

      return response;
    }

    attempt++;
    lastRetry = { attempt, errorMessage: response.errorMessage || "Unknown error" };
    const delayMs = retryDelayMs(policy!, attempt);
    await callbacks?.onRetryScheduled?.(attempt, maxAttempts, delayMs, lastRetry.errorMessage);

    // Normalize aborts during retry backoff to the same AssistantMessage shape as
    // provider stream aborts, so callers do not need to care when cancellation happened.
    try {
      await abortableSleep(delayMs, signal);
    } catch (error) {
      await callbacks?.onRetryFinished?.(false, attempt, lastRetry.errorMessage);

      if (error instanceof RetrySleepAbortError) {
        const { errorMessage: _errorMessage, ...rest } = response;

        return { ...rest, stopReason: "aborted" };
      }

      throw error;
    }

    await callbacks?.onRetryAttemptStart?.();
  }
}

/**
 * Whether a failed assistant message looks like a transient provider or
 * transport error, as a function of its failure class. Callers handle context
 * overflow first and own their retry budget, backoff, and reporting.
 */
export function failedTransiently(message: AssistantMessage): boolean {
  return message.stopReason === "error" && retryCanHelp(classifyAssistantFailure(message).class);
}
