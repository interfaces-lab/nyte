import {
  API_MIN_REVISION,
  API_REVISION,
  compile,
  ErrorFrameType,
  EventFrameType,
  isJson,
  isJsonObject,
  ResultFrameType,
  SdkError,
  TextFrameType,
  WelcomeFrameType,
  withJson,
} from "@nyte-ai/schema";
import type {
  ClientInfo,
  EventFrame,
  Json,
  JsonSchema,
  TextFrame,
  WelcomeFrame,
} from "@nyte-ai/schema";
import { decodeError } from "./wire.ts";

export interface SocketLike {
  send(data: string): void;
  close(code?: number, reason?: string): void;
  addEventListener(type: "open", listener: () => void): void;
  addEventListener(type: "message", listener: (event: { readonly data: unknown }) => void): void;
  addEventListener(
    type: "close",
    listener: (event: { readonly code: number; readonly reason: string }) => void,
  ): void;
  addEventListener(type: "error", listener: () => void): void;
}

export type SocketClosed = { readonly code: number; readonly reason: string };

export type SocketEvent = EventFrame & JsonSchema;

export interface HostSocket {
  readonly welcome: WelcomeFrame;
  readonly closed: Promise<SocketClosed>;
  call(op: string, input: Json): Promise<Json>;
  onEvent(listener: (event: SocketEvent) => void): () => void;
  onText(listener: (frame: TextFrame) => void): () => void;
  close(): void;
}

type Waiting = {
  readonly resolve: (output: Json) => void;
  readonly reject: (error: SdkError) => void;
};

const welcomes = compile(withJson(WelcomeFrameType));

const results = compile(withJson(ResultFrameType));

const errors = compile(withJson(ErrorFrameType));

const events = compile(withJson(EventFrameType));

const texts = compile(withJson(TextFrameType));

export async function openHostSocket(input: {
  readonly socket: SocketLike;
  readonly client: ClientInfo;
  readonly apiMinRevision?: number;
}): Promise<HostSocket> {
  const socket = input.socket;
  const waiting = new Map<string, Waiting>();
  const eventListeners = new Set<(event: SocketEvent) => void>();
  const textListeners = new Set<(frame: TextFrame) => void>();
  const greeted = Promise.withResolvers<WelcomeFrame>();
  const ended = Promise.withResolvers<SocketClosed>();
  let calls = 0;

  socket.addEventListener("message", (message) => {
    const value = typeof message.data === "string" ? readJson(message.data) : undefined;

    if (welcomes.Check(value)) greeted.resolve(value);
    else if (results.Check(value)) settle(value.id, value.output, null);
    else if (errors.Check(value)) settle(value.id, null, decodeError(value.error));
    else if (isJsonObject(value) && events.Check(value))
      for (const listener of eventListeners) listener(value);
    else if (texts.Check(value)) for (const listener of textListeners) listener(value);
  });

  socket.addEventListener("close", (event) => {
    const closed = { code: event.code, reason: event.reason };

    const failure = new SdkError(
      "unavailable",
      closed.reason === "" ? `The host closed the socket (${closed.code}).` : closed.reason,
    );

    greeted.reject(failure);

    for (const entry of waiting.values()) entry.reject(failure);
    waiting.clear();
    ended.resolve(closed);
  });

  const settle = (id: string, output: Json, failure: SdkError | null): void => {
    const entry = waiting.get(id);

    if (entry === undefined) return;
    waiting.delete(id);

    if (failure === null) entry.resolve(output);
    else entry.reject(failure);
  };

  await new Promise<void>((opened, failed) => {
    socket.addEventListener("open", () => opened());
    socket.addEventListener("error", () =>
      failed(new SdkError("unavailable", "Couldn't open the host's socket.")),
    );
  });

  socket.send(
    JSON.stringify({
      c: "e",
      type: "hello",
      api_min_revision: input.apiMinRevision ?? API_MIN_REVISION,
      api_revision: API_REVISION,
      client: input.client,
    }),
  );

  const welcome = await greeted.promise;

  return {
    welcome,
    closed: ended.promise,
    call(op, value) {
      calls += 1;
      const id = String(calls);

      return new Promise<Json>((resolve, reject) => {
        waiting.set(id, { resolve, reject });
        socket.send(JSON.stringify({ c: "e", type: "call", id, op, input: value }));
      });
    },
    onEvent(listener) {
      eventListeners.add(listener);

      return () => {
        eventListeners.delete(listener);
      };
    },
    onText(listener) {
      textListeners.add(listener);

      return () => {
        textListeners.delete(listener);
      };
    },
    close: () => socket.close(1000, "done"),
  };
}

function readJson(text: string): Json | undefined {
  try {
    const value: unknown = JSON.parse(text);

    return isJson(value) ? value : undefined;
  } catch {
    return undefined;
  }
}
