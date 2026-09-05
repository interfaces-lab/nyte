/**
 * The client against a scripted `fetch`: what it sends, and what it does
 * with replies the protocol does not allow. The end-to-end behavior against
 * a real SDK lives in `@nyte-ai/server`'s tests.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { sessionId, type CallReply } from "@nyte-ai/protocol";
import { createNyteClient, NyteTransportError, NyteWireError } from "../src/index.ts";

interface Seen {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly body: string | undefined;
}

function scripted(reply: (seen: Seen) => Response | Promise<Response>) {
  const seen: Seen[] = [];
  const fetchFn: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    const entry: Seen = {
      url: request.url,
      method: request.method,
      headers: request.headers,
      body: request.body === null ? undefined : await request.text(),
    };
    seen.push(entry);
    return reply(entry);
  };
  return { seen, fetchFn };
}

function json(status: number, body: CallReply, contentType = "application/json"): Response {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": contentType } });
}

/** The client's own error out of a rejected promise, or a failed assertion. */
async function caught(promise: Promise<unknown>): Promise<NyteWireError | NyteTransportError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof NyteWireError || error instanceof NyteTransportError) return error;
    throw error;
  }
  return assert.fail("expected the promise to reject");
}

async function drained(events: AsyncIterable<{ readonly kind: string }>): Promise<string[]> {
  const kinds: string[] = [];
  for await (const event of events) kinds.push(event.kind);
  return kinds;
}

const sid = sessionId("s1");
const synced = (seq: number) => `event: event\ndata: {"seq":${String(seq)},"kind":"synced"}\n\n`;
const sse = (frames: string): Response =>
  new Response(frames, { status: 200, headers: { "content-type": "text/event-stream" } });

/** A stream that never closes on its own, so only a client-side cancel ends it. */
function openStream(frames: string) {
  let cancelled = false;
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      controller.enqueue(new TextEncoder().encode(frames));
    },
    cancel() {
      cancelled = true;
    },
  });
  const fetchFn: typeof fetch = () =>
    Promise.resolve(new Response(stream, { headers: { "content-type": "text/event-stream" } }));
  return { fetchFn, isCancelled: () => cancelled };
}

test("a call is one POST with the bearer token, the caller's headers, and an explicit input envelope", async () => {
  const { seen, fetchFn } = scripted(() => json(200, { ok: true, defined: false }));
  const client = createNyteClient({
    baseUrl: "http://h.test/prefix/",
    token: "t".repeat(16),
    headers: { "x-trace": "abc" },
    fetch: fetchFn,
  });
  assert.equal(await client.sessions.get({ sessionId: sid }), undefined);
  const [call] = seen;
  assert.ok(call);
  assert.equal(call.url, "http://h.test/prefix/v1/call/sessions.get");
  assert.equal(call.method, "POST");
  assert.equal(call.headers.get("authorization"), `Bearer ${"t".repeat(16)}`);
  assert.equal(call.headers.get("x-trace"), "abc");
  assert.equal(call.headers.get("content-type"), "application/json");
  assert.deepEqual(JSON.parse(call.body ?? ""), { input: { sessionId: "s1" } });
});

test("a verb without input sends an empty envelope, not an input key", async () => {
  const { seen, fetchFn } = scripted(() =>
    json(200, { ok: true, defined: true, value: { lanes: [], drain: "one" } }),
  );
  const client = createNyteClient({ baseUrl: "http://h.test", fetch: fetchFn });
  await client.landing();
  assert.deepEqual(JSON.parse(seen[0]?.body ?? ""), {});
});

test("a value that does not match the verb's output schema is a transport failure, not a value", async () => {
  const { fetchFn } = scripted(() =>
    json(200, { ok: true, defined: true, value: { sessionId: "s1", bogus: true } }),
  );
  const client = createNyteClient({ baseUrl: "http://h.test", fetch: fetchFn });
  const error = await caught(client.sessions.get({ sessionId: sid }));
  assert.ok(error instanceof NyteTransportError);
  assert.equal(error.failure.kind, "bad_body");
});

test("an undefined reply to a verb whose output is required is refused", async () => {
  const { fetchFn } = scripted(() => json(200, { ok: true, defined: false }));
  const client = createNyteClient({ baseUrl: "http://h.test", fetch: fetchFn });
  const error = await caught(client.plugins.catalog());
  assert.ok(error instanceof NyteTransportError);
  assert.equal(error.failure.kind, "bad_body");
});

