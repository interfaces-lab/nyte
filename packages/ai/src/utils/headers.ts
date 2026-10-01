/**
 * Header helpers: flatten a fetch Headers object, and merge caller-supplied ProviderHeaders case-insensitively, where a later null removes an earlier header.
 *
 * Based on https://github.com/earendil-works/pi/blob/dev/packages/ai/src/utils/headers.ts
 * Synced with pi 7fbbd5f4a.
 */
import type { ProviderHeaders } from "../types.ts";

export function headersToRecord(headers: Headers) {
  return Object.fromEntries(headers.entries());
}

export function providerHeadersToRecord(
  ...headerSources: (ProviderHeaders | undefined)[]
): Record<string, string> | undefined {
  const merged = new Map<string, [string, string]>();

  for (const source of headerSources) {
    for (const [name, value] of Object.entries(source ?? {})) {
      const normalizedName = name.toLowerCase();
      merged.delete(normalizedName);

      if (value !== null) merged.set(normalizedName, [name, value]);
    }
  }

  return merged.size > 0 ? Object.fromEntries(merged.values()) : undefined;
}
