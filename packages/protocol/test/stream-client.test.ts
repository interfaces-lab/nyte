import type { Json } from "@nyte-ai/schema";
import { SdkError } from "@nyte-ai/schema";
import { afterEach, expect, it, vi } from "vitest";
import { parseJson } from "../src/wire/json.ts";
import {
  CANCEL_PATH,
  CHANNEL_HEADER,
  CHANNEL_PATH,
  STREAM_HEADER,
} from "../src/wire/stream-channel.ts";
import { createStreamClient, linkLost } from "../src/client/stream-client.ts";

afterEach(() => {
  vi.useRealTimers();
});

it("cancels a stream the client lets go of, never one the host ended", async () => {
  const encoder = new TextEncoder();
  const host = Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>();
  const streams = new Map<string, string | undefined>();
  const canceled: Json[] = [];
  const firstCancel = Promise.withResolvers<void>();

  const open = createStreamClient(async (path, init) => {
    if (path === CHANNEL_PATH)
      return new Response(new ReadableStream({ start: (controller) => host.resolve(controller) }), {
        headers: { [CHANNEL_HEADER]: "c1" },
      });

    if (path === CANCEL_PATH) {
      canceled.push(parseJson(await new Response(init.body).text()));
      firstCancel.resolve();
    } else streams.set(path, init.headers[STREAM_HEADER]);

    return new Response(null);
  }, false);

  const { signal } = new AbortController();

  const [ended, released, kept] = await Promise.all([
    open("ended", null, signal),
    open("released", null, signal),
    open("kept", null, signal),
  ]);

  const channel = await host.promise;

  channel.enqueue(
    encoder.encode(`data: ${JSON.stringify({ kind: "end", stream: streams.get("ended") })}\n\n`),
  );
  expect(await new Response(ended).text()).toBe("");
  await released.cancel();
  await firstCancel.promise;

  expect(canceled).toEqual([{ channel: "c1", stream: streams.get("released") }]);
  await kept.cancel();
  channel.close();
});

it("fails its streams as a lost link once the channel delivers no byte for 45 s, and not while pings arrive", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const encoder = new TextEncoder();
  const host = Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>();
  const aborted = Promise.withResolvers<unknown>();

  const open = createStreamClient(async (path, init) => {
    if (path !== CHANNEL_PATH) return new Response(null);

    init.signal?.addEventListener("abort", () => {
      aborted.resolve(init.signal?.reason);
      void host.promise.then((controller) => controller.error(init.signal?.reason));
    });

    return new Response(new ReadableStream({ start: (controller) => host.resolve(controller) }), {
      headers: { [CHANNEL_HEADER]: "c1" },
    });
  }, false);

  const watched = await open("watched", null, new AbortController().signal);
  const read = new Response(watched).text().catch((error: unknown) => error);
  const channel = await host.promise;

  for (let beat = 0; beat < 4; beat += 1) {
    await vi.advanceTimersByTimeAsync(30_000);
    channel.enqueue(encoder.encode(": ping\n\n"));
    await vi.advanceTimersByTimeAsync(0);
  }

  expect(await Promise.race([aborted.promise, Promise.resolve("open")])).toBe("open");
  await vi.advanceTimersByTimeAsync(45_000);
  const error = await read;

  expect(error).toBeInstanceOf(SdkError);
  expect(linkLost(error)).toBe(true);
});
