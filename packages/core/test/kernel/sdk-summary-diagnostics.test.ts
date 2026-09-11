import assert from "node:assert/strict";
import { test } from "vitest";
import {
  createAssistantMessageEventStream,
  type Api,
  type Model,
  type SimpleStreamOptions,
} from "@nyte-ai/ai";
import { schemas } from "@nyte-ai/protocol";
import { HookRegistry } from "../../src/plugins/hooks.ts";
import { definePlugin, inlinePlugin } from "../../src/plugins/types.ts";
import { requestStream } from "../../src/kernel/sdk/requests.ts";
import { InMemoryTelemetryContext } from "@nyte-ai/telemetry";
import { Value } from "typebox/value";
import { CompactionError, activeCompaction, writeCheckpoint } from "../../src/kernel/compaction.ts";
import { headRef } from "../../src/kernel/names.ts";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import { sessionId, type SummaryDiagnostic } from "../../src/kernel/sdk/types.ts";
import type { Session, Store } from "../../src/kernel/store.ts";
import { assistant, message, openStore, seedHead, usage, user } from "./helpers.ts";

const model: Model<Api> = {
  id: "diagnostic-test",
  name: "Diagnostic test",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 10_000,
  maxTokens: 100,
};
const settings = { enabled: true, reserveTokens: 100, keepRecentTokens: 0 };
const secret = "synthetic-secret /private/provider-body";

test.each(["success", "fault"])(
  "heads.move preserves navigation request options and telemetry on %s",
  async (mode) => {
    const store = openStore();
    const session = await store.create();
    const abandoned = await seedHead(session, "main", [
      message(user("first")),
      message(user("second")),
    ]);
    const tip = await session.refs.read(headRef("main"));
    const telemetry = new InMemoryTelemetryContext();
    const diagnostics: SummaryDiagnostic[] = [];
    const requests: (SimpleStreamOptions | undefined)[] = [];
    const original = new Error(secret);
    let hookCalls = 0;
    const nyte = await createNyte({
      store,
      model,
      models: {
        getModels: () => [model],
        getModel: () => model,
        getAvailable: async () => [model],
      },
      plugins: [
        inlinePlugin(
          definePlugin({
            id: "navigation-request-test",
            session(api) {
              api.hook("before_request", () => {
                hookCalls += 1;
                return { streamOptions: { temperature: 0.9, maxTokens: 7 } };
              });
            },
          }),
        ),
      ],
      env: { cwd: "/tmp" },
      compaction: settings,
      streamOptions: {
        temperature: 0.4,
        maxTokens: 9,
        headers: { "x-global-option": "configured" },
        cacheRetention: "long",
      },
      telemetry,
      onDiagnostic: (diagnostic) => {
        diagnostics.push(diagnostic);
      },
      streamFn: (_model, _context, options) => {
        requests.push(options);
        if (mode === "fault") throw original;
        const stream = createAssistantMessageEventStream();
        stream.push({ type: "done", reason: "stop", message: assistant("navigation summary") });
        return stream;
      },
    });
    try {
      const outcome = await nyte.heads.move({
        sessionId: sessionId(session.id),
        to: null,
        summary: {},
      });
      assert.equal(hookCalls, 0);
      assert.equal(requests.length, 1);
      const request = requests[0];
      assert.ok(request);
      assert.ok(request.sessionId);
      assert.ok(request.telemetryContext);
      assert.deepEqual(request, {
        maxTokens: 100,
        cacheRetention: "none",
        signal: undefined,
        sessionId: request.sessionId,
        telemetryContext: request.telemetryContext,
      });
      const spans = telemetry.spans();
      assert.equal(spans.length, 1);
      assert.equal(spans[0]?.name, "nyte.ai.request");
      assert.equal(spans[0]?.ended, true);
      assert.equal(spans[0]?.attributes["nyte.request.step"], "compaction");
      assert.equal(spans[0]?.status.status, mode === "fault" ? "error" : "ok");
      if (mode === "fault") {
        assert.ok(outcome.kind === "failed" && outcome.code === "internal");
        assert.equal(diagnostics.length, 1);
        assert.equal(diagnostics[0]?.correlationId, outcome.correlationId);
        assert.ok(diagnostics[0]?.cause instanceof CompactionError);
        assert.equal(diagnostics[0].cause.cause, original);
        assert.equal(await session.refs.read(headRef("main")), tip);
      } else {
        assert.ok(outcome.kind === "moved" && outcome.summary !== undefined);
        assert.equal(await session.refs.read(headRef("main")), outcome.summary);
        const summary = await session.objects.get(outcome.summary);
        assert.ok(summary?.kind === "commit" && summary.body.kind === "summary");
        assert.equal(summary.parent, null);
        assert.deepEqual(summary.imports, abandoned);
        assert.ok(summary.body.text.endsWith("navigation summary"));
        assert.deepEqual(summary.body.usage, usage);
        assert.deepEqual(diagnostics, []);
      }
      assert.equal(await session.leases.read(headRef("main")), undefined);
      assert.equal(await activeCompaction(session, "main"), undefined);
      if (mode === "success") {
        await seedHead(session, "main", [message(user("continue"))]);
        const compacted = await nyte.runs.compact({ sessionId: sessionId(session.id) });
        assert.equal(compacted.kind, "compacted");
        assert.equal(hookCalls, 1);
        assert.equal(requests.length, 2);
        assert.equal(requests[1]?.temperature, 0.9);
        assert.equal(requests[1]?.maxTokens, 7);
        assert.deepEqual(requests[1]?.headers, { "x-global-option": "configured" });
        assert.deepEqual(diagnostics, []);
      }
    } finally {
      await nyte.close();
    }
  },
);

