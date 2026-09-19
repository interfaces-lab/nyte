/**
 * The wire end to end: a real `createNyte` over an in-memory SQLite store,
 * the server handler called as a function, and the client driving it through
 * its `fetch` option. No socket, no runner, no model: every scene here is
 * what a remote client can do to a host that has not attached a runner.
 */
import assert from "node:assert/strict";
import { afterEach, test } from "vitest";
import { createNyteClient, NyteTransportError, NyteWireError } from "@nyte-ai/client";
import {
  createNyte,
  type Nyte,
  type ModelCatalog,
  type JobInfo,
  type SessionActivationResolver,
  type SessionEvent,
  type SessionId,
} from "@nyte-ai/core";
import { CallReplySchema, sessionId, type ServerDescription } from "@nyte-ai/protocol";
import { SqliteStore } from "@nyte-ai/core/store";
import { Value } from "typebox/value";
import type { Api, Model } from "@nyte-ai/schema";
import { createNyteServer, type NyteServerOptions, type ServerFailure } from "../src/index.ts";

const TOKEN = "café-token-0123456789abcdef";
const BASE = "http://nyte.test";
const VERSION = "0.0.2-test";

const model: Model<Api> = {
  id: "echo-model",
  name: "Echo",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 2, output: 7, cacheRead: 0.2, cacheWrite: 1 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};

const description: ServerDescription = {
  capabilities: { workspace: false },
  persistence: "durable",
};

const cleanups: (() => Promise<void> | void)[] = [];
afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

interface FixtureOptions {
  readonly models?: ModelCatalog;
  /** Wrap the real SDK before the server sees it, to observe or to fail an operation. */
  readonly wrap?: (sdk: Nyte) => Nyte;
  readonly server?: Partial<Omit<NyteServerOptions, "sdk">>;
  readonly token?: string;
  readonly resolveActivation?: SessionActivationResolver;
}

async function fixture(options: FixtureOptions = {}) {
  const store = new SqliteStore(":memory:", { watchPollIntervalMs: 5 });
  const base = {
    store,
    streamFn: () => {
      throw new Error("These scenes never reach a model");
    },
    models: options.models ?? {
      getModels: () => [model],
      getModel: (_provider: string, id: string) => (id === model.id ? model : undefined),
      getAvailable: async () => [model],
    },
    model,
  };
  const nyte = await createNyte(
    options.resolveActivation === undefined
      ? { ...base, plugins: [], env: { cwd: "/tmp/nowhere" } }
      : { ...base, resolveActivation: options.resolveActivation },
  );
  cleanups.push(
    () => nyte.close(),
    () => store.close(),
  );
  const failures: ServerFailure[] = [];
  const server = createNyteServer({
    sdk: options.wrap?.(nyte) ?? nyte,
    version: VERSION,
    auth: { kind: "token", token: TOKEN },
    heartbeatMs: 0,
    onError: (failure) => failures.push(failure),
    ...options.server,
  });
  cleanups.push(() => server.close());
  const fetchFn: typeof fetch = (input, init) => server.fetch(new Request(input, init));
  const client = createNyteClient({
    baseUrl: BASE,
    fetch: fetchFn,
    token: options.token ?? TOKEN,
  });
  const raw = (path: string, init: RequestInit = {}): Promise<Response> => {
    const headers = new Headers(init.headers);
    if (!headers.has("authorization")) headers.set("authorization", `Bearer ${TOKEN}`);
    return server.fetch(new Request(`${BASE}${path}`, { ...init, headers }));
  };
  return { nyte, store, server, client, raw, failures };
}

function post(body: string, headers: Record<string, string> = {}): RequestInit {
  return { method: "POST", headers: { "content-type": "application/json", ...headers }, body };
}

async function errorOf(response: Response): Promise<{ status: number; code: string }> {
  const reply: unknown = await response.json();
  assert.ok(Value.Check(CallReplySchema, reply), "the reply is the protocol envelope");
  assert.ok(!reply.ok, "the reply is an error");
  return { status: response.status, code: reply.error.code };
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

async function take(
  events: AsyncIterable<SessionEvent>,
  count: number,
  timeoutMs = 3_000,
): Promise<SessionEvent[]> {
  const taken: SessionEvent[] = [];
  const timer = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`took ${String(taken.length)} of ${String(count)}`)),
      timeoutMs,
    );
  });
  await Promise.race([
    (async () => {
      for await (const event of events) {
        taken.push(event);
        if (taken.length >= count) break;
      }
    })(),
    timer,
  ]);
  return taken;
}

/** Land a user commit on `main` through the store, the way a runner would. */
async function landCommit(store: SqliteStore, sessionId: SessionId, text: string): Promise<void> {
  const session = await store.open(sessionId);
  try {
    const [oid] = await session.objects.put([
      {
        kind: "commit",
        parent: await session.refs.read("refs/heads/main"),
        body: { kind: "message", message: { role: "user", content: text, timestamp: 1 } },
        at: 1,
      },
    ]);
    assert.ok(oid);
    const from = await session.refs.read("refs/heads/main");
    const outcome = await session.refs.update([{ name: "refs/heads/main", from, to: oid }], {
      reason: "test",
    });
    assert.ok(outcome.ok);
  } finally {
    await session.close();
  }
}

// ---------------------------------------------------------------------------
// Calls
// ---------------------------------------------------------------------------

