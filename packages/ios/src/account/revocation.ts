import { releaseOnHost, RELEASE_TIMEOUT_MS } from "@nyte-ai/connect/enrollment";
import type { Release } from "@nyte-ai/connect/enrollment";

export { releaseOnHost, RELEASE_TIMEOUT_MS } from "@nyte-ai/connect/enrollment";

import type { BrokerClient } from "@nyte-ai/connect";
import type { ManagedConnection, SavedConnection } from "../connection/connection.ts";

type Fetch = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

export interface ReleaseReport {
  readonly host: Release;
  readonly broker: Release | "skipped";
}

export function releaseReplaced(input: {
  readonly replaced: SavedConnection | undefined;
  readonly next: SavedConnection;
  readonly fetch: Fetch;
}): void {
  const { replaced } = input;

  if (replaced?.kind !== "managed" || replaced.connection.token === input.next.connection.token)
    return;
  void releaseOnHost({
    connection: replaced.connection,
    fetch: input.fetch,
    timeoutMs: RELEASE_TIMEOUT_MS,
  });
}

export async function releaseDevice(input: {
  readonly saved: ManagedConnection;
  readonly broker: BrokerClient | undefined;
  readonly fetch: Fetch;
  readonly timeoutMs: number;
}): Promise<ReleaseReport> {
  const broker = input.broker === undefined ? "skipped" : await revoke(input.broker, input);

  const host = await releaseOnHost({
    connection: input.saved.connection,
    fetch: input.fetch,
    timeoutMs: input.timeoutMs,
  });

  return { host, broker };
}

async function revoke(
  broker: BrokerClient,
  input: { readonly saved: ManagedConnection; readonly timeoutMs: number },
): Promise<Release> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    await broker.revokeDevice({
      environmentId: input.saved.binding.environmentId,
      deviceId: input.saved.binding.deviceId,
      signal: controller.signal,
    });

    return "removed";
  } catch {
    return "unconfirmed";
  } finally {
    clearTimeout(timer);
  }
}
