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
  return {
    fetchFn,
    get cancelled() {
      return cancelled;
    },
  };
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

test("an operation without input sends an empty envelope, not an input key", async () => {
  const { seen, fetchFn } = scripted(() => json(200, { ok: true, defined: true, value: [] }));
  const client = createNyteClient({ baseUrl: "http://h.test", fetch: fetchFn });
  await client.provider.models.list();
  assert.deepEqual(JSON.parse(seen[0]?.body ?? ""), {});
});

test("info is one GET with the bearer token, and any wire version but this one is malformed", async () => {
  const { seen, fetchFn } = scripted(() =>
    json(200, {
      ok: true,
      defined: true,
      value: { version: "1.2.3", wireVersion: 1, host: { kind: "unspecified" } },
    }),
  );
  const client = createNyteClient({
    baseUrl: "http://h.test",
    token: "t".repeat(16),
    fetch: fetchFn,
  });
  assert.deepEqual(await client.info(), {
    version: "1.2.3",
    wireVersion: 1,
    host: { kind: "unspecified" },
  });
  assert.equal(seen[0]?.url, "http://h.test/v1/info");
  assert.equal(seen[0]?.method, "GET");
  assert.equal(seen[0]?.headers.get("authorization"), `Bearer ${"t".repeat(16)}`);
  assert.equal(seen[0]?.body, undefined);

  for (const value of [{ version: "9.0.0", wireVersion: 2 }, { version: 3 }]) {
    const malformed = createNyteClient({
      baseUrl: "http://h.test",
      fetch: scripted(() => json(200, { ok: true, defined: true, value })).fetchFn,
    });
    const bad = await caught(malformed.info());
    assert.ok(bad instanceof NyteTransportError);
    assert.equal(bad.failure.kind, "bad_body");
  }
});

test("a value that does not match the operation's output schema is a transport failure, not a value", async () => {
  const { fetchFn } = scripted(() =>
    json(200, { ok: true, defined: true, value: { sessionId: "s1", bogus: true } }),
  );
  const client = createNyteClient({ baseUrl: "http://h.test", fetch: fetchFn });
  const error = await caught(client.sessions.get({ sessionId: sid }));
  assert.ok(error instanceof NyteTransportError);
  assert.equal(error.failure.kind, "bad_body");
});

test("an environment call posts to its wire name and checks the reply against that operation", async () => {
  const { seen, fetchFn } = scripted(() =>
    json(200, { ok: true, defined: true, value: { kind: "unknown" } }),
  );
  const client = createNyteClient({ baseUrl: "http://h.test", fetch: fetchFn });
  assert.deepEqual(await client.environment("environment.loginAttempt", { attempt: "a1" }), {
    kind: "unknown",
  });
  const error = await caught(client.environment("environment.github.state", undefined));
  assert.ok(error instanceof NyteTransportError);
  assert.equal(error.failure.kind, "bad_body");
  assert.deepEqual(
    seen.map((call) => [call.url, call.body]),
    [
      ["http://h.test/v1/call/environment.loginAttempt", '{"input":{"attempt":"a1"}}'],
      ["http://h.test/v1/call/environment.github.state", "{}"],
    ],
  );
});

test("a GitHub reply whose links leave github.com is refused before the client can open them", async () => {
  const answers = [
    { kind: "created", url: "https://github.com/owner/repo/pull/13" },
    { kind: "created", url: "https://evil.test/owner/repo/pull/13" },
    { kind: "created", url: "javascript:alert(1)" },
    {
      kind: "ready",
      repository: { owner: "o", name: "r", remoteName: "origin", url: "http://github.com/o/r" },
      account: { login: "octocat" },
      pullRequest: { kind: "none" },
    },
  ];
  const client = createNyteClient({
    baseUrl: "http://h.test",
    fetch: scripted(() => json(200, { ok: true, defined: true, value: answers.shift() })).fetchFn,
  });
  assert.deepEqual(
    await client.environment("environment.github.createPullRequest", { title: "feat: ship" }),
    { kind: "created", url: "https://github.com/owner/repo/pull/13" },
  );
  for (const call of [
    () => client.environment("environment.github.createPullRequest", { title: "feat: ship" }),
    () => client.environment("environment.github.createPullRequest", { title: "feat: ship" }),
    () => client.environment("environment.github.state", undefined),
  ]) {
    const error = await caught(call());
    assert.ok(error instanceof NyteTransportError);
    assert.equal(error.failure.kind, "bad_body");
  }
});

test("an undefined reply to an operation whose output is required is refused", async () => {
  const { fetchFn } = scripted(() => json(200, { ok: true, defined: false }));
  const client = createNyteClient({ baseUrl: "http://h.test", fetch: fetchFn });
  const error = await caught(client.plugins.catalog());
  assert.ok(error instanceof NyteTransportError);
  assert.equal(error.failure.kind, "bad_body");
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
  const stream = openStream(synced(1) + synced(2));
  const client = createNyteClient({ baseUrl: "http://h.test", fetch: stream.fetchFn });
  const iterator = client.watch({ sessionId: sid, live: true })[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).done, false);
  await iterator.return?.();
  assert.deepEqual(await iterator.next(), { done: true, value: undefined });
  assert.ok(stream.cancelled);
});