test("remote model choices use current host availability and persist selected inputs", async () => {
  const unavailable = { ...model, id: "unconfigured", name: "Unconfigured" };
  const catalog = [model, unavailable];
  let available = [model];
  const { client } = await fixture({
    models: {
      getModels: () => catalog,
      getModel: (provider, id) =>
        catalog.find((entry) => entry.provider === provider && entry.id === id),
      getAvailable: async () => available,
    },
  });
  const choices = await client.provider.models.list();
  assert.deepEqual(
    choices.map((choice) => choice.id),
    [model.id],
  );
  assert.equal(choices[0]?.cost.input, model.cost.input);
  assert.deepEqual(choices[0]?.thinkingLevels, ["off"]);
  assert.doesNotMatch(JSON.stringify(choices), /example\.invalid/);
  const created = await client.sessions.create();
  assert.equal(
    (
      await client.sessions.configure({
        sessionId: created.sessionId,
        model: { provider: model.provider, id: model.id },
      })
    ).kind,
    "queued",
  );
  assert.deepEqual((await client.sessions.get({ sessionId: created.sessionId }))?.config.model, {
    provider: model.provider,
    id: model.id,
  });
  available = [];
  assert.deepEqual(await client.provider.models.list(), []);
});

test("create, read, list, snapshot, and rename a session through the client", async () => {
  const { client } = await fixture();
  const created = await client.sessions.create({ name: "first" });
  assert.equal(created.name, "first");
  assert.equal(created.heads[0]?.head, "main");

  const read = await client.sessions.get({ sessionId: created.sessionId });
  assert.deepEqual(read, created);
  assert.equal(
    await client.sessions.get({ sessionId: sessionId(`${created.sessionId}-missing`) }),
    undefined,
  );

  await client.sessions.rename({ sessionId: created.sessionId, name: "second" });
  const page = await client.sessions.list();
  assert.deepEqual(
    page.items.map((item) => item.name),
    ["second"],
  );

  const snapshot = await client.sessions.snapshot({ sessionId: created.sessionId });
  assert.ok(snapshot);
  assert.equal(snapshot.head, "main");
  assert.equal(snapshot.tip, null);
  assert.deepEqual(snapshot.transcript, []);
  assert.ok(Number.isInteger(snapshot.seq));
  assert.deepEqual(await client.landing(), (await fixture()).nyte.landing);
});

test("a session id with dots, slashes, and percent signs survives the query string", async () => {
  const { client } = await fixture();
  const created = await client.sessions.create({ sessionId: sessionId("../odd/id#1%25 ?&=") });
  assert.equal(created.sessionId, "../odd/id#1%25 ?&=");
  assert.equal(
    (await client.sessions.get({ sessionId: created.sessionId }))?.sessionId,
    created.sessionId,
  );
  const [synced] = await take(client.watch({ sessionId: created.sessionId, live: true }), 1);
  assert.equal(synced?.kind, "synced");
});

test("send with an idempotency key queues once and reports the duplicate with the same change", async () => {
  const { client } = await fixture();
  const { sessionId } = await client.sessions.create();
  const first = await client.messages.send({ sessionId, content: "hello", key: "k1" });
  const second = await client.messages.send({ sessionId, content: "hello", key: "k1" });
  assert.equal(first.kind, "queued");
  assert.equal(second.kind, "duplicate");
  assert.equal(first.change, second.change);

  const snapshot = await client.sessions.snapshot({ sessionId });
  assert.deepEqual(
    snapshot?.pending.map((item) => [item.change, item.content]),
    [[first.change, "hello"]],
  );
  const cancelled = await client.messages.cancel({ sessionId, change: first.change });
  assert.deepEqual(cancelled, { kind: "cancelled" });
  assert.deepEqual((await client.sessions.snapshot({ sessionId }))?.pending, []);
  assert.deepEqual(await client.messages.cancel({ sessionId, change: "no-such-change" }), {
    kind: "not_found",
  });
  assert.deepEqual(await client.runs.abort({ sessionId }), { kind: "not_running" });
});

test("run reads and replies on an idle head answer without a runner, and status starts empty", async () => {
  const { client, raw } = await fixture();
  const { sessionId } = await client.sessions.create();
  assert.equal(await client.runs.current({ sessionId }), undefined);
  assert.deepEqual(
    await client.runs.reply({
      sessionId,
      callId: "call-1",
      waitId: "missing-wait",
      reply: { ok: true },
    }),
    { kind: "not_found" },
  );
  assert.deepEqual(await client.plugins.status.list({ sessionId }), []);
  assert.deepEqual(
    await errorOf(
      await raw(
        "/v1/call/runs.reply",
        post(JSON.stringify({ input: { sessionId, callId: "call-1" } })),
      ),
    ),
    { status: 400, code: "invalid_input" },
  );
});

