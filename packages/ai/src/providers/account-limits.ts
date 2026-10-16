/**
 * What every provider's subscription-window reader shares: the normalized window and the
 * account usage request.
 */
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import type { AccountLimitWindow, AccountLimitsFetchOptions } from "../types.ts";

/** One window with its percent clamped to 0..100; absent reset and length stay absent. */
export function limitWindow(
  id: string,
  label: string,
  usedPercent: number,
  resetsAt: number | undefined,
  windowMinutes: number | undefined,
): AccountLimitWindow {
  const window: AccountLimitWindow = {
    id,
    label,
    usedPercent: Math.max(0, Math.min(100, usedPercent)),
  };

  if (resetsAt !== undefined) window.resetsAt = resetsAt;

  if (windowMinutes !== undefined) window.windowMinutes = windowMinutes;

  return window;
}

/**
 * GETs a provider's account usage endpoint and decodes the body against `schema`. `label` names
 * the provider in errors; a positive `timeoutMs` bounds the whole request.
 */
export async function fetchAccountUsage<T extends TSchema>(
  url: string,
  headers: Headers,
  options: AccountLimitsFetchOptions | undefined,
  schema: T,
  label: string,
): Promise<Static<T>> {
  const timeoutSignal =
    options?.timeoutMs !== undefined && options.timeoutMs > 0
      ? AbortSignal.timeout(Math.floor(options.timeoutMs))
      : undefined;
  const signal = AbortSignal.any(
    [options?.signal, timeoutSignal].filter((candidate) => candidate !== undefined),
  );
  const response = await (options?.fetch ?? globalThis.fetch)(url, {
    method: "GET",
    headers,
    signal,
  });

  if (!response.ok) {
    const text = await response.text().catch(() => "");
    throw new Error(
      `${label} usage request failed (${String(response.status)}): ${text || response.statusText}`,
    );
  }

  const decoded: unknown = await response.json();

  if (!Value.Check(schema, decoded)) throw new Error(`${label} usage response was not an object`);

  return decoded;
}
