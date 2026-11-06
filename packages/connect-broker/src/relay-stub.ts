import { relayRequestHeaders } from "@nyte-ai/connect/relay";
import type { RelayMethod } from "@nyte-ai/connect/relay";
import type { Context } from "./context.ts";
import type { EnvironmentApi, RelayAdmission } from "./environment-api.ts";

export const RELAY_INTERNAL_ORIGIN = "https://relay.internal";

export const RELAY_OPERATIONS = {
  connect: "/connect",
  forward: "/forward",
  socket: "/socket",
  reset: "/reset",
} as const;

export const RELAY_HEADERS = {
  path: "nyte-relay-path",
  channel: "nyte-relay-channel",
  admission: "nyte-relay-admission",
} as const;

const BEARER = /^Bearer (\S+)$/u;

export function bearerToken(headers: Headers): string | undefined {
  return BEARER.exec(headers.get("authorization") ?? "")?.[1];
}

function internalUrl(operation: keyof typeof RELAY_OPERATIONS): string {
  return `${RELAY_INTERNAL_ORIGIN}${RELAY_OPERATIONS[operation]}`;
}

export function connectRequest(): Request {
  return new Request(internalUrl("connect"), { headers: { upgrade: "websocket" } });
}

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