test("job calls dispatch through HTTP and job events round-trip through SSE", async () => {
  const job: JobInfo = {
    id: "job-1",
    head: "branch",
    origin: { kind: "run", runId: "run-1", callId: "call-1" },
    command: "pnpm test",
    phase: { kind: "running", mode: "background" },
    startedAt: 1,
    updatedAt: 2,
    output: "partial output\n",
  };
  const calls: unknown[] = [];
  const { client, raw } = await fixture({
    wrap: (sdk) => ({
      ...sdk,
      jobs: {
        ...sdk.jobs,
        async list(input) {
          calls.push(["list", input]);
          return [job];
        },
        async background(input) {
          calls.push(["background", input]);
          return { kind: "applied" };
        },
        async cancel(input) {
          calls.push(["cancel", input]);
          return { kind: "finished" };
        },
      },
      async *watch() {
        yield { seq: 3, kind: "job", job };
        yield { seq: 4, kind: "job", job: { ...job, phase: { kind: "completed" } } };
      },
    }),
  });
  const { sessionId: parentSessionId } = await client.sessions.create();
  assert.deepEqual(await client.jobs.list({ sessionId: parentSessionId }), [job]);
  assert.deepEqual(await client.jobs.list({ sessionId: parentSessionId, head: "branch" }), [job]);
  assert.deepEqual(await client.jobs.background({ sessionId: parentSessionId, jobId: job.id }), {
    kind: "applied",
  });
  assert.deepEqual(await client.jobs.cancel({ sessionId: parentSessionId, jobId: job.id }), {
    kind: "finished",
  });
  assert.deepEqual(calls, [
    ["list", { sessionId: parentSessionId }],
    ["list", { sessionId: parentSessionId, head: "branch" }],
    ["background", { sessionId: parentSessionId, jobId: job.id }],
    ["cancel", { sessionId: parentSessionId, jobId: job.id }],
  ]);
  for (const operation of ["jobs.background", "jobs.cancel"]) {
    assert.deepEqual(
      await errorOf(
        await raw(
          `/v1/call/${operation}`,
          post(
            JSON.stringify({ input: { sessionId: parentSessionId, jobId: job.id, head: "main" } }),
          ),
        ),
      ),
      { status: 400, code: "invalid_input" },
    );
  }
  assert.equal(calls.length, 4);
  const events: SessionEvent[] = [];
  for await (const event of client.watch({ sessionId: parentSessionId, live: true }))
    events.push(event);
  assert.deepEqual(events, [
    { seq: 3, kind: "job", job },
    { seq: 4, kind: "job", job: { ...job, phase: { kind: "completed" } } },
  ]);
});

test("a lane outside the landing policy is refused as invalid input before the SDK sees it", async () => {
  const { client, failures } = await fixture();
  const { sessionId } = await client.sessions.create();
  const error = await caught(client.messages.send({ sessionId, content: "x", lane: "nope" }));
  assert.ok(error instanceof NyteWireError);
  assert.equal(error.status, 400);
  assert.ok(error.error.code === "invalid_input" && error.error.issues[0]?.path === "/lane");
  assert.deepEqual(failures, []);
});

test("an unknown session is a tagged 404, not an internal error", async () => {
  const { client, failures } = await fixture();
  const error = await caught(client.messages.send({ sessionId: sessionId("ghost"), content: "x" }));
  assert.ok(error instanceof NyteWireError);
  assert.equal(error.code, "unknown_session");
  assert.equal(error.status, 404);
  assert.deepEqual(failures, []);
});

test("an operation that throws reaches the client as internal with a fixed message; the host hears the cause", async () => {
  const { client, failures } = await fixture({
    wrap: (sdk) => ({
      ...sdk,
      plugins: {
        ...sdk.plugins,
        catalog: () => Promise.reject(new TypeError("secret-token leaked")),
      },
    }),
  });
  const error = await caught(client.plugins.catalog());
  assert.ok(error instanceof NyteWireError);
  assert.equal(error.code, "internal");
  assert.equal(error.status, 500);
  assert.equal(error.message, "Internal error");
  assert.ok(!JSON.stringify(error.error).includes("secret"));
  assert.equal(failures.length, 1);
  assert.ok(failures[0]?.cause instanceof TypeError);
  assert.equal(failures[0]?.operation, "plugins.catalog");
});

test("a throwing diagnostic hook does not stop the redacted reply", async () => {
  const { client } = await fixture({
    wrap: (sdk) => ({
      ...sdk,
      workspace: { ...sdk.workspace, list: () => Promise.reject(new Error("x")) },
    }),
    server: {
      onError: () => {
        throw new Error("logger down");
      },
    },
  });
  const error = await caught(client.workspace.list());
  assert.ok(error instanceof NyteWireError);
  assert.equal(error.code, "internal");
});

// ---------------------------------------------------------------------------
// The HTTP boundary
// ---------------------------------------------------------------------------