for (const operation of ["runs.compact", "heads.move"] satisfies SummaryDiagnostic["operation"][]) {
  for (const mode of [
    "object",
    "error",
    "returned",
    "store",
    "save",
    "callback",
    "async_callback",
    "hostile",
    "iterator",
    ...(operation === "runs.compact" ? ["cleanup"] : []),
  ]) {
    test(`${operation} retains ${mode} failures locally and redacts public data`, async () => {
      const store = openStore();
      const session = await store.create();
      await seedHead(session, "main", [message(user("first")), message(user("second"))]);
      const tip = await session.refs.read(headRef("main"));
      const original: unknown =
        mode === "object"
          ? { secret }
          : mode === "hostile" || mode === "iterator"
            ? {
                get message() {
                  throw new Error("message getter must not run");
                },
                toString() {
                  throw new Error("toString must not run");
                },
              }
            : new TypeError(secret);
      const cleanup = new Error("synthetic cleanup failure");
      const diagnostics: SummaryDiagnostic[] = [];
      let armed = false;
      const faulted: Session = {
        id: session.id,
        leases: {
          acquire: (name, ttl) => session.leases.acquire(name, ttl),
          renew: (lease, ttl) => session.leases.renew(lease, ttl),
          read: (name) => session.leases.read(name),
          release: async (lease) => {
            const released = await session.leases.release(lease);
            if (mode === "cleanup") throw cleanup;
            return released;
          },
        },
        events: session.events,
        close: () => session.close(),
        objects: {
          get: (oid) => session.objects.get(oid),
          chain: (from, options) => session.objects.chain(from, options),
          list: () => session.objects.list(),
          commits: () => session.objects.commits(),
          delete: (oids) => session.objects.delete(oids),
          put: (objects) => {
            if (
              mode === "save" &&
              objects.some(
                (object) =>
                  object.kind === "commit" &&
                  (object.body.kind === "checkpoint" ||
                    (object.body.kind === "summary" && object.body.text !== "")),
              )
            )
              throw original;
            return session.objects.put(objects);
          },
        },
        refs: {
          list: (prefix) => session.refs.list(prefix),
          update: (updates, options) => session.refs.update(updates, options),
          read: (name) => {
            if (armed && mode === "store" && name === headRef("main")) throw original;
            return session.refs.read(name);
          },
        },
      };
      const wrapped: Store = {
        create: (input) => store.create(input),
        open: async () => faulted,
        list: () => store.list(),
        delete: (id) => store.delete(id),
        close: () => store.close(),
      };
      const nyte = await createNyte({
        store: wrapped,
        model,
        models: {
          getModels: () => [model],
          getModel: () => model,
          getAvailable: async () => [model],
        },
        plugins: [],
        env: { cwd: "/tmp" },
        compaction: settings,
        onDiagnostic: (diagnostic) => {
          diagnostics.push(diagnostic);
          if (mode === "callback") throw new Error("diagnostic callback failed");
          if (mode === "async_callback" || mode === "cleanup")
            return Promise.reject(new Error("async diagnostic callback failed"));
        },
        streamFn: () => {
          if (mode === "iterator") {
            const stream = createAssistantMessageEventStream();
            stream[Symbol.asyncIterator] = async function* () {
              yield { type: "start", partial: assistant("") };
              throw original;
            };
            return stream;
          }
          if (mode !== "returned" && mode !== "save") throw original;
          const stream = createAssistantMessageEventStream();
          if (mode === "save") {
            stream.push({ type: "done", reason: "stop", message: assistant("summary") });
            return stream;
          }
          stream.push({
            type: "error",
            reason: "error",
            error: assistant("", { stop: "error", error: secret }),
          });
          return stream;
        },
      });
      try {
        const id = sessionId(session.id);
        await nyte.sessions.get({ sessionId: id });
        armed = true;
        const outcome =
          operation === "runs.compact"
            ? await nyte.runs.compact({ sessionId: id })
            : await nyte.heads.move({ sessionId: id, to: null, summary: {} });
        assert.equal(outcome.kind, "failed");
        assert.ok(outcome.kind === "failed" && outcome.code === "internal");
        assert.equal(diagnostics.length, 1);
        const diagnostic = diagnostics[0];
        assert.ok(diagnostic);
        assert.equal(diagnostic.operation, operation);
        assert.equal(diagnostic.code, outcome.code);
        assert.equal(diagnostic.correlationId, outcome.correlationId);
        assert.ok(Value.Check(schemas.SummaryFailure, outcome));
        assert.equal(JSON.stringify(outcome).includes(secret), false);
        if (mode === "cleanup") {
          assert.ok(diagnostic.cause instanceof AggregateError);
          assert.equal(diagnostic.cause.errors[1], original);
          const failures: unknown = diagnostic.cause.errors[0];
          assert.ok(failures instanceof AggregateError);
          assert.equal(failures.errors[1], cleanup);
          assert.ok(failures.errors[0] instanceof CompactionError);
          assert.equal(failures.errors[0].code, "summarization_failed");
        } else if (mode === "store" || mode === "save") {
          assert.equal(diagnostic.cause, original);
        } else {
          assert.ok(diagnostic.cause instanceof CompactionError);
          assert.equal(diagnostic.cause.code, "summarization_failed");
          if (mode === "returned") {
            assert.ok(diagnostic.cause.message.includes(secret));
            assert.deepEqual(diagnostic.cause.usage, usage);
          } else {
            assert.equal(diagnostic.cause.cause, original);
          }
        }
        armed = false;
        assert.equal(await session.refs.read(headRef("main")), tip);
        assert.equal(await session.leases.read(headRef("main")), undefined);
        assert.equal(await activeCompaction(session, "main"), undefined);
        assert.equal(
          JSON.stringify(await session.events.read({ afterSeq: 0 })).includes(secret),
          false,
        );
        const objects = await Promise.all(
          (await session.objects.list()).map((entry) => session.objects.get(entry.oid)),
        );
        assert.equal(JSON.stringify(objects).includes(secret), false);
        if (mode === "returned" || mode === "save") {
          const retained = objects.filter(
            (object) => object?.kind === "commit" && object.body.kind === "summary",
          );
          assert.equal(retained.length, 1);
        }
      } finally {
        await nyte.close();
      }
    });
  }
}

