import { createNyteClient, NyteWireError } from "@nyte-ai/client";
import {
  base64ToBase64Url,
  base64Url,
  BrokerError,
  DEVICE_TOKEN_BYTES,
  ENROLLMENT_READINESS_SECONDS,
  relayAddress,
} from "@nyte-ai/connect";
import type {
  BrokerClient,
  BrokerFailure,
  EnrollResponse,
  EnvironmentSummary,
} from "@nyte-ai/connect";
import type { Connection, ManagedConnection, SavedConnection } from "../connection/connection.ts";
import type { SaveResult } from "../connection/connection-store.ts";
import { RELEASE_TIMEOUT_MS, releaseOnHost, releaseReplaced } from "./revocation.ts";

type Fetch = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

export interface DeviceCrypto {
  /** Bytes from the platform CSPRNG, never a `Math.random` fallback. */
  readonly randomBytes: (count: number) => Promise<Uint8Array>;
  /** SHA-256 of the text's UTF-8 bytes, as padded standard base64. */
  readonly sha256Base64: (text: string) => Promise<string>;
}

/** A fresh device bearer and the digest the broker sees in its place. */
export async function createDeviceSecret(
  crypto: DeviceCrypto,
): Promise<{ readonly token: string; readonly digest: string }> {
  const bytes = await crypto.randomBytes(DEVICE_TOKEN_BYTES);

  if (bytes.length !== DEVICE_TOKEN_BYTES)
    throw new Error("The random source returned the wrong number of bytes.");
  const token = base64Url(bytes);

  return { token, digest: base64ToBase64Url(await crypto.sha256Base64(token)) };
}

export type ConnectEnding =
  | { readonly kind: "connected" }
  | { readonly kind: "broker"; readonly failure: BrokerFailure }
  /** Enrolled, but the Mac kept refusing the new bearer through the readiness window. */
  | { readonly kind: "notAccepted" }
  /** Enrolled, but the Mac never answered through the readiness window. */
  | { readonly kind: "silent" }
  | { readonly kind: "notSaved" }
  /** Something this app does not recognize stopped it. */
  | { readonly kind: "unexpected"; readonly detail: string }
  | { readonly kind: "cancelled" };

const READINESS = { windowMs: ENROLLMENT_READINESS_SECONDS * 1000, intervalMs: 1000 };

function pause(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    const done = () => {
      clearTimeout(timer);
      signal.removeEventListener("abort", done);
      resolve();
    };
    const timer = setTimeout(done, ms);

    signal.addEventListener("abort", done);
  });
}

/**
 * `/v1/info` with the new bearer until the Mac accepts it. The desktop may
 * refuse a just-enrolled device while its lease catches up, so a refusal here
 * is retried with the same bearer for a bounded window. Nothing here enrolls
 * again.
 */
async function awaitAcceptance(input: {
  readonly connection: Connection;
  readonly fetch: Fetch;
  readonly signal: AbortSignal;
  readonly readiness: typeof READINESS;
}): Promise<"accepted" | "notAccepted" | "silent" | "cancelled"> {
  const deadline = Date.now() + input.readiness.windowMs;
  let last: "notAccepted" | "silent" = "silent";

  while (!input.signal.aborted) {
    const remaining = deadline - Date.now();

    if (remaining <= 0) return last;
    const attempt = new AbortController();
    const stop = () => attempt.abort();
    const timer = setTimeout(stop, remaining);
    input.signal.addEventListener("abort", stop);

    const client = createNyteClient({
      baseUrl: input.connection.url,
      token: input.connection.token,
      fetch: (resource, init) =>
        input.fetch(resource, { ...init, credentials: "omit", signal: attempt.signal }),
    });

    try {
      await client.info();

      return "accepted";
    } catch (cause) {
      last =
        cause instanceof NyteWireError &&
        (cause.code === "unauthorized" || cause.code === "forbidden")
          ? "notAccepted"
          : "silent";
    } finally {
      clearTimeout(timer);
      input.signal.removeEventListener("abort", stop);
    }

    await pause(
      Math.min(input.readiness.intervalMs, Math.max(0, deadline - Date.now())),
      input.signal,
    );
  }

  return "cancelled";
}

/**
 * Enroll this phone with one of the account's Macs and save the result.
 *
 * The phone makes the bearer and sends the broker only its digest. The Mac's
 * address is this broker's relay for the picked Mac, derived here and never
 * taken from an answer. Once the Mac accepts the bearer, the connection is
 * saved under `signal`, so an account change that aborts it leaves nothing
 * behind. A bearer that is not kept is released on the Mac.
 */
export async function connectEnvironment(input: {
  readonly broker: BrokerClient;
  readonly environment: EnvironmentSummary;
  readonly origin: string;
  readonly ownerId: string;
  readonly clientId: string;
  readonly clientName: string;
  readonly crypto: DeviceCrypto;
  readonly fetch: Fetch;
  readonly save: (saved: SavedConnection, signal: AbortSignal) => Promise<SaveResult>;
  readonly signal: AbortSignal;
  readonly readiness?: typeof READINESS;
}): Promise<ConnectEnding> {
  const { environment, signal } = input;
  const url = relayAddress(input.origin, environment.id);
  const secret = await createDeviceSecret(input.crypto);

  if (signal.aborted) return { kind: "cancelled" };
  let enrolled: EnrollResponse;

  try {
    enrolled = await input.broker.enroll({
      environmentId: environment.id,
      request: { clientId: input.clientId, clientName: input.clientName, digest: secret.digest },
      signal,
    });
  } catch (cause) {
    if (signal.aborted) return { kind: "cancelled" };

    if (cause instanceof BrokerError) return { kind: "broker", failure: cause.failure };
    throw cause;
  }

  const saved: ManagedConnection = {
    kind: "managed",
    connection: { name: environment.name, url, token: secret.token },
    binding: {
      origin: input.origin,
      environmentId: environment.id,
      deviceId: enrolled.deviceId,
      ownerId: input.ownerId,
    },
  };

  const discard = () =>
    void releaseOnHost({
      connection: saved.connection,
      fetch: input.fetch,
      timeoutMs: RELEASE_TIMEOUT_MS,
    });

  const acceptance = await awaitAcceptance({
    connection: saved.connection,
    fetch: input.fetch,
    signal,
    readiness: input.readiness ?? READINESS,
  });

  if (acceptance !== "accepted") {
    discard();

    return { kind: acceptance };
  }

  const result = await input.save(saved, signal);

  if (result.kind === "saved") {
    releaseReplaced({ replaced: result.replaced, next: saved, fetch: input.fetch });

    return { kind: "connected" };
  }

  discard();

  return result.kind === "cancelled" ? { kind: "cancelled" } : { kind: "notSaved" };
}
