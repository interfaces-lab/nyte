/**
 * Header helpers: flatten a fetch Headers object, and merge caller-supplied ProviderHeaders case-insensitively, where a later source replaces an earlier header. A null survives the merge for SDKs that use it to suppress their defaults; the string record drops it instead. Presence checks ignore null and blank values.
 *
 * Based on https://github.com/earendil-works/pi/blob/dev/packages/ai/src/utils/headers.ts
 * Synced with pi 7fbbd5f4a.
 */
import type { ProviderHeaders } from "../types.ts";

export function headersToRecord(headers: Headers) {
  return Object.fromEntries(headers.entries());
}

export function mergeProviderHeaders(
  ...headerSources: (ProviderHeaders | undefined)[]
): ProviderHeaders {
  const merged = new Map<string, [string, string | null]>();

  for (const source of headerSources) {
    for (const [name, value] of Object.entries(source ?? {})) {
      const normalizedName = name.toLowerCase();
      merged.delete(normalizedName);
      merged.set(normalizedName, [name, value]);
    }
  }

  return Object.fromEntries(merged.values());
}

export function providerHeadersToRecord(
  ...headerSources: (ProviderHeaders | undefined)[]
): Record<string, string> | undefined {
  const entries = Object.entries(mergeProviderHeaders(...headerSources)).filter(
    (entry): entry is [string, string] => entry[1] !== null,
  );

  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

export function hasHeader(headers: ProviderHeaders | undefined, name: string): boolean {
  if (!headers) return false;
  const expected = name.toLowerCase();

  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() === expected && value !== null && value.trim().length > 0) return true;
  }

  return false;
}

/** The OpenAI SDK requires a key; a caller-supplied authorization header stands in for one. */
export function getClientApiKey(
  provider: string,
  apiKey: string | undefined,
  headers: ProviderHeaders | undefined,
): string {
  if (apiKey) return apiKey;

  if (hasHeader(headers, "authorization") || hasHeader(headers, "cf-aig-authorization"))
    return "unused";
  throw new Error(`No API key for provider: ${provider}`);
}