test.each(["conflict", "fenced"])("checkpoint %s stays an expected failure", async (reason) => {
  const session = await openStore().create();
  await seedHead(session, "main", [message(user("first")), message(user("second"))]);
  const tip = await session.refs.read(headRef("main"));
  const faulted: Session = {
    objects: session.objects,
    id: session.id,
    leases: session.leases,
    events: session.events,
    close: () => session.close(),
    refs: {
      read: (name) => session.refs.read(name),
      list: (prefix) => session.refs.list(prefix),
      update: (updates, options) => {
        if (updates.some((update) => update.name === headRef("main") && update.to !== tip)) {
          return Promise.resolve(
            reason === "fenced"
              ? { ok: false, reason: "fenced" }
              : { ok: false, reason: "conflict", name: headRef("main"), actual: tip },
          );
        }
        return session.refs.update(updates, options);
      },
    },
  };
  const outcome = await writeCheckpoint(faulted, {
    head: "main",
    model,
    settings,
    reason: "manual",
    streamFn: () => {
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: "stop", message: assistant("summary") });
      return stream;
    },
  });
  assert.ok(outcome.kind === "failed");
  assert.equal(outcome.code, reason);
  assert.equal(await session.refs.read(headRef("main")), tip);
  assert.equal(await session.leases.read(headRef("main")), undefined);
  assert.equal(await activeCompaction(session, "main"), undefined);
});

