import { SdkError } from "@nyte-ai/core";
import type { Connection } from "@nyte-ai/core";
import { CHANNEL_HEADER } from "./stream-channel.ts";
import type { StreamFrame } from "./stream-channel.ts";
import { streamBuffer } from "./stream-buffer.ts";
import { asSdkError, encodeError } from "./wire.ts";

const encoder = new TextEncoder();

const CHUNK_BYTES = 48 * 1024;

export function createStreamChannels() {
  type Channel = {
    readonly connection: Connection;
    readonly signal: AbortSignal;
    readonly streams: Map<string, AbortController>;
    readonly push: (frame: StreamFrame, signal: AbortSignal) => Promise<void>;
  };

  const channels = new Map<string, Channel>();

  const owned = (id: string, connection: Connection): Channel => {
    const channel = channels.get(id);

    if (channel === undefined) throw new SdkError("unavailable", "The stream channel is closed.");

    if (channel.connection !== connection)
      throw new SdkError("denied", "The stream channel belongs to another connection.");

    return channel;
  };

  return {
    open(connection: Connection, signal: AbortSignal): Response {
      const id = crypto.randomUUID();
      const controller = new AbortController();
      const streams = new Map<string, AbortController>();
      let timer: ReturnType<typeof setInterval> | undefined;

      const finish = (): void => {
        if (controller.signal.aborted) return;
        controller.abort();
        channels.delete(id);
        clearInterval(timer);
        signal.removeEventListener("abort", aborted);

        for (const stream of streams.values()) stream.abort();
        streams.clear();
      };

      const buffer = streamBuffer(finish);

      const fail = (error: SdkError): void => {
        if (controller.signal.aborted) return;
        buffer.end(encoder.encode(`event: error\ndata: ${JSON.stringify(encodeError(error))}\n\n`));
        finish();
      };

      const aborted = (): void => {
        fail(
          signal.reason instanceof SdkError
            ? signal.reason
            : new SdkError("unavailable", "The stream channel disconnected."),
        );
      };

      channels.set(id, {
        connection,
        signal: controller.signal,
        streams,
        push: (frame, signal) =>
          buffer.write(encoder.encode(`data: ${JSON.stringify(frame)}\n\n`), signal),
      });
      buffer.push(encoder.encode(": connected\n\n"));
      timer = setInterval(() => {
        buffer.push(encoder.encode(": ping\n\n"));
      }, 15_000);

      if (signal.aborted) aborted();
      else signal.addEventListener("abort", aborted, { once: true });

      return new Response(buffer.body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          [CHANNEL_HEADER]: id,
        },
      });
    },
    async start(
      connection: Connection,
      channelId: string,
      streamId: string,
      request: AbortSignal,
      serve: (signal: AbortSignal) => Promise<Response>,
    ): Promise<Response> {
      const channel = owned(channelId, connection);

      if (channel.streams.has(streamId))
        throw new SdkError("invalid", "The stream identifier is already in use.");
      const controller = new AbortController();
      channel.streams.set(streamId, controller);
      const abortSetup = (): void => controller.abort(request.reason);
      request.addEventListener("abort", abortSetup, { once: true });
      const signal = AbortSignal.any([controller.signal, channel.signal]);
      void (async () => {
        let reader: Pick<ReadableStreamDefaultReader<Uint8Array>, "read" | "cancel"> | undefined;

        const cancel = (): void => {
          void reader?.cancel().catch(() => undefined);
        };

        signal.addEventListener("abort", cancel, { once: true });

        try {
          if (request.aborted) abortSetup();
          signal.throwIfAborted();
          const response = await serve(signal);
          reader = response.body?.getReader();
          request.removeEventListener("abort", abortSetup);

          if (signal.aborted) return;

          if (reader !== undefined)
            for (;;) {
              const next = await reader.read();

              if (signal.aborted || next.done) break;

              for (let start = 0; start < next.value.byteLength; start += CHUNK_BYTES) {
                if (signal.aborted) break;
                const chunk = next.value.subarray(start, start + CHUNK_BYTES);
                await channel.push(
                  { kind: "chunk", stream: streamId, data: chunk.toBase64() },
                  signal,
                );
              }
            }

          if (!signal.aborted) await channel.push({ kind: "end", stream: streamId }, signal);
        } catch (error) {
          if (!signal.aborted)
            await channel.push(
              {
                kind: "error",
                stream: streamId,
                error: JSON.stringify(encodeError(asSdkError(error))),
              },
              signal,
            );
        } finally {
          request.removeEventListener("abort", abortSetup);
          signal.removeEventListener("abort", cancel);
          channel.streams.delete(streamId);
          controller.abort();
          cancel();
        }
      })();

      return new Response(null, { status: 202 });
    },
    cancel(connection: Connection, channelId: string, streamId: string): void {
      owned(channelId, connection).streams.get(streamId)?.abort();
    },
  };
}