test("an error envelope becomes a wire error carrying its code and status", async () => {
  const { fetchFn } = scripted(() =>
    json(404, { ok: false, error: { code: "unknown_session", message: "Unknown session: s1" } }),
  );
  const client = createNyteClient({ baseUrl: "http://h.test", fetch: fetchFn });
  const error = await caught(client.messages.send({ sessionId: sid, content: "hi" }));
  assert.ok(error instanceof NyteWireError);
  assert.equal(error.code, "unknown_session");
  assert.equal(error.status, 404);
});

test("a non-JSON gateway page and a rejected fetch are transport failures with their reason", async () => {
  const gateway = createNyteClient({
    baseUrl: "http://h.test",
    fetch: scripted(
      () => new Response("<h1>502</h1>", { status: 502, headers: { "content-type": "text/html" } }),
    ).fetchFn,
  });
  const page = await caught(gateway.sessions.list());
  assert.ok(page instanceof NyteTransportError);
  assert.deepEqual(page.failure, {
    kind: "bad_content_type",
    status: 502,
    contentType: "text/html",
  });

  const offline = createNyteClient({
    baseUrl: "http://h.test",
    fetch: () => Promise.reject(new Error("ECONNREFUSED")),
  });
  const refused = await caught(offline.sessions.list());
  assert.ok(refused instanceof NyteTransportError);
  assert.equal(refused.failure.kind, "network");
});

test("a refused call with a non-JSON body cancels that body", async () => {
  let cancelled = false;
  const fetchFn: typeof fetch = () =>
    Promise.resolve(
      new Response(
        new ReadableStream<Uint8Array>({
          cancel() {
            cancelled = true;
          },
        }),
        { status: 502, headers: { "content-type": "text/html" } },
      ),
    );
  const client = createNyteClient({ baseUrl: "http://h.test", fetch: fetchFn });
  await caught(client.sessions.list());
  assert.ok(cancelled);
});

test("a watch that hits end of stream without an ended frame throws disconnected after its events", async () => {
  const { seen, fetchFn } = scripted(() => sse(synced(1)));
  const client = createNyteClient({ baseUrl: "http://h.test", fetch: fetchFn });
  const events: string[] = [];
  const error = await caught(
    (async () => {
      for await (const event of client.watch({ sessionId: sid, afterSeq: 3 }))
        events.push(event.kind);
    })(),
  );
  assert.ok(error instanceof NyteTransportError);
  assert.equal(error.failure.kind, "disconnected");
  assert.deepEqual(events, ["synced"]);
  const url = new URL(seen[0]?.url ?? "");
  assert.equal(url.pathname, "/v1/watch");
  assert.equal(url.searchParams.get("sessionId"), "s1");
  assert.equal(url.searchParams.get("after"), "3");
  assert.equal(url.searchParams.size, 2);
  assert.equal(seen[0]?.method, "GET");
});

test("a watch ended by the server completes normally; an error frame throws its code", async () => {
  const ended = createNyteClient({
    baseUrl: "http://h.test",
    fetch: scripted(() => sse(`${synced(2)}event: ended\ndata: {}\n\n`)).fetchFn,
  });
  assert.deepEqual(await drained(ended.watch({ sessionId: sid, live: true })), ["synced"]);

  const failing = createNyteClient({
    baseUrl: "http://h.test",
    fetch: scripted(() => sse('event: error\ndata: {"code":"closed","message":"bye"}\n\n')).fetchFn,
  });
  const error = await caught(
    failing.watch({ sessionId: sid, live: true })[Symbol.asyncIterator]().next(),
  );
  assert.ok(error instanceof NyteWireError);
  assert.equal(error.code, "closed");
  assert.equal(error.status, undefined);
});

test("a refused watch reports the JSON error the server answered with", async () => {
  const client = createNyteClient({
    baseUrl: "http://h.test",
    fetch: scripted(() =>
      json(409, { ok: false, error: { code: "cursor_expired", message: "old", floor: 12 } }),
    ).fetchFn,
  });
  const error = await caught(
    client.watch({ sessionId: sid, afterSeq: 1 })[Symbol.asyncIterator]().next(),
  );
  assert.ok(error instanceof NyteWireError);
  assert.equal(error.status, 409);
  assert.ok(error.error.code === "cursor_expired" && error.error.floor === 12);
});

test("returning the iterator while a read is pending resolves that read as done and aborts the request", async () => {
  let aborted = false;
  const fetchFn: typeof fetch = (_input, init) => {
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(synced(1)));
      },
      cancel() {
        aborted = true;
      },
    });
    init?.signal?.addEventListener("abort", () => {
      aborted = true;
    });
    return Promise.resolve(
      new Response(stream, { headers: { "content-type": "text/event-stream" } }),
    );
  };
  const client = createNyteClient({ baseUrl: "http://h.test", fetch: fetchFn });
  const iterator = client.watch({ sessionId: sid, live: true })[Symbol.asyncIterator]();
  const first = await iterator.next();
  assert.equal(first.done, false);
  const pending = iterator.next();
  await iterator.return?.();
  assert.deepEqual(await pending, { done: true, value: undefined });
  assert.ok(aborted);
});