test("manual cancellation and empty history do not emit unexpected diagnostics", async () => {
  const store = openStore();
  const diagnostics: SummaryDiagnostic[] = [];
  const nyte = await createNyte({
    store,
    model,
    models: {
      getModels: () => [model],
      getModel: () => model,
      getAvailable: async () => [model],
    },
    plugins: [],
    env: { cwd: "/tmp" },
    onDiagnostic: (diagnostic) => {
      diagnostics.push(diagnostic);
    },
    streamFn: () => assert.fail("No provider call expected"),
  });
  try {
    const session = await nyte.sessions.create();
    assert.deepEqual(await nyte.runs.compact({ sessionId: session.sessionId }), {
      kind: "nothing_to_compact",
    });
    assert.deepEqual(
      await nyte.runs.compact({
        sessionId: session.sessionId,
        signal: AbortSignal.abort(),
      }),
      { kind: "aborted" },
    );
    assert.deepEqual(diagnostics, []);
  } finally {
    await nyte.close();
  }
});

test("before-request rejection is captured before conversion and terminates safely", async () => {
  const original = { secret };
  const hooks = new HookRegistry(() => {
    throw original;
  });
  hooks.on("before_request", () => {
    throw new Error("hook failure");
  });
  const captured: unknown[] = [];
  const stream = await requestStream({
    hooks,
    invocation: () => ({ head: "main", runId: "r", sessionId: "s", attempt: 1 }),
    step: "compaction",
    streamFn: () => assert.fail("before_request failed before provider invocation"),
    errorPolicy: {
      capture: (cause) => {
        captured.push(cause);
      },
      message: "Summary request failed",
    },
  })(model, { messages: [] });
  const events = [];
  for await (const event of stream) events.push(event);
  assert.equal(events.length, 1);
  assert.equal(events[0]?.type, "error");
  assert.equal(await stream.result(), events[0]?.type === "error" ? events[0].error : undefined);
  assert.equal((await stream.result()).errorMessage, "Summary request failed");
  assert.equal(captured.length, 1);
  assert.equal(captured[0], original);
});

test("request telemetry uses fallback and preserves per-request precedence", async () => {
  const fallback = new InMemoryTelemetryContext();
  const request = new InMemoryTelemetryContext();
  const stream = requestStream({
    hooks: new HookRegistry(() => undefined),
    invocation: () => ({ head: "main", runId: "r", sessionId: "s", attempt: 1 }),
    step: "compaction",
    telemetry: fallback,
    streamFn: () => {
      const result = createAssistantMessageEventStream();
      result.push({ type: "done", reason: "stop", message: assistant("summary") });
      return result;
    },
  });
  await (await stream(model, { messages: [] })).result();
  await (await stream(model, { messages: [] }, { telemetryContext: request })).result();
  assert.equal(fallback.spans().length, 1);
  assert.equal(request.spans().length, 1);
});
