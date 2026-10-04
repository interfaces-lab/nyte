import type { ProviderHeaders } from "../types.ts";
import { providerHeadersToRecord } from "../utils/headers.ts";
import type { ProviderAuthVerification } from "./types.ts";

/**
 * GET an authenticated endpoint and read the credential verdict from its
 * status: 2xx accepts, 401/403 rejects, anything else leaves it unproven.
 */
export async function verifyWithRequest(input: {
  provider: string;
  url: string;
  headers: ProviderHeaders;
  signal: AbortSignal;
  detail?: (body: unknown) => string | undefined;
}): Promise<ProviderAuthVerification> {
  const response = await globalThis.fetch(input.url, {
    headers: providerHeadersToRecord(input.headers),
    signal: input.signal,
    redirect: "error",
  });

  if (response.status === 401 || response.status === 403) {
    await response.body?.cancel();

    return {
      ok: false,
      reason: "rejected",
      message: `${input.provider} rejected the credential (HTTP ${String(response.status)})`,
    };
  }

  if (!response.ok) {
    await response.body?.cancel();

    return {
      ok: false,
      reason: "unreachable",
      message: `${input.provider} could not verify the credential (HTTP ${String(response.status)})`,
    };
  }

  if (!input.detail) {
    await response.body?.cancel();

    return { ok: true };
  }

  const body: unknown = await response.json().catch(() => undefined);
  const detail = input.detail(body);

  return detail === undefined ? { ok: true } : { ok: true, detail };
}
