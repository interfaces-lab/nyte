import type { Job } from "@nyte-ai/core";
import { compile } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import { Type } from "typebox";

export interface LspHandlers {
  readonly notification: (method: string, params: unknown) => void;
  readonly request: (method: string, params: unknown) => Promise<Json>;
  readonly stderr: (text: string) => void;
}

export interface LspConnection {
  /** Rejects with `LspError` for an error answer, and once the server is gone; aborting `signal` sends `$/cancelRequest`. */
  request(method: string, params: Json, signal?: AbortSignal): Promise<unknown>;
  notify(method: string, params: Json): void;
}

export class LspError extends Error {
  readonly code: number;

  constructor(code: number, message: string) {
    super(message);
    this.code = code;
  }
}

export const REQUEST_CANCELLED = -32_800;

const SERVER_GONE = -32_099;

const Envelope = compile(
  Type.Object({
    id: Type.Optional(Type.Union([Type.Number(), Type.String(), Type.Null()])),
    method: Type.Optional(Type.String()),
    params: Type.Optional(Type.Unknown()),
    result: Type.Optional(Type.Unknown()),
    error: Type.Optional(Type.Object({ code: Type.Number(), message: Type.String() })),
  }),
);

const HEADER_END = new TextEncoder().encode("\r\n\r\n");

const encoder = new TextEncoder();

const decoder = new TextDecoder();

/** Speaks JSON-RPC with `Content-Length` framing over a job started with `stdio: "protocol"`. */
export function connectLsp(job: Job, handlers: LspHandlers): LspConnection {
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void }>();
  let ids = 0;
  let writing: Promise<void> = Promise.resolve();
  let gone = false;

  const write = (message: Json): void => {
    const body = encoder.encode(JSON.stringify(message));
    const header = encoder.encode(`Content-Length: ${body.byteLength}\r\n\r\n`);
    const frame = new Uint8Array(header.byteLength + body.byteLength);
    frame.set(header);
    frame.set(body, header.byteLength);
    writing = writing.then(() => job.write(frame)).catch(() => undefined);
  };

  const answer = async (id: number | string, method: string, params: unknown): Promise<void> => {
    const result = await handlers.request(method, params).then(
      (value) => ({ result: value }),
      (error: unknown) => ({
        error: { code: -32_603, message: error instanceof Error ? error.message : String(error) },
      }),
    );

    if (!gone) write({ jsonrpc: "2.0", id, ...result });
  };

  const receive = (value: unknown): void => {
    if (!Envelope.Check(value)) return;
    const id = value.id;

    if (value.method !== undefined) {
      if (id === undefined || id === null) handlers.notification(value.method, value.params);
      else void answer(id, value.method, value.params);

      return;
    }

    if (typeof id !== "number") return;
    const waiter = pending.get(id);

    if (waiter === undefined) return;
    pending.delete(id);

    if (value.error === undefined) waiter.resolve(value.result ?? null);
    else waiter.reject(new LspError(value.error.code, value.error.message));
  };

  void (async () => {
    let buffer = new Uint8Array(0);

    for await (const frame of job.output()) {
      if (frame.kind === "exit") break;

      if (frame.kind === "gap") {
        handlers.stderr("The server's output lost bytes; its protocol stream broke.\n");
        break;
      }

      if (frame.stream === "stderr") {
        handlers.stderr(decoder.decode(frame.data));
        continue;
      }

      const joined = new Uint8Array(buffer.byteLength + frame.data.byteLength);
      joined.set(buffer);
      joined.set(frame.data, buffer.byteLength);
      buffer = joined;

      for (;;) {
        const end = findSequence(buffer, HEADER_END);

        if (end < 0) break;
        const length = /content-length:\s*(\d+)/i.exec(decoder.decode(buffer.subarray(0, end)));
        const start = end + HEADER_END.byteLength;

        if (length === null) {
          buffer = buffer.slice(start);
          continue;
        }

        const stop = start + Number(length[1]);

        if (buffer.byteLength < stop) break;
        const body = decoder.decode(buffer.subarray(start, stop));
        buffer = buffer.slice(stop);
        receive(parseBody(body));
      }
    }
  })()
    .catch(() => undefined)
    .finally(() => {
      gone = true;

      for (const waiter of pending.values()) {
        waiter.reject(new LspError(SERVER_GONE, "The language server stopped."));
      }
      pending.clear();
    });

  return {
    request(method, params, signal) {
      if (gone) return Promise.reject(new LspError(SERVER_GONE, "The language server stopped."));
      ids += 1;
      const id = ids;

      return new Promise((resolve, reject) => {
        const cancel = (): void => {
          if (!pending.delete(id)) return;
          write({ jsonrpc: "2.0", method: "$/cancelRequest", params: { id } });
          reject(new LspError(REQUEST_CANCELLED, "Cancelled."));
        };

        if (signal?.aborted === true) {
          reject(new LspError(REQUEST_CANCELLED, "Cancelled."));

          return;
        }

        pending.set(id, {
          resolve(value) {
            signal?.removeEventListener("abort", cancel);
            resolve(value);
          },
          reject(error) {
            signal?.removeEventListener("abort", cancel);
            reject(error);
          },
        });
        signal?.addEventListener("abort", cancel, { once: true });
        write({ jsonrpc: "2.0", id, method, params });
      });
    },
    notify(method, params) {
      if (!gone) write({ jsonrpc: "2.0", method, params });
    },
  };
}

function parseBody(body: string): unknown {
  try {
    return JSON.parse(body);
  } catch {
    return null;
  }
}

function findSequence(haystack: Uint8Array, needle: Uint8Array): number {
  for (let index = 0; index + needle.byteLength <= haystack.byteLength; index += 1) {
    if (needle.every((byte, offset) => haystack[index + offset] === byte)) return index;
  }

  return -1;
}
