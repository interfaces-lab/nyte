/**
 * The requests the Worker sends an environment's relay over `fetch`: the
 * desktop's WebSocket upgrade, a phone's upgrade, a phone's HTTP exchange,
 * and the reset of a channel whose phone went away. Everything else is RPC
 * (`environment-api.ts`). Node-safe.
 *
 * Every request the relay receives here is built by the Worker, never passed
 * through from a client: a fixed internal origin, one of four operations, and
 * for `forward` only allowlisted headers and a checked path. The relay trusts
 * these headers because nothing else can call it.
 */
import { relayRequestHeaders } from "@nyte-ai/connect/relay";
import type { RelayMethod } from "@nyte-ai/connect/relay";
import type { Context } from "./context.ts";
import type { EnvironmentApi, RelayAdmission } from "./environment-api.ts";

export const RELAY_INTERNAL_ORIGIN = "https://relay.internal";

export const RELAY_OPERATIONS = {
  /** The desktop's WebSocket upgrade. */
  connect: "/connect",
  /** One HTTP exchange, opened as a channel on the authenticated socket. */
  forward: "/forward",
  /** A phone's WebSocket upgrade, opened as a socket channel. */
  socket: "/socket",
  /** End one channel whose phone went away. */
  reset: "/reset",
} as const;

export const RELAY_HEADERS = {
  path: "nyte-relay-path",
  channel: "nyte-relay-channel",
  /** The device a `forward`'s bearer must belong to (`PUBLIC_RELAY_BEARER`). */
  admission: "nyte-relay-admission",
} as const;

const BEARER = /^Bearer (\S+)$/u;

/** The token an `authorization: Bearer` header carries, unchecked. */
export function bearerToken(headers: Headers): string | undefined {
  return BEARER.exec(headers.get("authorization") ?? "")?.[1];
}

function internalUrl(operation: keyof typeof RELAY_OPERATIONS): string {
  return `${RELAY_INTERNAL_ORIGIN}${RELAY_OPERATIONS[operation]}`;
}

export function connectRequest(): Request {
  return new Request(internalUrl("connect"), { headers: { upgrade: "websocket" } });
}

/**
 * A relayed exchange on channel `channel`, which the Worker mints so it can
 * reset the channel itself when its caller goes away. `headers` are reduced
 * to the request allowlist here, `authorization` included: the relay checks
 * that bearer against `admission`.
 */
export function forwardRequest(input: {
  readonly channel: string;
  readonly method: RelayMethod;
  readonly path: string;
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array> | string | null;
  readonly admission: RelayAdmission;
  readonly signal?: AbortSignal;
}): Request {
  const headers = new Headers(Object.entries(relayRequestHeaders(input.headers)));

  headers.set(RELAY_HEADERS.channel, input.channel);
  headers.set(RELAY_HEADERS.path, input.path);
  headers.set(RELAY_HEADERS.admission, input.admission);

  return new Request(internalUrl("forward"), {
    method: input.method,
    headers,
    body: input.method === "GET" ? null : input.body,
    signal: input.signal,
  });
}

export function socketRequest(input: { readonly channel: string; readonly path: string }): Request {
  return new Request(internalUrl("socket"), {
    headers: {
      upgrade: "websocket",
      [RELAY_HEADERS.channel]: input.channel,
      [RELAY_HEADERS.path]: input.path,
    },
  });
}

/**
 * End one channel whose phone went away, through the stub that opened it:
 * requests on one stub arrive in order, so the reset never overtakes its
 * `forward`.
 */
export function resetChannel(
  context: Context,
  input: {
    readonly stub: EnvironmentApi;
    readonly environmentId: string;
    readonly channel: string;
  },
): void {
  const request = new Request(internalUrl("reset"), {
    method: "POST",
    headers: { [RELAY_HEADERS.channel]: input.channel },
  });

  context.defer(
    input.stub.fetch(request).then(async (response) => {
      await response.body?.cancel();

      if (!response.ok)
        context.log.warn("relay.reset_failed", {
          environmentId: input.environmentId,
          status: response.status,
        });
    }),
  );
}