test("after return, buffered events are not yielded and the body is cancelled", async () => {
  const { fetchFn, isCancelled } = openStream(synced(1) + synced(2));
  const client = createNyteClient({ baseUrl: "http://h.test", fetch: fetchFn });
  const iterator = client.watch({ sessionId: sid, live: true })[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).done, false);
  await iterator.return?.();
  assert.deepEqual(await iterator.next(), { done: true, value: undefined });
  assert.ok(isCancelled());
});

test("an ended frame releases the body; a malformed frame fails and releases it too", async () => {
  const ended = openStream(`${synced(1)}event: ended\ndata: {}\n\n`);
  const client = createNyteClient({ baseUrl: "http://h.test", fetch: ended.fetchFn });
  assert.deepEqual(await drained(client.watch({ sessionId: sid, live: true })), ["synced"]);
  assert.ok(ended.isCancelled());

  const malformed = openStream(`${synced(1)}event: event\ndata: {"seq":"x"}\n\n`);
  const broken = createNyteClient({ baseUrl: "http://h.test", fetch: malformed.fetchFn });
  const error = await caught(drained(broken.watch({ sessionId: sid, live: true })));
  assert.ok(error instanceof NyteTransportError);
  assert.equal(error.failure.kind, "bad_body");
  assert.ok(malformed.isCancelled());
});

test("an ended frame whose data is not an object is a malformed stream, not completion", async () => {
  const { fetchFn, isCancelled } = openStream(`${synced(1)}event: ended\ndata: 42\n\n`);
  const client = createNyteClient({ baseUrl: "http://h.test", fetch: fetchFn });
  const error = await caught(drained(client.watch({ sessionId: sid, live: true })));
  assert.ok(error instanceof NyteTransportError);
  assert.equal(error.failure.kind, "bad_body");
  assert.ok(isCancelled());
});

test("a response that arrives after the iterator was returned is cancelled, not read", async () => {
  const { fetchFn, isCancelled } = openStream(synced(1));
  let requested = false;
  const late: typeof fetch = (input, init) => {
    requested = true;
    return new Promise((resolve) => setTimeout(() => resolve(fetchFn(input, init)), 20));
  };
  const client = createNyteClient({ baseUrl: "http://h.test", fetch: late });
  const iterator = client.watch({ sessionId: sid, live: true })[Symbol.asyncIterator]();
  const pending = iterator.next();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(requested);
  await iterator.return?.();
  assert.deepEqual(await pending, { done: true, value: undefined });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.ok(isCancelled());
});

test("a reader failure mid-stream is a transport failure, not a bare error", async () => {
  const fetchFn: typeof fetch = () => {
    let pulls = 0;
    const stream = new ReadableStream<Uint8Array>({
      pull(controller) {
        pulls += 1;
        if (pulls === 1) controller.enqueue(new TextEncoder().encode(synced(1)));
        else controller.error(new Error("socket reset"));
      },
    });
    return Promise.resolve(
      new Response(stream, { headers: { "content-type": "text/event-stream" } }),
    );
  };
  const client = createNyteClient({ baseUrl: "http://h.test", fetch: fetchFn });
  const kinds: string[] = [];
  const error = await caught(
    (async () => {
      for await (const event of client.watch({ sessionId: sid, live: true }))
        kinds.push(event.kind);
    })(),
  );
  assert.ok(error instanceof NyteTransportError);
  assert.equal(error.failure.kind, "network");
  assert.deepEqual(kinds, ["synced"]);
});

test("a frame larger than the client's bound ends the watch as bad_body and releases the body", async () => {
  const { fetchFn, isCancelled } = openStream(`${synced(1)}event: event\ndata: ${"x".repeat(200)}`);
  const client = createNyteClient({ baseUrl: "http://h.test", fetch: fetchFn, maxFrameChars: 128 });
  const kinds: string[] = [];
  const error = await caught(
    (async () => {
      for await (const event of client.watch({ sessionId: sid, live: true }))
        kinds.push(event.kind);
    })(),
  );
  assert.ok(error instanceof NyteTransportError);
  assert.equal(error.failure.kind, "bad_body");
  assert.deepEqual(kinds, ["synced"]);
  assert.ok(isCancelled());
});