test("malformed bodies, unknown operations, wrong methods, and oversized payloads are tagged refusals", async () => {
  const { raw } = await fixture({ server: { maxBodyBytes: 200 } });
  assert.deepEqual(await errorOf(await raw("/v1/call/sessions.get", post("{not json"))), {
    status: 400,
    code: "invalid_input",
  });
  assert.deepEqual(
    await errorOf(await raw("/v1/call/sessions.get", post('{"input":{"sessionId":5}}'))),
    { status: 400, code: "invalid_input" },
  );
  assert.deepEqual(
    await errorOf(
      await raw("/v1/call/sessions.get", post('{"input":{"sessionId":"s"},"extra":1}')),
    ),
    { status: 400, code: "invalid_input" },
  );
  assert.deepEqual(
    await errorOf(
      await raw("/v1/call/sessions.get", post('{"input":{"sessionId":"s","__proto__":{"a":1}}}')),
    ),
    { status: 400, code: "invalid_input" },
  );
  assert.deepEqual(await errorOf(await raw("/v1/call/sessions.get", post('{"input":null}'))), {
    status: 400,
    code: "invalid_input",
  });
  assert.deepEqual(await errorOf(await raw("/v1/call/nope", post("{}"))), {
    status: 404,
    code: "unknown_operation",
  });
  assert.deepEqual(await errorOf(await raw("/v1/call/constructor", post("{}"))), {
    status: 404,
    code: "unknown_operation",
  });
  assert.deepEqual(await errorOf(await raw("/v1/call/__proto__", post("{}"))), {
    status: 404,
    code: "unknown_operation",
  });
  assert.deepEqual(await errorOf(await raw("/v1/other", post("{}"))), {
    status: 404,
    code: "not_found",
  });
  assert.deepEqual(await errorOf(await raw("/v1/call/sessions.list", { method: "GET" })), {
    status: 405,
    code: "method_not_allowed",
  });
  assert.deepEqual(await errorOf(await raw("/v1/watch?sessionId=s", { method: "POST" })), {
    status: 405,
    code: "method_not_allowed",
  });
  assert.deepEqual(
    await errorOf(
      await raw("/v1/call/sessions.list", {
        method: "POST",
        headers: { "content-type": "text/plain" },
        body: "{}",
      }),
    ),
    { status: 415, code: "unsupported_media_type" },
  );
  assert.deepEqual(
    await errorOf(
      await raw("/v1/call/sessions.list", post(`{"input":{"search":"${"x".repeat(400)}"}}`)),
    ),
    { status: 413, code: "payload_too_large" },
  );
  const ok = await raw("/v1/call/sessions.list", post("{}"));
  assert.equal(ok.status, 200);
  assert.deepEqual(await ok.json(), { ok: true, defined: true, value: { items: [] } });
  const none = await raw("/v1/call/sessions.get", post('{"input":{"sessionId":"missing"}}'));
  assert.deepEqual(await none.json(), { ok: true, defined: false });
});

test("no token is 401, a wrong token is 403, and the client surfaces both", async () => {
  const anonymous = await fixture({ token: "" });
  const { raw } = anonymous;
  const noHeader = await raw("/v1/call/sessions.list", {
    ...post("{}"),
    headers: { "content-type": "application/json", authorization: "" },
  });
  assert.deepEqual(await errorOf(noHeader), { status: 401, code: "unauthorized" });
  assert.equal(noHeader.headers.get("www-authenticate"), "Bearer");
  for (const token of ["x", `${TOKEN}x`, TOKEN.replace("é", "e"), TOKEN.replace("f", "g")]) {
    assert.deepEqual(
      await errorOf(
        await raw("/v1/call/sessions.list", post("{}", { authorization: `Bearer ${token}` })),
      ),
      { status: 403, code: "forbidden" },
    );
  }
  const missing = await caught(anonymous.client.sessions.list());
  assert.ok(missing instanceof NyteWireError);
  assert.equal(missing.code, "unauthorized");
  assert.equal(missing.status, 401);
  const mistaken = await fixture({ token: "wrong-token-wrong-token" });
  const refused = await caught(mistaken.client.sessions.list());
  assert.ok(refused instanceof NyteWireError);
  assert.equal(refused.code, "forbidden");
  assert.equal(refused.status, 403);
  assert.throws(
    () =>
      createNyteServer({
        sdk: anonymous.nyte,
        version: VERSION,
        auth: { kind: "token", token: "short" },
      }),
    RangeError,
  );
  assert.throws(
    () =>
      createNyteServer({
        sdk: anonymous.nyte,
        version: VERSION,
        auth: { kind: "token", token: TOKEN },
        maxBodyBytes: Number.NaN,
      }),
    RangeError,
  );
});

// ---------------------------------------------------------------------------
// Info
// ---------------------------------------------------------------------------

test("info reports current deployment capabilities without disclosing them before authentication", async () => {
  let workspace = false;
  const { client, raw } = await fixture({
    server: { describe: () => ({ ...description, capabilities: { workspace } }) },
  });
  assert.equal((await raw("/v1/info", { headers: { authorization: "" } })).status, 401);
  const first = (await client.info()).host;
  assert.equal(first.kind, "described");
  if (first.kind === "described") assert.equal(first.capabilities.workspace, false);
  workspace = true;
  const updated = (await client.info()).host;
  assert.equal(updated.kind, "described");
  if (updated.kind === "described") assert.equal(updated.capabilities.workspace, true);
});

test("info rejects unexpected host metadata instead of publishing secrets", async () => {
  const { client, failures } = await fixture({
    server: { describe: () => ({ ...description, token: "private-value" }) },
  });
  const error = await caught(client.info());
  assert.ok(error instanceof NyteWireError);
  assert.equal(error.code, "internal");
  assert.equal(error.message, "Internal error");
  assert.equal(failures.length, 1);
});

test("info answers the host version and wire version behind auth, on GET only", async () => {
  const { raw, client } = await fixture();
  const info = await client.info();
  assert.equal(info.version, VERSION);
  assert.equal(info.wireVersion, 1);
  assert.equal(info.host.kind, "unspecified");
  assert.deepEqual(await errorOf(await raw("/v1/info", post("{}"))), {
    status: 405,
    code: "method_not_allowed",
  });
  assert.deepEqual(await errorOf(await raw("/v1/info", { headers: { authorization: "" } })), {
    status: 401,
    code: "unauthorized",
  });
});

