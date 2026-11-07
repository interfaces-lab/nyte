import { SdkError } from "@nyte-ai/schema";
import { createTransport } from "@nyte-ai/protocol";
import { base64ToBase64Url, base64Url } from "./encoding.ts";
import { DESKTOP_ROUTES, DEVICE_TOKEN_BYTES, ENROLLMENT_READINESS_SECONDS } from "./schemas.ts";

type Fetch = (...args: Parameters<typeof fetch>) => ReturnType<typeof fetch>;

export interface DeviceCrypto {
  readonly randomBytes: (count: number) => Promise<Uint8Array>;
  readonly sha256Base64: (text: string) => Promise<string>;
}

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

    const transport = createTransport({
      url: input.connection.url,
      headers: async () => ({ Authorization: `Bearer ${input.connection.token}` }),
      fetch: (resource, init) =>
        fetch(resource, { ...init, credentials: "omit", signal: attempt.signal }),
    });

    try {
      await transport.invoke("sessions.list", {});

      return "accepted";
    } catch (cause) {
      last =
        cause instanceof SdkError && (cause.code === "unauthenticated" || cause.code === "denied")
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
