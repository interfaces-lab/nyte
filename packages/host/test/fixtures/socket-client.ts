import { Buffer } from "node:buffer";
import { once } from "node:events";
import { isJson, isJsonObject } from "@nyte-ai/schema";
import type { Json, JsonSchema } from "@nyte-ai/schema";
import type { Listener } from "@nyte-ai/core";
import type { ServedHost } from "@nyte-ai/core/server";
import { decodeError } from "@nyte-ai/protocol";
import { WebSocket } from "ws";
import type { RawData } from "ws";
import { assert } from "vitest";
import { listen } from "../../src/index.ts";
import { open } from "./fake-models.ts";
import type { FakeModels } from "./fake-models.ts";

export const TOKEN = "a-token-of-at-least-16";

export const cleanups: (() => Promise<void>)[] = [];

export type Composed = Awaited<ReturnType<typeof open>>;

export type Client = Awaited<ReturnType<typeof connect>>;

export function hello(
  apiMinRevision = 1,
  actions: readonly string[] = [],
  name = "socket-test",
  apiRevision?: number,
): Json {
  return {
    c: "e",
    type: "hello",
    api_min_revision: apiMinRevision,
    ...(apiRevision === undefined ? {} : { api_revision: apiRevision }),
    client: {
      kind: "other",
      name,
      version: "1",
      actions: actions.map((action) => ({ name: action, summary: `Does ${action}.`, input: {} })),
    },
  };
}

export async function target(listener: Listener, actions: readonly string[] = ["open"]) {
  const client = await connect(listener, hello(1, actions, "target"));
  await client.call("events.subscribe", { scopes: [`client/${client.id}`] });

  return client;
}

export function performs(client: Client): readonly JsonSchema[] {
  return client.frames.filter((frame) => frame.kind === "perform");
}

export async function failureCode(pending: Promise<Json>): Promise<string | null> {
  return pending.then(
    () => null,
    (error: Error) => ("code" in error && typeof error.code === "string" ? error.code : null),
  );
}

export async function compose(
  fake: FakeModels,
  options?: Parameters<typeof open>[1],
): Promise<Composed> {
  const host = await open(fake, options);
  cleanups.push(() => host.close());

  return host;
}

export async function serve(host: ServedHost, path?: string): Promise<Listener> {
  const listener = await listen(host, {
    transport: path === undefined ? { kind: "http" } : { kind: "socket", path },
    auth: { kind: "token", token: TOKEN },
  });

  cleanups.push(() => listener.close());

  return listener;
}

export function socketUrl(listener: Listener): string {
  const address = listener.address ?? "";

  return address.startsWith("http")
    ? `${address.replace(/^http/, "ws")}/.nyte/ws`
    : `ws+unix://${address}:/.nyte/ws`;
}

export async function openSocket(listener: Listener, greeting: Json) {
  const socket = new WebSocket(socketUrl(listener), {
    headers: { Authorization: `Bearer ${TOKEN}` },
  });

  const frames: JsonSchema[] = [];
  const wakes = new Set<() => void>();

  const closed = new Promise<{ readonly code: number; readonly reason: string }>((done) => {
    socket.once("close", (code, reason) => done({ code, reason: reason.toString() }));
  });

  socket.on("message", (data) => {
    const value: unknown = JSON.parse(readText(data));

    if (isJson(value) && isJsonObject(value)) frames.push(value);

    for (const wake of wakes) wake();
  });

  cleanups.push(async () => {
    socket.terminate();
  });
  await once(socket, "open");
  socket.send(JSON.stringify(greeting));

  const until = async (match: (frame: JsonSchema) => boolean): Promise<JsonSchema> => {
    for (;;) {
      const found = frames.find(match);

      if (found !== undefined) return found;
      await new Promise<void>((woken) => {
        const wake = (): void => {
          wakes.delete(wake);
          woken();
        };

        wakes.add(wake);
      });
    }
  };

  return { socket, frames, until, closed };
}

export async function connect(listener: Listener, greeting: Json = hello()) {
  const opened = await openSocket(listener, greeting);
  const until = opened.until;
  let calls = 0;

  const answered = (id: string): boolean =>
    opened.frames.some(
      (frame) => frame.id === id && (frame.type === "result" || frame.type === "error"),
    );

  const start = (op: string, input: Json) => {
    calls += 1;
    const id = String(calls);
    opened.socket.send(JSON.stringify({ c: "e", type: "call", id, op, input }));

    const settled = until(
      (frame) => frame.id === id && (frame.type === "result" || frame.type === "error"),
    ).then((answer) => {
      if (answer.type === "error") throw decodeError(answer.error ?? null);

      return answer.output ?? null;
    });

    settled.catch(() => undefined);

    return { id, settled };
  };

  const call = (op: string, input: Json): Promise<Json> => start(op, input).settled;

  const welcome = await until((frame) => frame.type === "welcome");

  const id = welcome.client_id;
  assert(typeof id === "string");

  return { ...opened, start, call, answered, id };
}

function readText(data: RawData): string {
  if (Array.isArray(data)) return Buffer.concat(data).toString("utf8");

  if (data instanceof ArrayBuffer) return Buffer.from(data).toString("utf8");

  return data.toString("utf8");
}