test("a custom authorizer decides per request and a throwing one fails closed", async () => {
  const allowed = await fixture({
    server: {
      auth: {
        kind: "custom",
        authorize: (request) =>
          request.headers.get("x-user") === "ada"
            ? { kind: "allow" }
            : { kind: "deny", reason: "forbidden" },
      },
    },
    token: "",
  });
  const denied = await allowed.raw("/v1/call/sessions.list", post("{}"));
  assert.deepEqual(await errorOf(denied), { status: 403, code: "forbidden" });
  const ok = await allowed.raw("/v1/call/sessions.list", post("{}", { "x-user": "ada" }));
  assert.equal(ok.status, 200);

  const broken = await fixture({
    server: {
      browserOrigins: ["http://app.test"],
      auth: {
        kind: "custom",
        authorize: () => {
          throw new Error("directory offline");
        },
      },
    },
  });
  const brokenReply = await broken.raw(
    "/v1/call/sessions.list",
    post("{}", { origin: "http://app.test" }),
  );
  assert.deepEqual(await errorOf(brokenReply), { status: 500, code: "internal" });
  assert.equal(brokenReply.headers.get("access-control-allow-origin"), "http://app.test");
  assert.equal(broken.failures[0]?.route, "request");

  for (const decision of [
    null,
    undefined,
    true,
    "allow",
    [],
    {},
    { kind: "maybe" },
    { kind: "deny" },
    { kind: "deny", reason: "allow" },
  ]) {
    const malformed = await fixture({
      server: { auth: { kind: "custom", authorize: () => decision } },
    });
    assert.deepEqual(await errorOf(await malformed.raw("/v1/call/sessions.list", post("{}"))), {
      status: 403,
      code: "forbidden",
    });
    assert.deepEqual(malformed.failures, []);
  }

  const anonymous = await fixture({
    server: {
      auth: { kind: "custom", authorize: () => ({ kind: "deny", reason: "unauthorized" }) },
    },
  });
  const noCredential = await anonymous.raw("/v1/call/sessions.list", post("{}"));
  assert.deepEqual(await errorOf(noCredential), { status: 401, code: "unauthorized" });
  assert.equal(noCredential.headers.get("www-authenticate"), "Bearer");
});

test("browser origins: same-origin passes, listed origins get CORS headers, others are refused", async () => {
  const { raw } = await fixture({ server: { browserOrigins: ["http://app.test"] } });
  const same = await raw("/v1/call/sessions.list", post("{}", { origin: BASE }));
  assert.equal(same.status, 200);
  assert.equal(same.headers.get("access-control-allow-origin"), null);

  const listed = await raw("/v1/call/sessions.list", post("{}", { origin: "http://app.test" }));
  assert.equal(listed.status, 200);
  assert.equal(listed.headers.get("access-control-allow-origin"), "http://app.test");
  assert.equal(listed.headers.get("vary"), "origin");

  const preflight = await raw("/v1/call/sessions.list", {
    method: "OPTIONS",
    headers: { origin: "http://app.test", authorization: "" },
  });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers.get("access-control-allow-methods"), "GET, POST");
  assert.equal(
    preflight.headers.get("access-control-allow-headers"),
    "authorization, content-type",
  );

  const refused = await raw("/v1/call/sessions.list", post("{}", { origin: "http://evil.test" }));
  assert.deepEqual(await errorOf(refused), { status: 403, code: "forbidden" });
  assert.equal(refused.headers.get("access-control-allow-origin"), null);
  const nullOrigin = await raw("/v1/call/sessions.list", post("{}", { origin: "null" }));
  assert.equal(nullOrigin.status, 403);
  const withoutList = await fixture();
  const cross = await withoutList.raw(
    "/v1/call/sessions.list",
    post("{}", { origin: "http://app.test" }),
  );
  assert.equal(cross.status, 403);
});

// ---------------------------------------------------------------------------
// Watch
// ---------------------------------------------------------------------------

test("a live watch syncs first and then carries a queued message", async () => {
  const { client } = await fixture();
  const { sessionId } = await client.sessions.create();
  const iterator = client.watch({ sessionId, live: true })[Symbol.asyncIterator]();
  const synced = await iterator.next();
  assert.equal(synced.done === false && synced.value.kind, "synced");
  const activation = await iterator.next();
  assert.equal(activation.done === false && activation.value.kind, "activation_changed");
  const receipt = await client.messages.send({ sessionId, content: "queued while watching" });
  const queued = await iterator.next();
  assert.ok(queued.done === false && queued.value.kind === "queued");
  assert.equal(queued.value.item.change, receipt.change);
  await iterator.return?.();
});

test("activation state and activation_changed round-trip over HTTP and SSE", async () => {
  let active = false;
  const { client, nyte } = await fixture({
    resolveActivation: () =>
      active
        ? { kind: "active", plugins: [], env: { cwd: "/workspace" } }
        : {
            kind: "requires",
            requirement: { kind: "workspace_trust", cwd: "/workspace" },
          },
  });
  const created = await client.sessions.create();
  assert.deepEqual(created.activation, {
    kind: "requires",
    requirement: { kind: "workspace_trust", cwd: "/workspace" },
  });
  assert.equal(
    (await client.sessions.snapshot({ sessionId: created.sessionId }))?.session.activation.kind,
    "requires",
  );

  const iterator = client
    .watch({ sessionId: created.sessionId, live: true })
    [Symbol.asyncIterator]();
  const synced = await iterator.next();
  assert.ok(synced.done === false && synced.value.kind === "synced");
  const required = await iterator.next();
  assert.ok(required.done === false && required.value.kind === "activation_changed");
  if (required.done === false && required.value.kind === "activation_changed") {
    assert.equal(required.value.activation.kind, "requires");
  }

  active = true;
  await nyte.reactivate();
  const activated = await iterator.next();
  assert.ok(activated.done === false && activated.value.kind === "activation_changed");
  if (activated.done === false && activated.value.kind === "activation_changed") {
    assert.deepEqual(activated.value.activation, { kind: "active" });
  }
  await iterator.return?.();
});

