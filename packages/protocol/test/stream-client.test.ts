import type { Json } from "@nyte-ai/schema";
import { expect, it, vi } from "vitest";
import { parseJson } from "../src/json.ts";
import { CANCEL_PATH, CHANNEL_HEADER, CHANNEL_PATH, STREAM_HEADER } from "../src/stream-channel.ts";
import { createStreamClient } from "../src/stream-client.ts";

it("cancels a stream the client lets go of, never one the host ended", async () => {
  const encoder = new TextEncoder();
  const host = Promise.withResolvers<ReadableStreamDefaultController<Uint8Array>>();
  const streams = new Map<string, string | undefined>();
  const canceled: Json[] = [];

  const open = createStreamClient(async (path, init) => {
    if (path === CHANNEL_PATH)
      return new Response(new ReadableStream({ start: (controller) => host.resolve(controller) }), {
        headers: { [CHANNEL_HEADER]: "c1" },
      });

    if (path === CANCEL_PATH) canceled.push(parseJson(await new Response(init.body).text()));
    else streams.set(path, init.headers[STREAM_HEADER]);

    return new Response(null);
  });

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
  await vi.waitFor(() => expect(canceled.length).toBeGreaterThan(0));

  expect(canceled).toEqual([{ channel: "c1", stream: streams.get("released") }]);
  await kept.cancel();
  channel.close();
});
