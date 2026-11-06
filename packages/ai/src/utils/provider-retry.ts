import { sleep } from "./abort.ts";

const DEFAULT_MAX_RETRY_DELAY_MS = 60_000;

interface ProviderRetryOptions {
  maxRetries?: number;
  maxRetryDelayMs?: number;
  signal?: AbortSignal;
  retryable?: (error: unknown) => boolean;
}

export class RetryDelayExceededError extends Error {}

interface ProviderError extends Error {
  status: number | undefined;
  headers: Headers | undefined;
}

function carriesHttpStatus(error: unknown): error is ProviderError {
  if (!(error instanceof Error) || !("status" in error) || !("headers" in error)) return false;

  return (
    (error.status === undefined || typeof error.status === "number") &&
    (error.headers === undefined || error.headers instanceof Headers)
  );
}

function sdkPolicyRetries(error: ProviderError): boolean {
  const shouldRetry = error.headers?.get("x-should-retry");

  if (shouldRetry === "true") return true;

  if (shouldRetry === "false") return false;

  if (error.status === undefined) return true;

  return (
    error.status === 408 || error.status === 409 || error.status === 429 || error.status >= 500
  );
}

function validateServerRetryDelayMs(
  delayMs: number,
  maxRetryDelayMs: number | undefined,
  providerErrorMessage: string,
): number {
  const maxDelayMs = maxRetryDelayMs ?? DEFAULT_MAX_RETRY_DELAY_MS;

  if (maxDelayMs > 0 && delayMs > maxDelayMs) {
    throw new RetryDelayExceededError(
      `Server requested ${Math.ceil(delayMs / 1000)}s retry delay (max: ${Math.ceil(maxDelayMs / 1000)}s). ${providerErrorMessage}`,
    );
  }

  return delayMs;
}

function getRetryDelayMs(
  error: ProviderError,
  retryIndex: number,
  maxRetryDelayMs: number | undefined,
): number {
  const retryAfterMs = error.headers?.get("retry-after-ms");

  if (retryAfterMs) {
    const value = Number.parseFloat(retryAfterMs);

    if (Number.isFinite(value))
      return validateServerRetryDelayMs(value, maxRetryDelayMs, error.message);
  }

  const retryAfter = error.headers?.get("retry-after");

  if (retryAfter) {
    const seconds = Number.parseFloat(retryAfter);
    const delayMs = Number.isNaN(seconds) ? Date.parse(retryAfter) - Date.now() : seconds * 1000;

    if (Number.isFinite(delayMs))
      return validateServerRetryDelayMs(delayMs, maxRetryDelayMs, error.message);
  }

  const exponentialDelay = Math.min(0.5 * 2 ** retryIndex, 8) * 1000;

  return exponentialDelay * (1 - Math.random() * 0.25);
}

function createAbortError(): Error {
  const error = new Error("Request aborted");
  error.name = "AbortError";

  return error;
}

export async function retryProviderRequest<T>(
  request: () => Promise<T>,
  options: ProviderRetryOptions = {},
): Promise<T> {
  const maxRetries = options.maxRetries ?? 0;
  let retriesRemaining = maxRetries;

  for (;;) {
    try {
      return await request();
    } catch (error) {
      if (options.signal?.aborted) throw createAbortError();

      if (
        retriesRemaining <= 0 ||
        !carriesHttpStatus(error) ||
        !sdkPolicyRetries(error) ||
        options.retryable?.(error) === false
      )
        throw error;

      const retryIndex = maxRetries - retriesRemaining;
      retriesRemaining--;
      await sleep(
        getRetryDelayMs(error, retryIndex, options.maxRetryDelayMs),
        options.signal,
        createAbortError,
      );
    }
  }
}
