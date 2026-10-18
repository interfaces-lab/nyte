import { inflateSync } from "fflate";
import { SdkError } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import {
  CANCEL_PATH,
  CHANNEL_HEADER,
  CHANNEL_PATH,
  DEFLATE_REQUEST,
  readStreamFrame,
  STREAM_HEADER,
} from "./stream-channel.ts";
import { streamBuffer } from "./stream-buffer.ts";
import { parseJson } from "./json.ts";
import { decodeError, parseSse } from "./wire.ts";

type Post = (
  path: string,
  init: RequestInit & { readonly headers: Readonly<Record<string, string>> },
) => Promise<Response>;

/** Multiplex streams over one channel opened through `post`, asking for `deflated` frames when `deflate`; the channel closes when its last stream is released. */
export function createStreamClient(post: Post, deflate: boolean) {
  type Stream = {
    readonly buffer: ReturnType<typeof streamBuffer>;
    readonly dispose: () => void;
  };

  type Channel = {
    readonly ready: Promise<string>;
    readonly controller: AbortController;
    readonly streams: Map<string, Stream>;
  };

  let channel: Channel | undefined;

  const json = (value: Json) => ({
    body: JSON.stringify(value),
    headers: { "Content-Type": "application/json" },
  });

  const forget = (current: Channel, id: string): boolean => {
    const stream = current.streams.get(id);

    if (stream === undefined) return false;
    current.streams.delete(id);
    stream.dispose();

    if (current.streams.size > 0) return true;
    current.controller.abort();

    if (channel === current) channel = undefined;

    return false;
  };

  const release = (current: Channel, id: string): void => {
    if (!forget(current, id)) return;

    void current.ready
      .then((channelId) =>
        post(CANCEL_PATH, {
          ...json({ channel: channelId, stream: id }),
          signal: current.controller.signal,
        }),
      )
      .catch(() => undefined);
  };

  const open = (): Channel => {
    if (channel !== undefined) return channel;
    const controller = new AbortController();
    const ready = Promise.withResolvers<string>();
    const current: Channel = { ready: ready.promise, controller, streams: new Map() };
    channel = current;
    void (async () => {
      try {
        const response = await post(CHANNEL_PATH, {
          ...json(deflate ? DEFLATE_REQUEST : {}),
          signal: controller.signal,
        });
        const id = response.headers.get(CHANNEL_HEADER);

        if (id === null || response.body === null)
          throw new SdkError("invalid", "The host did not open a stream channel.");
        ready.resolve(id);

        for await (const envelope of parseSse(networkBody(response.body))) {
          const frame = readStreamFrame(envelope);
          const stream = current.streams.get(frame.stream);

          if (stream === undefined) continue;
          const { buffer } = stream;

          if (frame.kind === "end") {
            buffer.end();
            forget(current, frame.stream);
          } else if (frame.kind === "error") {
            buffer.fail(decodeError(parseJson(frame.error)));
            forget(current, frame.stream);
          } else {
            let chunk: Uint8Array;

            try {
              const bytes = Uint8Array.fromBase64(frame.data);
              chunk = frame.kind === "deflated" ? inflateSync(bytes) : bytes;
            } catch {
              throw new SdkError("invalid", "The host sent invalid stream bytes.");
            }

            if (!buffer.push(chunk)) {
              buffer.fail(new SdkError("unavailable", "The stream exceeded its buffer capacity."));
              release(current, frame.stream);
            }
          }
        }

        if (!controller.signal.aborted)
          throw new SdkError("unavailable", "The stream channel disconnected.");
      } catch (cause) {
        const error =
          cause instanceof Error
            ? cause
            : new SdkError(
                "unavailable",
                cause instanceof Error ? cause.message : "The stream channel disconnected.",
              );

        ready.reject(error);

        for (const stream of current.streams.values()) stream.buffer.fail(error);
      } finally {
        for (const stream of current.streams.values()) stream.dispose();
        current.streams.clear();
        controller.abort();

        if (channel === current) channel = undefined;
      }
    })();

    return current;
  };

  return async (
    name: string,
    input: Json,
    signal: AbortSignal,
  ): Promise<ReadableStream<Uint8Array>> => {
    signal.throwIfAborted();
    const current = open();
    const id = crypto.randomUUID();
    const buffer = streamBuffer(() => release(current, id));
    const canceled = Promise.withResolvers<never>();

    const abort = (): void => {
      const error =
        signal.reason instanceof Error ? signal.reason : new DOMException("Aborted", "AbortError");

      buffer.fail(error);
      canceled.reject(error);
      release(current, id);
    };

    current.streams.set(id, { buffer, dispose: () => signal.removeEventListener("abort", abort) });
    signal.addEventListener("abort", abort, { once: true });

    try {
      const channelId = await Promise.race([current.ready, canceled.promise]);
      signal.throwIfAborted();
      await Promise.race([
        post(name, {
          ...json(input),
          headers: {
            "Content-Type": "application/json",
            [CHANNEL_HEADER]: channelId,
            [STREAM_HEADER]: id,
          },
          signal,
        }),
        canceled.promise,
      ]);

      return buffer.body;
    } catch (error) {
      release(current, id);
      throw error;
    }
  };
}

function networkBody(body: ReadableStream<Uint8Array>): ReadableStream<Uint8Array> {
  const reader = body.getReader();

  return new ReadableStream<Uint8Array>({
    async pull(controller) {
      const next = await reader.read().catch((cause: unknown) => {
        throw new SdkError("unavailable", cause instanceof Error ? cause.message : String(cause));
      });

      if (next.done) controller.close();
      else controller.enqueue(next.value);
    },
    cancel: (reason) => reader.cancel(reason),
  });
}