test("an ended frame releases the body; a malformed frame fails and releases it too", async () => {
  const ended = openStream(`${synced(1)}event: ended\ndata: {}\n\n`);
  const client = createNyteClient({ baseUrl: "http://h.test", fetch: ended.fetchFn });
  assert.deepEqual(await drained(client.watch({ sessionId: sid, live: true })), ["synced"]);
  assert.ok(ended.cancelled);

  const malformed = openStream(`${synced(1)}event: event\ndata: {"seq":"x"}\n\n`);
  const broken = createNyteClient({ baseUrl: "http://h.test", fetch: malformed.fetchFn });
  const error = await caught(drained(broken.watch({ sessionId: sid, live: true })));
  assert.ok(error instanceof NyteTransportError);
  assert.equal(error.failure.kind, "bad_body");
  assert.ok(malformed.cancelled);
});

test("an ended frame whose data is not an object is a malformed stream, not completion", async () => {
  const stream = openStream(`${synced(1)}event: ended\ndata: 42\n\n`);
  const client = createNyteClient({ baseUrl: "http://h.test", fetch: stream.fetchFn });
  const error = await caught(drained(client.watch({ sessionId: sid, live: true })));
  assert.ok(error instanceof NyteTransportError);
  assert.equal(error.failure.kind, "bad_body");
  assert.ok(stream.cancelled);
});

test("a response that arrives after the iterator was returned is cancelled, not read", async () => {
  const stream = openStream(synced(1));
  let requested = false;
  const late: typeof fetch = (input, init) => {
    requested = true;
    return new Promise((resolve) => setTimeout(() => resolve(stream.fetchFn(input, init)), 20));
  };
  const client = createNyteClient({ baseUrl: "http://h.test", fetch: late });
  const iterator = client.watch({ sessionId: sid, live: true })[Symbol.asyncIterator]();
  const pending = iterator.next();
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.ok(requested);
  await iterator.return?.();
  assert.deepEqual(await pending, { done: true, value: undefined });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.ok(stream.cancelled);
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
  const stream = openStream(`${synced(1)}event: event\ndata: ${"x".repeat(200)}`);
  const client = createNyteClient({
    baseUrl: "http://h.test",
    fetch: stream.fetchFn,
    maxFrameChars: 128,
  });
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
  assert.ok(stream.cancelled);
});

test("calls and refused watches distinguish malformed JSON, bad envelopes, unexpected statuses, and error envelopes", async () => {
  for (const [body, kind] of [
    ["{", "bad_body"],
    ['{"ok":true}', "bad_body"],
    ['{"ok":true,"defined":false}', "bad_status"],
    ['{"ok":false,"error":{"code":"closed","message":"closing"}}', "wire"],
  ]) {
    const client = createNyteClient({
      baseUrl: "http://h.test",
      fetch: scripted(
        () =>
          new Response(body, {
            status: 503,
            headers: { "content-type": "application/json" },
          }),
      ).fetchFn,
    });
    for (const operation of [
      () => client.sessions.get({ sessionId: sid }),
      () => client.watch({ sessionId: sid, live: true })[Symbol.asyncIterator]().next(),
    ]) {
      const error = await caught(operation());

      if (kind === "wire") {
        assert.ok(error instanceof NyteWireError);
        assert.deepEqual([error.code, error.status], ["closed", 503]);
      } else {
        assert.ok(error instanceof NyteTransportError);
        assert.equal(error.failure.kind, kind);
      }
    }
  }
});

test("an invalid watch frame throws once after preceding events and releases the body", async () => {
  for (const frame of [
    "event: constructor\ndata: {}\n\n",
    "event: event\ndata: {\n\n",
    "event: error\ndata: {}\n\n",
  ]) {
    const stream = openStream(synced(1) + frame);
    const client = createNyteClient({ baseUrl: "http://h.test", fetch: stream.fetchFn });
    const iterator = client.watch({ sessionId: sid, live: true })[Symbol.asyncIterator]();
    assert.deepEqual(await iterator.next(), { done: false, value: { kind: "synced", seq: 1 } });
    const error = await caught(iterator.next());
    assert.ok(error instanceof NyteTransportError);
    assert.equal(error.failure.kind, "bad_body");
    assert.ok(stream.cancelled);
    assert.deepEqual(await iterator.next(), { done: true, value: undefined });
  }
});

test("a watch error frame throws its code, unless the watch was returned before reading it", async () => {
  const frames = `${synced(1)}event: error\ndata: {"code":"closed","message":"bye"}\n\n`;
  const read = createNyteClient({ baseUrl: "http://h.test", fetch: openStream(frames).fetchFn });
  const thrown = await caught(drained(read.watch({ sessionId: sid, live: true })));
  assert.ok(thrown instanceof NyteWireError);
  assert.deepEqual([thrown.code, thrown.status], ["closed", undefined]);

  const stream = openStream(frames);
  const client = createNyteClient({ baseUrl: "http://h.test", fetch: stream.fetchFn });
  const iterator = client.watch({ sessionId: sid, live: true })[Symbol.asyncIterator]();
  assert.equal((await iterator.next()).done, false);
  await iterator.return?.();
  assert.deepEqual(await iterator.next(), { done: true, value: undefined });
  assert.ok(stream.cancelled);
});