test("a replay from the start delivers a head move and its commit on one seq, then synced", async () => {
  const { client, store } = await fixture();
  const { sessionId } = await client.sessions.create();
  await landCommit(store, sessionId, "landed");
  const events: SessionEvent[] = [];
  for await (const event of client.watch({
    sessionId,
    afterSeq: 0,
    signal: AbortSignal.timeout(3_000),
  })) {
    events.push(event);
    if (event.kind === "synced") break;
  }
  assert.equal(events.at(-1)?.kind, "synced");
  assert.ok(events.some((event) => event.kind === "activation_changed"));
  const moved = events.findIndex((event) => event.kind === "head_moved");
  assert.ok(moved >= 0);
  const commit = events[moved + 1];
  assert.ok(commit?.kind === "commit" && commit.item.commit.body.kind === "message");
  assert.equal(events[moved]?.seq, commit.seq);
  assert.equal(commit.item.commit.body.message.content, "landed");
});

test("a cursor below the floor is a cursor_expired refusal with the floor; a snapshot cursor recovers", async () => {
  const { client, store } = await fixture();
  const { sessionId } = await client.sessions.create();
  await landCommit(store, sessionId, "one");
  await landCommit(store, sessionId, "two");
  const session = await store.open(sessionId);
  await session.events.trim(await session.events.last());
  await session.close();

  const expired = await caught(
    client.watch({ sessionId, afterSeq: 0 })[Symbol.asyncIterator]().next(),
  );
  assert.ok(expired instanceof NyteWireError);
  assert.equal(expired.status, 409);
  assert.ok(expired.error.code === "cursor_expired" && expired.error.floor >= 1);

  const snapshot = await client.sessions.snapshot({ sessionId });
  assert.ok(snapshot);
  assert.equal(snapshot.transcript.length, 2);
  const iterator = client.watch({ sessionId, afterSeq: snapshot.seq })[Symbol.asyncIterator]();
  const synced = await iterator.next();
  assert.ok(synced.done === false && synced.value.kind === "synced");
  const activation = await iterator.next();
  assert.ok(activation.done === false && activation.value.kind === "activation_changed");
  await landCommit(store, sessionId, "three");
  const moved = await iterator.next();
  assert.ok(moved.done === false && moved.value.kind === "head_moved");
  await iterator.return?.();
});

test("breaking out of a watch aborts the SDK watch on the server without touching the session", async () => {
  const signals: AbortSignal[] = [];
  const { client } = await fixture({
    wrap: (sdk) => ({
      ...sdk,
      watch: (input) => {
        if (input.signal !== undefined) signals.push(input.signal);
        return sdk.watch(input);
      },
    }),
  });
  const { sessionId } = await client.sessions.create();
  for await (const event of client.watch({ sessionId, live: true })) {
    assert.equal(event.kind, "synced");
    break;
  }
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(signals[0]?.aborted, true);
  assert.ok(await client.sessions.get({ sessionId }));

  const controller = new AbortController();
  const iterator = client
    .watch({ sessionId, live: true, signal: controller.signal })
    [Symbol.asyncIterator]();
  await iterator.next();
  await iterator.next();
  const pending = iterator.next();
  controller.abort();
  assert.deepEqual(await pending, { done: true, value: undefined });
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(signals[1]?.aborted, true);
});

test("a pre-aborted watch request is refused as invalid input", async () => {
  const { server, client } = await fixture();
  const { sessionId } = await client.sessions.create();
  const controller = new AbortController();
  controller.abort();
  const response = await server.fetch(
    new Request(`${BASE}/v1/watch?sessionId=${encodeURIComponent(sessionId)}&live=1`, {
      headers: { authorization: `Bearer ${TOKEN}` },
      signal: controller.signal,
    }),
  );
  assert.deepEqual(await errorOf(response), { status: 400, code: "invalid_input" });
  assert.ok(await client.sessions.get({ sessionId }));
});

test("closing the server ends open watches with a closed error frame and refuses new ones", async () => {
  const { client, server } = await fixture();
  const { sessionId } = await client.sessions.create();
  const iterator = client.watch({ sessionId, live: true })[Symbol.asyncIterator]();
  await iterator.next();
  await iterator.next();
  const pending = iterator.next();
  server.close();
  const closed = await caught(pending);
  assert.ok(closed instanceof NyteWireError);
  assert.equal(closed.code, "closed");
  assert.equal(closed.status, undefined);
  const refused = await caught(
    client.watch({ sessionId, live: true })[Symbol.asyncIterator]().next(),
  );
  assert.ok(refused instanceof NyteWireError);
  assert.equal(refused.code, "closed");
});

