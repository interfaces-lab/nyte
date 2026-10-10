import { asId } from "@nyte-ai/schema";
import type {
  ByteReader,
  CredentialSource,
  FileVersion,
  Json,
  RequestOptions,
} from "@nyte-ai/schema";
import { SdkError } from "@nyte-ai/core";
import type { OperationName } from "./declarations.ts";
import { parseJson } from "./json.ts";
import { decodeError, parseOutputFrames, parseSse, withInputHeader } from "./wire.ts";
import type { SseFrame } from "./wire.ts";

/** Describes where a transport sends requests, the headers each carries (credentials, read again per request), and the `fetch` it uses. */
export type TransportOptions = {
  readonly url: string;
  headers(): Promise<Readonly<Record<string, string>>>;
  readonly fetch?: typeof fetch;
};

/** Returns a byte reader over a response body: its size from `Content-Length` and its mime from `X-Nyte-Mime` when the host sent them (§40w), and the file version the host read when it sent one (`X-Nyte-Version`, §40h). */
export type ResponseReader = ByteReader & { readonly version?: FileVersion };

/** Returns the low-level client, one primitive per wire shape: `invoke` (JSON in and out), `stream` (event-stream JSON frames, or a framed job output as byte chunks and `gap`/`exit` frames), `bytes` (an octet answer as a reader), `watch` (events with their ids, resuming after `lastEventId`; reconnecting is the caller's), `upload` (bytes as the body, the input in `X-Nyte-Input`), and `credential` (the `X-Nyte-Credential` a pairing exchange returned, §40j); `return()` on a `stream` or `watch` iterator aborts its request and resolves at once (§40x); every error answer is rethrown as the `SdkError` it encodes. */
export type Transport = {
  invoke(name: OperationName, input: Json, options?: RequestOptions): Promise<Json>;
  stream(name: OperationName, input: Json): AsyncIterable<Uint8Array | Json>;
  bytes(name: OperationName, input: Json, options?: RequestOptions): Promise<ResponseReader>;
  watch(name: OperationName, input: Json, lastEventId?: string): AsyncIterable<SseFrame>;
  upload(
    name: OperationName,
    input: Json,
    body: Uint8Array | ReadableStream<Uint8Array>,
  ): Promise<Json>;
  credential(): CredentialSource | null;
};

const DONE = { done: true, value: undefined } as const;

/** Returns a transport over `fetch` and `ReadableStream`, with no `EventSource`, so headers reach every request and it runs in browsers and React Native. */
export function createTransport(options: TransportOptions): Transport {
  const base = options.url.replace(/\/+$/, "");
  const send = options.fetch ?? fetch;
  let credential: CredentialSource | null = null;

  const post = async (
    name: OperationName,
    init: { readonly headers: Readonly<Record<string, string>> } & Omit<RequestInit, "headers">,
  ): Promise<Response> => {
    const headers = { ...(await options.headers()), ...init.headers };
    let response: Response;

    try {
      response = await send(`${base}/${name}`, { ...init, method: "POST", headers });
    } catch (error) {
      if (init.signal?.aborted === true) throw error;

      throw new SdkError("unavailable", error instanceof Error ? error.message : String(error));
    }

    const token = response.headers.get("X-Nyte-Credential");

    if (token !== null) credential = { kind: "token", token };

    if (response.ok) return response;

    throw decodeError(jsonOrText(await response.text()), response.status);
  };

  const json = (input: Json, headers?: Readonly<Record<string, string>>) => ({
    body: JSON.stringify(input),
    headers: { "Content-Type": "application/json", ...headers },
  });

  return {
    async invoke(name, input, request) {
      const response = await post(name, { ...json(input), signal: request?.signal });

      return parseJson(await response.text());
    },
    stream(name, input) {
      return cancellable(async function* (signal) {
        const response = await post(name, { ...json(input), signal });

        if (response.body === null) return;

        if (response.headers.get("Content-Type")?.startsWith("text/event-stream") === true) {
          for await (const frame of parseSse(response.body)) yield frame.data;

          return;
        }

        for await (const frame of parseOutputFrames(response.body))
          yield frame.kind === "bytes" ? frame.data : frame;
      });
    },
    async bytes(name, input, request) {
      const response = await post(name, { ...json(input), signal: request?.signal });
      const length = response.headers.get("Content-Length");
      const version = response.headers.get("X-Nyte-Version");
      const body = response.body;

      const close = async (): Promise<void> => {
        await body?.cancel().catch(() => undefined);
      };

      return {
        size: length === null ? null : Number(length),
        mime: response.headers.get("X-Nyte-Mime"),
        ...(version === null ? {} : { version: asId<"file-version">(version) }),
        chunks: () => chunksOf(body),
        close,
        [Symbol.asyncDispose]: close,
      };
    },
    watch(name, input, lastEventId) {
      return cancellable(async function* (signal) {
        const headers = lastEventId === undefined ? undefined : { "Last-Event-ID": lastEventId };
        const response = await post(name, { ...json(input, headers), signal });

        if (response.body !== null) yield* parseSse(response.body);
      });
    },
    async upload(name, input, body) {
      const response = await post(name, withInputHeader(input, body));

      return parseJson(await response.text());
    },
    credential: () => credential,
  };
}

/** Returns the frames `open` yields for one request behind a hand-written iterator: `return()` aborts the request and resolves at once, even while a `next()` waits, which then settles done (§40x); a source suspended between frames is returned so its readers release. */
function cancellable<T>(open: (signal: AbortSignal) => AsyncIterable<T>): AsyncIterable<T> {
  return {
    [Symbol.asyncIterator]() {
      const controller = new AbortController();
      const source = open(controller.signal)[Symbol.asyncIterator]();
      let settle: ((result: IteratorResult<T>) => void) | null = null;

      const release = (): void => {
        void Promise.resolve(source.return?.()).catch(() => undefined);
      };

      return {
        next(): Promise<IteratorResult<T>> {
          if (controller.signal.aborted) return Promise.resolve(DONE);

          const pulled = (async (): Promise<IteratorResult<T>> => {
            try {
              const next = await source.next();

              if (!controller.signal.aborted) {
                if (next.done === true) controller.abort();

                return next;
              }

              if (next.done !== true) release();

              return DONE;
            } catch (error) {
              if (controller.signal.aborted) return DONE;
              controller.abort();

              throw error;
            }
          })();

          return Promise.race([
            pulled,
            new Promise<IteratorResult<T>>((resolve) => {
              settle = resolve;
            }),
          ]).finally(() => {
            settle = null;
          });
        },
        async return(): Promise<IteratorResult<T>> {
          const waiting = settle;
          settle = null;

          if (waiting === null && !controller.signal.aborted) release();
          controller.abort();
          waiting?.(DONE);

          return DONE;
        },
      };
    },
  };
}

async function* chunksOf(body: ReadableStream<Uint8Array> | null): AsyncGenerator<Uint8Array> {
  if (body === null) return;
  const reader = body.getReader();

  try {
    for (;;) {
      const read = await reader.read();

      if (read.done) return;
      yield read.value;
    }
  } finally {
    reader.releaseLock();
  }
}

function jsonOrText(text: string): Json {
  try {
    return parseJson(text);
  } catch {
    return text;
  }
}
