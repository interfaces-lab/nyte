/**
 * Phone requests to `<origin>/r/<environmentId>/...`, and the desktop's relay
 * socket upgrade. A phone request is checked in this order before anything
 * reaches the desktop: route, method, browser `Origin`, declared size,
 * address throttle, bearer digest against D1, environment throttle. Every
 * refusal answers in the Nyte server's error envelope; an offline desktop,
 * a full channel table, and a throttle answer `closed`, never an auth error.
 */
import { DeviceToken } from "@nyte-ai/connect";
import {
  PUBLIC_RELAY_METHODS,
  RELAY_BODY_LIMIT_BYTES,
  publicRelayTarget,
  relayRefusal,
} from "@nyte-ai/connect/relay";
import type { RelayRefusalCode } from "@nyte-ai/connect/relay";
import { randomId, sha256 } from "@nyte-ai/connect/signing";
import { Value } from "typebox/value";
import { allow } from "./context.ts";
import type { Context } from "./context.ts";
import { Refusal } from "./http.ts";
import { errorName } from "./log.ts";
import { connectRequest, forwardRequest, resetRelay } from "./relay-stub.ts";
import { findRelayDevice } from "./store.ts";

const BEARER = /^Bearer (\S+)$/u;

function refuse(code: RelayRefusalCode, headers: Record<string, string> = {}): Response {
  const response = relayRefusal(code);

  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);

  return response;
}

function clientAddress(request: Request): string {
  return request.headers.get("cf-connecting-ip") ?? "unknown";
}

async function admit(
  context: Context,
  request: Request,
): Promise<
  | { readonly kind: "refused"; readonly response: Response }
  | {
      readonly kind: "admitted";
      readonly environmentId: string;
      readonly deviceId: string;
      readonly path: string;
      readonly method: "GET" | "POST" | "DELETE";
    }
> {
  const refused = (code: RelayRefusalCode, headers?: Record<string, string>) =>
    ({ kind: "refused", response: refuse(code, headers) }) as const;
  const target = publicRelayTarget(new URL(request.url));

  if (target === undefined) return refused("not_found");
  const methods: readonly ("GET" | "POST" | "DELETE")[] = PUBLIC_RELAY_METHODS[target.kind];
  const method = methods.find((allowed) => allowed === request.method);

  if (method === undefined) return refused("method_not_allowed", { allow: methods.join(", ") });

  const origin = request.headers.get("origin");

  if (origin !== null && !context.config.webOrigins.includes(origin)) return refused("forbidden");
  const declared = request.headers.get("content-length");

  if (declared !== null && !(Number(declared) <= RELAY_BODY_LIMIT_BYTES))
    return refused("payload_too_large");

  if (!(await allow(context, "relayAddress", clientAddress(request)))) return refused("closed");
  const token = BEARER.exec(request.headers.get("authorization") ?? "")?.[1];

  if (token === undefined || !Value.Check(DeviceToken, token)) return refused("unauthorized");
  const device = await findRelayDevice(context.db, {
    environmentId: target.environmentId,
    digest: await sha256(token),
  });

  if (device === undefined) return refused("unauthorized");
  const live = device.environment_state === "active" && device.state !== "revoked";

  if (target.kind === "release" ? !live : !live || device.state !== "active")
    return refused(target.kind === "release" ? "forbidden" : "unauthorized");

  if (device.owner_status !== "active") return refused("closed");

  if (!(await allow(context, "relay", target.environmentId))) return refused("closed");

  return {
    kind: "admitted",
    environmentId: target.environmentId,
    deviceId: device.id,
    path: target.path,
    method,
  };
}

/**
 * The relay's answer, passed through a stream this Worker owns, so that the
 * phone going away, before or after the head, resets the channel through the
 * relay's own stub rather than relying on cancellation crossing into it.
 */
function passThrough(response: Response, input: { readonly onCancel: () => void }): Response {
  if (response.body === null) return response;
  const reader = response.body.getReader();
  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const { done, value } = await reader.read();

          if (done) controller.close();
          else controller.enqueue(value);
        } catch (error) {
          controller.error(error);
        }
      },
      cancel() {
        reader.cancel().catch(() => undefined);
        input.onCancel();
      },
    },
    { highWaterMark: 0 },
  );

  return new Response(body, { status: response.status, headers: response.headers });
}

/** A phone request: admitted to the environment's relay, or refused here. */
export async function relayPublic(context: Context, request: Request): Promise<Response> {
  let admission: Awaited<ReturnType<typeof admit>>;

  try {
    admission = await admit(context, request);
  } catch (error) {
    context.log.error("relay.admit_failed", { error: errorName(error) });

    return refuse("internal");
  }

  if (admission.kind === "refused") return admission.response;

  if (request.signal.aborted) return refuse("closed");
  const { environmentId } = admission;
  const channel = randomId();
  const stub = context.relay(environmentId);
  let reset = false;
  const resetChannel = () => {
    if (reset) return;
    reset = true;
    resetRelay(context, { environmentId, channel, stub });
  };

  request.signal.addEventListener("abort", resetChannel, { once: true });

  try {
    const response = await stub.fetch(
      forwardRequest({
        environmentId,
        channel,
        method: admission.method,
        path: admission.path,
        headers: request.headers,
        body: request.body,
        deviceId: admission.deviceId,
        signal: request.signal,
      }),
    );

    return passThrough(response, { onCancel: resetChannel });
  } catch (error) {
    if (!request.signal.aborted)
      context.log.warn("relay.forward_failed", { environmentId, error: errorName(error) });
    resetChannel();

    return refuse("closed");
  }
}

/**
 * The desktop's relay socket. No credential rides the upgrade; the relay
 * checks the first frame's proof itself.
 */
export async function connectRelay(
  context: Context,
  request: Request,
  environmentId: string,
): Promise<Response> {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") throw new Refusal("invalid");

  return context.relay(environmentId).fetch(connectRequest(environmentId));
}
