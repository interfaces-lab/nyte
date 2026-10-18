import { assert, expect, it } from "vitest";
import { definePart } from "@nyte-ai/core";
import { SdkError, standard } from "@nyte-ai/schema";
import { Type } from "typebox";
import {
  CHANNEL_HEADER,
  CHANNEL_PATH,
  STREAM_HEADER,
  createStreamClient,
  createTransport,
  decodeOutput,
  parseSse,
  sseFrames,
} from "@nyte-ai/protocol";
import { createStreamChannels } from "../../src/serve/stream-server.ts";
import { served, post } from "./fakes.ts";

it.each([1, 128])("delivers a large replay in %i frames and continues its peer", async (count) => {
  const { owner } = await served();
  const channels = createStreamChannels();
  const controller = new AbortController();
  const content = "x".repeat((12 * 1024 * 1024) / count);

  const stream = createStreamClient(async (path, init) => {
    const request = new Request(`http://host.test/${path}`, { ...init, method: "POST" });

    if (path === CHANNEL_PATH) return channels.open(owner, request.signal, true);
    const channel = request.headers.get(CHANNEL_HEADER);
    const id = request.headers.get(STREAM_HEADER);

    if (channel === null || id === null) return new Response(null, { status: 204 });

    return channels.start(
      owner,
      channel,
      id,
      request.signal,
      async () =>
        new Response(
          sseFrames({
            async *[Symbol.asyncIterator]() {
              for (let index = 0; index < (path === "large" ? count : 1); index += 1)
                yield path === "large" ? content : "peer";
            },
          }),
        ),
    );
  }, true);

  try {
    const [large, peer] = await Promise.all([
      stream("large", {}, controller.signal),
      stream("peer", {}, controller.signal),
    ]);

    const frames = parseSse(large);
    const peers = parseSse(peer);
    expect(await peers.next()).toEqual({ done: false, value: "peer" });

    for (let index = 0; index < count; index += 1)
      expect(await frames.next()).toEqual({ done: false, value: content });
    expect(await frames.next()).toEqual({ done: true, value: undefined });
    expect(await peers.next()).toEqual({ done: true, value: undefined });
  } finally {
    controller.abort();
  }
});

it("cancels one waiter during a shared handshake without canceling its peer", async () => {
  const { owner } = await served();
  const channels = createStreamChannels();
  const gate = Promise.withResolvers<void>();
  const first = new AbortController();
  const second = new AbortController();
  let closed = false;

  const stream = createStreamClient(async (path, init) => {
    const request = new Request(`http://host.test/${path}`, { ...init, method: "POST" });

    if (path === CHANNEL_PATH) {
      request.signal.addEventListener(
        "abort",
        () => {
          closed = true;
        },
        { once: true },
      );
      await gate.promise;

      return channels.open(owner, request.signal, true);
    }

    const channel = request.headers.get(CHANNEL_HEADER);
    const id = request.headers.get(STREAM_HEADER);

    if (channel === null || id === null) return new Response(null, { status: 204 });

    return channels.start(owner, channel, id, request.signal, async () => new Response("kept"));
  }, true);

  const canceled = stream("run.settled", {}, first.signal);
  const kept = stream("run.settled", {}, second.signal);
  first.abort(new Error("First canceled"));
  await expect(canceled).rejects.toThrow("First canceled");
  expect(closed).toBe(false);
  gate.resolve();
  expect(await new Response(await kept).text()).toBe("kept");
  expect(closed).toBe(true);
});

it("registers twelve pending answers without occupying twelve HTTP responses", async () => {
  const question = definePart({
    kind: "test/multiplex-question",
    state: standard(Type.Object({ title: Type.String() })),
    actions: { answer: { input: standard(Type.Object({ choice: Type.String() })) } },
    fallback: (state) => state.title,
  });

  const { handler } = await served({
    plugins: [{ id: "questions", contribute: { parts: [question] } }],
  });

  let channels = 0;
  let registered = 0;

  const transport = createTransport({
    url: "http://host.test",
    headers: async () => ({ Authorization: "Bearer owner" }),
    fetch: async (input, init) => {
      const request = new Request(input, init);
      const response = await handler(request);

      if (new URL(request.url).pathname === `/${CHANNEL_PATH}`) channels += 1;

      if (new URL(request.url).pathname === "/part.answer" && response.status === 202)
        registered += 1;

      return response;
    },
  });

  const { session } = decodeOutput(
    "sessions.start",
    await transport.invoke("sessions.start", { id: crypto.randomUUID(), content: "Hi." }),
  );

  const { part } = decodeOutput(
    "parts.create",
    await transport.invoke("parts.create", {
      session,
      kind: question.kind,
      input: { state: { title: "Pick" }, placement: { kind: "modal" } },
    }),
  );

  const answers = Promise.all(
    Array.from({ length: 12 }, () => transport.invoke("part.answer", { session, part })),
  );

  await expect.poll(() => registered).toBe(12);
  expect(channels).toBe(1);
  await transport.invoke("part.act", { session, part, action: "answer", input: { choice: "yes" } });
  expect(await answers).toEqual(
    Array.from({ length: 12 }, () => ({ action: "answer", input: { choice: "yes" } })),
  );
});

