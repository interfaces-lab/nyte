import { DESKTOP_ROUTES } from "@nyte-ai/connect";
import type { BrokerClient } from "@nyte-ai/connect";
import type { Connection, ManagedConnection, SavedConnection } from "../connection/connection.ts";

type Fetch = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

/** Each remote step of a release gives up after this, so leaving never hangs on an offline Mac. */
export const RELEASE_TIMEOUT_MS = 5_000;

/** `removed` only when that side answered yes. Silence is never reported as removal. */
export type Release = "removed" | "unconfirmed";

export interface ReleaseReport {
  /** The Mac, asked with the device's own bearer. */
  readonly host: Release;
  /** The broker's revocation; `skipped` without a session for the owning account. */
  readonly broker: Release | "skipped";
}

/**
 * Release this device on its Mac: `DELETE /_nyte/connect/device` through its
 * relay address, with the device's own bearer and no cookies. The Mac refuses
 * the bearer at once and queues the broker's weak release itself, which frees
 * the device's place under the limit; the phone's Clerk session is untouched.
 * 204 is the release; 401 or 403 means the relay or the Mac already refuses
 * that bearer, which is the goal. Any other answer, another 2xx or the relay's
 * 503 for an offline Mac included, is not a confirmation.
 */
export async function releaseOnHost(input: {
  readonly connection: Connection;
  readonly fetch: Fetch;
  readonly timeoutMs: number;
}): Promise<Release> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const response = await input.fetch(`${input.connection.url}${DESKTOP_ROUTES.device}`, {
      method: "DELETE",
      headers: { authorization: `Bearer ${input.connection.token}` },
      credentials: "omit",
      redirect: "error",
      signal: controller.signal,
    });

    return [204, 401, 403].includes(response.status) ? "removed" : "unconfirmed";
  } catch {
    return "unconfirmed";
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Release the account connection a save replaced, so switching to another Mac,
 * or to an address, leaves no live bearer behind. Reconnecting the same Mac
 * replaces a bearer too: the broker already ended that device, so the Mac
 * answers 401 and nothing else changes.
 */
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

/**
 * Remove this device for good, for Sign Out and for Disconnect while signed in
 * as its owner. The broker's revocation comes first: it also ends the Clerk
 * session that enrolled the device, so that session cannot enroll again. The
 * Mac is then asked with the device's own bearer, whatever the broker said.
 */
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
