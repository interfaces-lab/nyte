import assert from "node:assert/strict";
import { test } from "vitest";
import { createNyte, type SessionEvent } from "@nyte-ai/core";
import { definePlugin, inlinePlugin } from "@nyte-ai/core/plugins";
import { SqliteStore } from "@nyte-ai/core/store";
import { createNyteClient } from "@nyte-ai/client";
import type { Api, AssistantMessage, Message, Model } from "@nyte-ai/schema";
import { createNyteServer } from "../src/index.ts";

const model: Model<Api> = {
  id: "compaction-test",
  name: "Compaction test",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 10_000,
  maxTokens: 1_000,
};

const answer: AssistantMessage = {
  role: "assistant",
  content: [{ type: "text", text: "Keep the earlier decision." }],
  api: model.api,
  provider: model.provider,
  model: model.id,
  usage: {
    input: 100,
    output: 10,
    cacheRead: 0,
    cacheWrite: 0,
    totalTokens: 110,
    cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
  },
  stopReason: "stop",
  timestamp: 1,
};

test("compaction activity survives HTTP snapshots and SSE replay through publication", async () => {
  const store = new SqliteStore(":memory:", { watchPollIntervalMs: 5 });
  const entered = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
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
          id: "test-compaction",
          session(api) {
            api.hook("before_compaction", async () => {
              entered.resolve();
              await release.promise;
              return {
                material: {
                  type: "provider",
                  provider: model.provider,
                  api: model.api,
                  model: model.id,
                  data: [{ type: "compaction", encrypted_content: "test-provider-context" }],
                },
              };
            });
          },
        }),
      ),
    ],
    env: { cwd: "/tmp/nowhere" },
    compaction: { enabled: true, reserveTokens: 100, keepRecentTokens: 1 },
    streamFn: () => assert.fail("Native compaction does not request an assistant response"),
  });
  const token = "compaction-test-token-0123456789";
  const server = createNyteServer({
    sdk: nyte,
    version: "test",
    auth: { kind: "token", token },
    heartbeatMs: 0,
  });
  const client = createNyteClient({
    baseUrl: "http://nyte.test",
    token,
    fetch: (input, init) => server.fetch(new Request(input, init)),
  });
  try {
    const { sessionId } = await client.sessions.create();
    const session = await store.open(sessionId);
    try {
      for (const message of [
        {
          role: "user",
          content: "Preserve this earlier decision and its explanation.",
          timestamp: 1,
        },
        answer,
        { role: "user", content: "Continue the work.", timestamp: 2 },
      ] satisfies Message[]) {
        const from = await session.refs.read("refs/heads/main");
        const commit =
          message.role === "user"
            ? {
                kind: "commit" as const,
                parent: from,
                body: { kind: "message" as const, message },
                start: { kind: "none" as const },
                at: message.timestamp,
              }
            : {
                kind: "commit" as const,
                parent: from,
                body: { kind: "message" as const, message },
                calls: {},
                outcome: { kind: "ok" as const },
                at: message.timestamp,
              };
        const [oid] = await session.objects.put([commit]);
        assert.ok(oid);
        assert.ok(
          (
            await session.refs.update([{ name: "refs/heads/main", from, to: oid }], {
              reason: "seed",
            })
          ).ok,
        );
      }
    } finally {
      await session.close();
    }
    const before = await client.sessions.snapshot({ sessionId });
    assert.ok(before);
    assert.equal(before.compaction, undefined);
    const startedAt = Date.now();
    const pending = nyte.runs.compact({ sessionId });
    await entered.promise;
    const during = await client.sessions.snapshot({ sessionId });
    assert.ok(during?.compaction);
    assert.notEqual(during.compaction.id, "");
    assert.ok(during.compaction.startedAt >= startedAt);
    assert.ok(during.compaction.startedAt <= Date.now());
    assert.equal(during.compaction.reason, "manual");
    assert.equal(during.run, undefined);
    assert.equal(during.tip, before.tip);
    release.resolve();
    const outcome = await pending;
    assert.equal(outcome.kind, "compacted");
    const events: SessionEvent[] = [];
    for await (const event of client.watch({
      sessionId,
      afterSeq: before.seq,
      signal: AbortSignal.timeout(5_000),
    })) {
      events.push(event);
      if (event.kind === "synced") break;
    }
    const started = events.find(
      (event) => event.kind === "compaction" && event.compaction !== null,
    );
    assert.ok(started?.kind === "compaction");
    assert.equal(started.head, before.head);
    assert.deepEqual(started.compaction, during.compaction);
    const checkpoint = events.findIndex(
      (event) => event.kind === "commit" && event.item.commit.body.kind === "checkpoint",
    );
    const finished = events.findIndex(
      (event) => event.kind === "compaction" && event.compaction === null,
    );
    assert.ok(checkpoint > events.indexOf(started));
    assert.ok(finished > checkpoint);
    const after = await client.sessions.snapshot({ sessionId });
    assert.ok(after);
    assert.equal(after.compaction, undefined);
    assert.equal(after.transcript.filter((item) => item.kind === "checkpoint").length, 1);
    assert.deepEqual(
      after.transcript.filter((item) => item.kind === "turn"),
      before.transcript,
    );
  } finally {
    release.resolve();
    server.close();
    await nyte.close();
    await store.close();
  }
});
