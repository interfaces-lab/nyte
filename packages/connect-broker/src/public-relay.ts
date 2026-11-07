import { DeviceToken } from "@nyte-ai/connect";
import {
  PUBLIC_RELAY_BEARER,
  PUBLIC_RELAY_METHODS,
  RELAY_BODY_LIMIT_BYTES,
  publicRelayTarget,
  relayRefusal,
} from "@nyte-ai/connect/relay";
import type { RelayMethod, RelayRefusalCode } from "@nyte-ai/connect/relay";
import { randomId } from "@nyte-ai/connect/signing";
import { Value } from "typebox/value";
import type { Context } from "./context.ts";
import { Refusal } from "./http.ts";
import { errorName } from "./log.ts";
import type { RelayAdmission } from "./environment-api.ts";
import {
  bearerToken,
  connectRequest,
  forwardRequest,
  resetChannel,
  socketRequest,
} from "./relay-stub.ts";

function refuse(code: RelayRefusalCode, headers: Record<string, string> = {}): Response {
  const response = relayRefusal(code);

  for (const [name, value] of Object.entries(headers)) response.headers.set(name, value);

  return response;
}

type Admission =
  | { readonly kind: "refused"; readonly response: Response }
  | {
      readonly kind: "admitted";
      readonly environmentId: string;
      readonly path: string;
      readonly method: RelayMethod;
      readonly admission: RelayAdmission;
      readonly socket: boolean;
    };

function admit(context: Context, request: Request): Admission {
  const refused = (code: RelayRefusalCode, headers?: Record<string, string>) =>
    ({ kind: "refused", response: refuse(code, headers) }) as const;

  const target = publicRelayTarget(new URL(request.url));

  if (target === undefined) return refused("not_found");
  const methods: readonly RelayMethod[] = PUBLIC_RELAY_METHODS[target.kind];
  const method = methods.find((allowed) => allowed === request.method);

  if (method === undefined) return refused("method_not_allowed", { allow: methods.join(", ") });
  const origin = request.headers.get("origin");

  if (origin !== null && !context.config.webOrigins.includes(origin)) return refused("forbidden");
  const declared = request.headers.get("content-length");

  if (declared !== null && !(Number(declared) <= RELAY_BODY_LIMIT_BYTES))
    return refused("payload_too_large");
  const admission = PUBLIC_RELAY_BEARER[target.kind];
  const token = bearerToken(request.headers);

  if (admission !== "none" && (token === undefined || !Value.Check(DeviceToken, token)))
    return refused("unauthorized");

  return {
    kind: "admitted",
    environmentId: target.environmentId,
    path: target.path,
    method,
    admission,
    socket: target.kind === "socket",
  };
}

function passThrough(response: Response, input: { readonly onCancel: () => void }): Response {
  if (response.body === null) return response;
  const reader = response.body.getReader();

  const body = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        try {
          const read = await reader.read();

          if (read.done) controller.close();
          else controller.enqueue(read.value);
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

export async function relayPublic(context: Context, request: Request): Promise<Response> {
  const admission = admit(context, request);

  if (admission.kind === "refused") return admission.response;

  if (request.signal.aborted) return refuse("closed");
  const environmentId = admission.environmentId;
  const channel = randomId();
  const stub = context.environment(environmentId);

  if (admission.socket) {
    if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") return refuse("not_found");

    return stub.fetch(socketRequest({ channel, path: admission.path }));
  }

  let reset = false;

  const cancel = () => {
    if (reset) return;
    reset = true;
    resetChannel(context, { stub, environmentId, channel });
  };

  request.signal.addEventListener("abort", cancel, { once: true });

  try {
    const response = await stub.fetch(
      forwardRequest({
        channel,
        method: admission.method,
        path: admission.path,
        headers: request.headers,
        body: request.body,
        admission: admission.admission,
        signal: request.signal,
      }),
    );

    return passThrough(response, { onCancel: cancel });
  } catch (error) {
    if (!request.signal.aborted)
      context.log.warn("relay.forward_failed", { environmentId, error: errorName(error) });
    cancel();

    return refuse("closed");
  }
}

export async function connectRelay(
  context: Context,
  request: Request,
  environmentId: string,
): Promise<Response> {
  if (request.headers.get("upgrade")?.toLowerCase() !== "websocket") throw new Refusal("invalid");

  return context.environment(environmentId).fetch(connectRequest());
}