test("closing the server releases a watch whose response nobody has read", async () => {
  let active = 0;
  const { server, client } = await fixture({
    wrap: (sdk) => ({
      ...sdk,
      async *watch(input) {
        active += 1;
        try {
          yield* sdk.watch(input);
        } finally {
          active -= 1;
        }
      },
    }),
  });
  const { sessionId } = await client.sessions.create();
  const response = await server.fetch(
    new Request(`${BASE}/v1/watch?sessionId=${encodeURIComponent(sessionId)}&live=1`, {
      headers: { authorization: `Bearer ${TOKEN}` },
    }),
  );
  assert.equal(response.status, 200);
  assert.equal(active, 1);
  server.close();
  await new Promise((resolve) => setTimeout(resolve, 20));
  assert.equal(active, 0);
  await response.body?.cancel();
});

test("the watch query is strict: unknown, repeated, and malformed parameters are refused", async () => {
  const { raw, client } = await fixture();
  const { sessionId } = await client.sessions.create();
  const id = encodeURIComponent(sessionId);
  for (const query of [
    `sessionId=${id}&after=0&after=1`,
    `sessionId=${id}&afterSeq=1`,
    `sessionId=${id}&after=-1`,
    `sessionId=${id}&after=1.5`,
    `sessionId=${id}&after=1&live=1`,
    `sessionId=${id}&live=yes`,
    `sessionId=`,
  ]) {
    assert.deepEqual(await errorOf(await raw(`/v1/watch?${query}`)), {
      status: 400,
      code: "invalid_input",
    });
  }
  assert.deepEqual(await errorOf(await raw(`/v1/watch?sessionId=ghost&live=1`)), {
    status: 404,
    code: "unknown_session",
  });
});

test("an SDK watch that fails after it started ends the stream with an error frame", async () => {
  const { client } = await fixture({
    wrap: (sdk) => ({
      ...sdk,
      async *watch(input) {
        const source = sdk.watch(input)[Symbol.asyncIterator]();
        const first = await source.next();
        if (!first.done) yield first.value;
        await source.return?.();
        throw new Error("store went away");
      },
    }),
  });
  const { sessionId } = await client.sessions.create();
  const kinds: string[] = [];
  const error = await caught(
    (async () => {
      for await (const event of client.watch({ sessionId, live: true })) kinds.push(event.kind);
    })(),
  );
  assert.ok(error instanceof NyteWireError);
  assert.equal(error.code, "internal");
  assert.equal(error.message, "Internal error");
  assert.deepEqual(kinds, ["synced"]);
});

test("a heartbeat comment keeps a quiet stream open without producing an event", async () => {
  const { client } = await fixture({ server: { heartbeatMs: 10 } });
  const { sessionId } = await client.sessions.create();
  const iterator = client.watch({ sessionId, live: true })[Symbol.asyncIterator]();
  await iterator.next();
  await iterator.next();
  const pending = iterator.next();
  await new Promise((resolve) => setTimeout(resolve, 60));
  const receipt = await client.messages.send({ sessionId, content: "after heartbeats" });
  const next = await pending;
  assert.ok(next.done === false && next.value.kind === "queued");
  assert.equal(next.value.item.change, receipt.change);
  await iterator.return?.();
});

test("a transport-level disconnect is not a normal end", async () => {
  const { client, server } = await fixture();
  const { sessionId } = await client.sessions.create();
  const truncated = createNyteClient({
    baseUrl: BASE,
    token: TOKEN,
    fetch: async (input, init) => {
      const response = await server.fetch(new Request(input, init));
      const reader = response.body?.getReader();
      assert.ok(reader);
      const { value } = await reader.read();
      await reader.cancel();
      return new Response(value, { status: response.status, headers: response.headers });
    },
  });
  const kinds: string[] = [];
  const error = await caught(
    (async () => {
      for await (const event of truncated.watch({ sessionId, live: true })) kinds.push(event.kind);
    })(),
  );
  assert.ok(error instanceof NyteTransportError);
  assert.equal(error.failure.kind, "disconnected");
  assert.deepEqual(kinds, ["synced"]);
});

for (const stop of ["close", "abort"] as const) {
  test(`${stop} settles watch setup before a blocked SDK read resumes`, async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const finished = Promise.withResolvers<void>();
    const { raw, server } = await fixture({
      wrap: (sdk) => ({
        ...sdk,
        async *watch() {
          entered.resolve();
          try {
            await release.promise;
            yield { kind: "synced", seq: 0 };
          } finally {
            finished.resolve();
          }
        },
      }),
    });
    const controller = new AbortController();
    const fetching = raw("/v1/watch?sessionId=blocked", { signal: controller.signal });
    await entered.promise;
    let timedOut = false;
    const timeout = setTimeout(() => {
      timedOut = true;
      release.resolve();
    }, 1_000);
    try {
      if (stop === "close") server.close();
      else controller.abort();
      const response = await fetching;
      assert.equal(timedOut, false, "the response must settle before the SDK read resumes");
      assert.deepEqual(
        await errorOf(response),
        stop === "close" ? { status: 503, code: "closed" } : { status: 400, code: "invalid_input" },
      );
    } finally {
      clearTimeout(timeout);
      release.resolve();
      await finished.promise;
    }
  });
}

