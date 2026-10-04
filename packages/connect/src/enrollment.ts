import { createNyteClient, NyteWireError } from "@nyte-ai/client";
import { base64ToBase64Url, base64Url } from "./encoding.ts";
import { DESKTOP_ROUTES, DEVICE_TOKEN_BYTES, ENROLLMENT_READINESS_SECONDS } from "./schemas.ts";

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

export const READINESS = { windowMs: ENROLLMENT_READINESS_SECONDS * 1000, intervalMs: 1000 };

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
export async function awaitAcceptance(input: {
  readonly connection: { readonly url: string; readonly token: string };
  readonly fetch: Fetch;
  readonly signal: AbortSignal;
  readonly readiness: typeof READINESS;
}): Promise<"accepted" | "notAccepted" | "silent" | "cancelled"> {
  const { fetch } = input;
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
        fetch(resource, { ...init, credentials: "omit", signal: attempt.signal }),
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

export const RELEASE_TIMEOUT_MS = 5_000;

export type Release = "removed" | "unconfirmed";

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
  readonly connection: { readonly url: string; readonly token: string };
  readonly fetch: Fetch;
  readonly timeoutMs: number;
}): Promise<Release> {
  const { fetch } = input;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), input.timeoutMs);

  try {
    const response = await fetch(`${input.connection.url}${DESKTOP_ROUTES.device}`, {
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