it("keeps twelve watches on one response while commands and other watches continue", async () => {
  const { handler } = await served();
  let channels = 0;
  let open = 0;

  const transport = createTransport({
    url: "http://host.test",
    headers: async () => ({ Authorization: "Bearer owner" }),
    fetch: async (input, init) => {
      const request = new Request(input, init);

      if (new URL(request.url).pathname === `/${CHANNEL_PATH}`) {
        channels += 1;
        open += 1;
        request.signal.addEventListener(
          "abort",
          () => {
            open -= 1;
          },
          { once: true },
        );
      }

      return handler(request);
    },
  });

  const watches = Array.from({ length: 12 }, () =>
    transport.frames("sessions.watch", {})[Symbol.asyncIterator](),
  );

  try {
    const initial = await Promise.all(watches.map((watch) => watch.next()));
    expect(initial.every((frame) => !frame.done && Array.isArray(frame.value))).toBe(true);
    expect([channels, open]).toEqual([1, 1]);
    const first = watches[0];
    assert(first !== undefined);
    const pending = first.next();
    await first.return?.();
    expect(await pending).toEqual({ done: true, value: undefined });

    const { session } = decodeOutput(
      "sessions.start",
      await transport.invoke("sessions.start", { id: crypto.randomUUID(), content: "Hi." }),
    );

    const changed = await Promise.all(watches.slice(1).map((watch) => watch.next()));

    for (const frame of changed) {
      assert(!frame.done);
      expect(decodeOutput("sessions.watch", frame.value).map((row) => row.id)).toEqual([session]);
    }

    expect([channels, open]).toEqual([1, 1]);
  } finally {
    await Promise.all(
      watches.map(async (watch) => {
        await watch.return?.();
      }),
    );
  }

  await expect.poll(() => open).toBe(0);
});

it("checks channel ownership and operation authority independently", async () => {
  const { handler } = await served();
  const controller = new AbortController();
  const response = await post(handler, CHANNEL_PATH, {}, undefined, controller.signal);
  const channel = response.headers.get(CHANNEL_HEADER);
  assert(channel !== null);

  try {
    const stolen = await post(
      handler,
      "sessions.watch",
      {},
      {
        Authorization: "Bearer guest",
        [CHANNEL_HEADER]: channel,
        [STREAM_HEADER]: "stolen",
      },
    );

    expect(stolen.status).toBe(403);

    const denied = await post(
      handler,
      "principals.list",
      {},
      {
        Authorization: "Bearer guest",
        [CHANNEL_HEADER]: channel,
        [STREAM_HEADER]: "owner-row",
      },
    );

    expect(denied.status).toBe(403);
    expect((await post(handler, CHANNEL_PATH, {}, { Authorization: "" })).status).toBe(401);
  } finally {
    controller.abort();
    await response.body?.cancel();
  }
});

it("pauses a blocked channel's sources and releases them on cancellation", async () => {
  const { owner } = await served();
  const channels = createStreamChannels();
  const controller = new AbortController();
  const response = channels.open(owner, controller.signal, false);
  const id = response.headers.get(CHANNEL_HEADER);
  assert(id !== null && response.body !== null);
  let canceled = false;
  let produced = 0;
  await channels.start(
    owner,
    id,
    "large",
    controller.signal,
    async () =>
      new Response(
        new ReadableStream<Uint8Array>({
          pull(stream) {
            produced += 1;
            stream.enqueue(new Uint8Array(64 * 1024));
          },
          cancel() {
            canceled = true;
          },
        }),
      ),
  );
  await new Promise((resolve) => setTimeout(resolve, 0));
  const paused = produced;
  expect(paused).toBeGreaterThan(1);
  expect(paused).toBeLessThan(128);
  await new Promise((resolve) => setTimeout(resolve, 20));
  expect(produced).toBe(paused);
  expect(canceled).toBe(false);
  controller.abort();
  await expect.poll(() => canceled).toBe(true);
  const frames = parseSse(response.body);
  await expect(frames.next()).rejects.toMatchObject({
    code: "unavailable",
    message: "The stream channel disconnected.",
  });
});

it("preserves a revocation error for all logical streams", async () => {
  const { handler } = await served();
  const revoke = new AbortController();

  const transport = createTransport({
    url: "http://host.test",
    headers: async () => ({ Authorization: "Bearer owner" }),
    fetch: async (input, init) => {
      const request = new Request(input, init);

      return handler(
        new Request(request, {
          signal: AbortSignal.any([request.signal, revoke.signal]),
        }),
      );
    },
  });

  const watches = Array.from({ length: 3 }, () =>
    transport.frames("sessions.watch", {})[Symbol.asyncIterator](),
  );

  await Promise.all(watches.map((watch) => watch.next()));
  const pending = watches.map((watch) => watch.next());
  revoke.abort(new SdkError("unauthenticated", "The principal was revoked."));

  for (const next of pending) await expect(next).rejects.toMatchObject({ code: "unauthenticated" });
  await Promise.all(
    watches.map(async (watch) => {
      await watch.return?.();
    }),
  );
});