test("close reaches a watching client before a blocked read and its late failure", async () => {
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const finished = Promise.withResolvers<void>();
  const { client, server, failures } = await fixture({
    wrap: (sdk) => ({
      ...sdk,
      async *watch() {
        try {
          yield { kind: "synced", seq: 0 };
          entered.resolve();
          await release.promise;
          throw new Error("SDK read failed after the server closed");
        } finally {
          finished.resolve();
        }
      },
    }),
  });
  const iterator = client.watch({ sessionId: sessionId("blocked") })[Symbol.asyncIterator]();
  await iterator.next();
  const next = iterator.next();
  await entered.promise;
  let timedOut = false;
  const timeout = setTimeout(() => {
    timedOut = true;
    release.resolve();
  }, 1_000);
  try {
    server.close();
    await assert.rejects(next, { name: "NyteWireError", code: "closed" });
    assert.equal(timedOut, false, "the final frame must precede SDK completion");
    release.resolve();
    await finished.promise;
    assert.deepEqual(failures, []);
    assert.equal((await iterator.next()).done, true);
  } finally {
    clearTimeout(timeout);
    release.resolve();
    await finished.promise;
    await iterator.return?.();
  }
});

// Policies see parsed inputs, independently of credential authentication.
test("a session-scoped phone can read and watch only its allowed session", async () => {
  const allowedId = sessionId("phone-session");
  const forbiddenId = sessionId("private-session");
  const { nyte, client, raw } = await fixture({
    server: {
      permissions: {
        calls: {
          "sessions.snapshot": (input, request) =>
            input.sessionId === allowedId && request.headers.has("authorization"),
        },
        watch: (sessionId) => sessionId === allowedId,
      },
    },
  });
  await nyte.sessions.create({ sessionId: allowedId });
  await nyte.sessions.create({ sessionId: forbiddenId });
  assert.equal(
    (await client.sessions.snapshot({ sessionId: allowedId }))?.session.sessionId,
    allowedId,
  );
  for (const forbiddenSessionId of [forbiddenId, sessionId("nonexistent")]) {
    await assert.rejects(client.sessions.snapshot({ sessionId: forbiddenSessionId }), {
      code: "forbidden",
    });
    assert.deepEqual(await errorOf(await raw(`/v1/watch?sessionId=${forbiddenSessionId}`)), {
      status: 403,
      code: "forbidden",
    });
  }
  assert.ok((await take(client.watch({ sessionId: allowedId }), 1)).length > 0);
  assert.equal((await client.info()).version, VERSION);

  // Listing, creating, and sending are independent grants, not consequences of read access.
  for (const operation of [
    () => client.sessions.list(),
    () => client.sessions.create(),
    () => client.workspace.list(),
    () => client.messages.send({ sessionId: allowedId, content: "must not be queued" }),
  ]) {
    await assert.rejects(operation(), { code: "forbidden" });
  }
  assert.deepEqual((await nyte.sessions.snapshot({ sessionId: allowedId }))?.pending, []);
  assert.equal((await nyte.sessions.list()).items.length, 2);
});

test("permissions default to deny and run only after authentication and input validation", async () => {
  const { raw } = await fixture({
    server: {
      permissions: {
        calls: {
          "sessions.rename": () => {
            throw new Error("policy must not see unauthenticated or malformed input");
          },
        },
      },
    },
  });
  const body = JSON.stringify({ input: { sessionId: "private", name: "allowed" } });
  assert.deepEqual(
    await errorOf(await raw("/v1/call/sessions.rename", post(body, { authorization: "" }))),
    { status: 401, code: "unauthorized" },
  );
  assert.deepEqual(await errorOf(await raw("/v1/call/sessions.rename", post("{}"))), {
    status: 400,
    code: "invalid_input",
  });
  assert.deepEqual(await errorOf(await raw("/v1/watch?sessionId=private")), {
    status: 403,
    code: "forbidden",
  });
});

test("policy failures are redacted and preserve browser error visibility", async () => {
  const failure = new Error("private device policy storage path");
  const { raw, failures } = await fixture({
    server: {
      browserOrigins: ["http://app.test"],
      permissions: {
        calls: { "sessions.list": () => Promise.reject(failure) },
        watch: () => Promise.reject(failure),
      },
    },
  });
  for (const [path, init] of [
    ["/v1/call/sessions.list", post("{}", { origin: "http://app.test" })],
    ["/v1/watch?sessionId=private", { headers: { origin: "http://app.test" } }],
  ] satisfies [string, RequestInit][]) {
    const response = await raw(path, init);
    assert.equal(response.status, 500);
    assert.equal(response.headers.get("access-control-allow-origin"), "http://app.test");
    assert.ok(!(await response.text()).includes(failure.message));
  }
  assert.equal(failures.length, 2);
  assert.ok(failures.every((item) => item.cause === failure));
});

test("close refuses calls and info, including a call awaiting permission", async () => {
  const entered = Promise.withResolvers<void>();
  const grant = Promise.withResolvers<boolean>();
  const { nyte, server, client } = await fixture({
    server: {
      permissions: {
        calls: {
          "sessions.create": () => {
            entered.resolve();
            return grant.promise;
          },
        },
      },
    },
  });
  const pending = client.sessions.create();
  await entered.promise;
  server.close();
  grant.resolve(true);
  await assert.rejects(pending, { code: "closed" });
  await assert.rejects(client.info(), { code: "closed" });
  await assert.rejects(client.sessions.create(), { code: "closed" });
  assert.deepEqual((await nyte.sessions.list()).items, []);
  assert.ok(await nyte.sessions.create({ name: "host still works" }));
});
