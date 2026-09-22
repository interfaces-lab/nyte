/**
 * The bounded exponential-backoff retry loop for assistant calls. What counts as
 * transient is decided by the failure class in `failure.ts`.
 *
 * Based on https://github.com/earendil-works/pi/blob/dev/packages/ai/src/utils/retry.ts
 * Synced with pi 7ebf9087e.
 */
import type { AssistantMessage } from "@nyte-ai/schema";
import { classifyAssistantFailure, isRetryableFailureClass } from "./failure.ts";

/**
 * Retry policy: bounded attempts with exponential backoff (`baseDelayMs * 2^(attempt-1)`).
 * Matches `settings.retry` (`enabled`, `maxRetries`, `baseDelayMs`) in coding-agent; kept
 * here so the classifier and the policy-driven retry loop live together and stay reusable
 * by the SDK and other callers.
 */
export interface RetryPolicy {
  enabled: boolean;
  /** Max retry attempts (0 = no retries). The initial call never counts as a retry. */
  maxRetries: number;
  /** Base delay in ms. Per-attempt delay is `baseDelayMs * 2^(attempt-1)` before jitter. */
  baseDelayMs: number;
}

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
export function retryDelayMs(policy: RetryPolicy, attempt: number): number {
  return policy.baseDelayMs * 2 ** (attempt - 1);
}

class RetrySleepAbortError extends Error {
  constructor() {
    super("Aborted");
  }
}

/** Resolves after `ms`. Rejects the moment `signal` aborts, and only then. */
export function abortableSleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new RetrySleepAbortError());

      return;
    }

    const timeout = setTimeout(resolve, ms);
    signal?.addEventListener(
      "abort",
      () => {
        clearTimeout(timeout);
        reject(new RetrySleepAbortError());
      },
      { once: true },
    );
  });
}

/**
 * Run a single assistant-producing call with bounded retry on transient errors.
 *
 * Behavior:
 * - A successful response is returned immediately. Aborts are terminal and never
 *   retried, but reported as unsuccessful if they happen after a retry was scheduled.
 *   Aborts during the backoff sleep are normalized to an aborted `AssistantMessage`
 *   too, so callers do not need to care when cancellation happened.
 * - A non-retryable error (per {@link isRetryableAssistantError}, including quota/
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

    // Abort: terminal but not successful. Never retry an aborted message.
    if (response.stopReason === "aborted") {
      if (lastRetry) await callbacks?.onRetryFinished?.(false, lastRetry.attempt);

      return response;
    }

    // Success: non-error, non-abort responses return as-is.
    if (response.stopReason !== "error") {
      if (lastRetry) await callbacks?.onRetryFinished?.(true, lastRetry.attempt);

      return response;
    }

    // Non-retryable, or budget exhausted: return the final error message.
    if (attempt >= maxAttempts || !isRetryableAssistantError(response)) {
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
        return { ...response, stopReason: "aborted", errorMessage: undefined };
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
export function isRetryableAssistantError(message: AssistantMessage): boolean {
  return (
    message.stopReason === "error" &&
    isRetryableFailureClass(classifyAssistantFailure(message).class)
  );
}
