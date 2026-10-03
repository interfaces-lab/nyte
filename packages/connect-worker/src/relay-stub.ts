/**
 * How the Worker reaches an environment's relay Durable Object. Node-safe:
 * the broker and its Node tests see the namespace only through this shape,
 * so nothing here imports the Workers runtime.
 *
 * Every request the relay receives is built here by the Worker, never passed
 * through from a client: a fixed internal origin, one of four operations, the
 * environment id, and for `forward` only allowlisted headers and a checked
 * path. The relay trusts these headers because nothing else can call it.
 */
import { relayRequestHeaders } from "@nyte-ai/connect/relay";
import type { RelayMethod } from "@nyte-ai/connect/relay";
import type { Context } from "./context.ts";

export interface RelayStub {
  fetch(request: Request): Promise<Response>;
}

export interface RelayNamespace {
  getByName(name: string): RelayStub;
}

export const RELAY_INTERNAL_ORIGIN = "https://relay.internal";

export const RELAY_OPERATIONS = {
  /** The desktop's WebSocket upgrade. */
  connect: "/connect",
  /** One HTTP exchange, opened as a channel on the authenticated socket. */
  forward: "/forward",
  /** End open channels: one device's, or every one. The socket stays. */
  reset: "/reset",
  /** The environment was revoked: close every socket with `RELAY_CLOSE.revoked`. */
  revoke: "/revoke",
} as const;

export const RELAY_HEADERS = {
  environment: "nyte-relay-environment",
  path: "nyte-relay-path",
  device: "nyte-relay-device",
  channel: "nyte-relay-channel",
} as const;

function internalUrl(operation: keyof typeof RELAY_OPERATIONS): string {
  return `${RELAY_INTERNAL_ORIGIN}${RELAY_OPERATIONS[operation]}`;
}

export function connectRequest(environmentId: string): Request {
  return new Request(internalUrl("connect"), {
    headers: { upgrade: "websocket", [RELAY_HEADERS.environment]: environmentId },
  });
}

/**
 * A relayed exchange on channel `channel`, which the Worker mints so it can
 * reset the channel itself when its caller goes away. `headers` are reduced
 * to the request allowlist here; `deviceId` names the device whose bearer the
 * Worker matched, so a later revocation can end its channels.
 */
export function forwardRequest(input: {
  readonly environmentId: string;
  readonly channel: string;
  readonly method: RelayMethod;
  readonly path: string;
  readonly headers: Headers;
  readonly body: ReadableStream<Uint8Array> | string | null;
  readonly deviceId?: string;
  readonly signal?: AbortSignal;
}): Request {
  const headers = new Headers(Object.entries(relayRequestHeaders(input.headers)));

  headers.set(RELAY_HEADERS.environment, input.environmentId);
  headers.set(RELAY_HEADERS.channel, input.channel);
  headers.set(RELAY_HEADERS.path, input.path);

  if (input.deviceId !== undefined) headers.set(RELAY_HEADERS.device, input.deviceId);

  return new Request(internalUrl("forward"), {
    method: input.method,
    headers,
    body: input.method === "GET" ? null : input.body,
    signal: input.signal,
  });
}

function notify(
  context: Context,
  input: {
    readonly operation: "reset" | "revoke";
    readonly environmentId: string;
    readonly deviceId?: string;
    readonly channel?: string;
    /** The stub that opened the channel: requests on one stub arrive in order. */
    readonly stub?: RelayStub;
  },
): void {
  const headers = new Headers({ [RELAY_HEADERS.environment]: input.environmentId });

  if (input.deviceId !== undefined) headers.set(RELAY_HEADERS.device, input.deviceId);

  if (input.channel !== undefined) headers.set(RELAY_HEADERS.channel, input.channel);
  const request = new Request(internalUrl(input.operation), { method: "POST", headers });

  context.defer(
    (input.stub ?? context.relay(input.environmentId)).fetch(request).then(async (response) => {
      await response.body?.cancel();

      if (!response.ok)
        context.log.warn("relay.notify_failed", {
          operation: input.operation,
          environmentId: input.environmentId,
          status: response.status,
        });
    }),
  );
}

/**
 * End one channel whose caller went away, a revoked or released device's open
 * channels, or every channel of an owner who was disabled. The desktop's
 * lease still refuses a device within its lifetime if this never arrives.
 */
export function resetRelay(
  context: Context,
  input: {
    readonly environmentId: string;
    readonly deviceId?: string;
    readonly channel?: string;
    readonly stub?: RelayStub;
  },
): void {
  notify(context, { operation: "reset", ...input });
}

/** Close the revoked environment's sockets with `RELAY_CLOSE.revoked`. */
export function revokeRelay(context: Context, environmentId: string): void {
  notify(context, { operation: "revoke", environmentId });
}
