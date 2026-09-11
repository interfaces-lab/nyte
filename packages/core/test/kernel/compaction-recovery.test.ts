import assert from "node:assert/strict";
import { test } from "vitest";
import { createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import { activeCompaction, startCompaction, writeCheckpoint } from "../../src/kernel/compaction.ts";
import { DELETED_REF, headRef } from "../../src/kernel/names.ts";
import { submit } from "../../src/kernel/queue.ts";
import { step } from "../../src/kernel/step.ts";
import type { Session } from "../../src/kernel/store.ts";
import { bindTurn } from "../../src/kernel/turn.ts";
import { projectEvent } from "../../src/kernel/sdk/events.ts";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import type { SessionEvent } from "../../src/kernel/sdk/types.ts";
import {
  assistant,
  landing,
  lease,
  message,
  openStore,
  seedHead,
  user,
  within,
} from "./helpers.ts";

const model: Model<Api> = {
  id: "test-model",
  name: "Test",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 10_000,
  maxTokens: 1_000,
};

test("a successor clears abandoned compaction for existing watchers before responding", async () => {
  const store = openStore();
  const nyte = await createNyte({
    store,
    model,
    models: { getModels: () => [model], getModel: () => model, getAvailable: async () => [model] },
    plugins: [],
    env: { cwd: "/tmp" },
    streamFn: () => {
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: "stop", message: assistant("resumed work") });
      return stream;
    },
  });
  try {
    const { sessionId } = await nyte.sessions.create();
    const session = await store.open(sessionId);
    try {
      const held = await lease(session, "main");
      const info = await startCompaction(session, {
        head: "main",
        lease: held,
        reason: "threshold",
      });
      const active = await nyte.sessions.snapshot({ sessionId });
      assert.deepEqual(active?.compaction, info);
      assert.ok(active);
      await session.leases.release(held);
      assert.equal((await nyte.sessions.snapshot({ sessionId }))?.compaction, undefined);
      const detach = nyte.attach({ sessions: [sessionId] });
      try {
        await nyte.messages.send({ sessionId, content: "resume after the previous owner stopped" });
        await within(nyte.runs.wait({ sessionId }));
      } finally {
        detach();
      }
      const events: SessionEvent[] = [];
      for await (const event of nyte.watch({
        sessionId,
        afterSeq: active.seq,
        signal: AbortSignal.timeout(3_000),
      })) {
        events.push(event);
        if (event.kind === "synced") break;
      }
      const cleared = events.findIndex(
        (event) => event.kind === "compaction" && event.compaction === null,
      );
      const response = events.findIndex(
        (event) =>
          event.kind === "commit" &&
          event.item.commit.body.kind === "message" &&
          event.item.commit.body.message.role === "assistant",
      );
      assert.ok(cleared >= 0, "An existing watcher must retire the previous owner's activity");
      assert.ok(response > cleared, "Recovered work follows the compaction clear");
      assert.equal((await nyte.sessions.snapshot({ sessionId }))?.compaction, undefined);
    } finally {
      await session.close();
    }
  } finally {
    await nyte.close();
  }
});

test("starting compaction after session deletion fails rather than waiting for its lease", async () => {
  const session = await openStore().create();
  const held = await lease(session, "main");
  try {
    const [marker] = await session.objects.put([{ kind: "blob", value: true }]);
    assert.ok(marker);
    assert.ok(
      (
        await session.refs.update([{ name: DELETED_REF, from: null, to: marker }], {
          reason: "delete",
        })
      ).ok,
    );
    await assert.rejects(
      within(startCompaction(session, { head: "main", lease: held, reason: "manual" }), 500),
      /session deletion/,
    );
    assert.equal(await activeCompaction(session, "main"), undefined);
  } finally {
    await session.leases.release(held);
    await session.close();
  }
});

test("manual compaction releases its lease even when clearing activity fails", async () => {
  const session = await openStore().create();
  await seedHead(session, "main", [message(user("summarize this"))]);
  const faulted: Session = {
    ...session,
    refs: {
      read: (name) => session.refs.read(name),
      list: (prefix) => session.refs.list(prefix),
      update: (updates, options) => {
        if (updates.some((update) => update.from !== null && update.to === null)) {
          throw new Error("storage unavailable");
        }
        return session.refs.update(updates, options);
      },
    },
  };
  try {
    await assert.rejects(
      writeCheckpoint(faulted, {
        head: "main",
        model,
        reason: "manual",
        settings: { enabled: true, reserveTokens: 1_000, keepRecentTokens: 0 },
        streamFn: () => {
          throw new Error("summary failed");
        },
        retry: { enabled: false, maxRetries: 0, baseDelayMs: 0 },
      }),
      (cause: unknown) => cause instanceof Error,
    );
    assert.equal(await session.leases.read(headRef("main")), undefined);
    assert.equal(await activeCompaction(session, "main"), undefined);
  } finally {
    await session.close();
  }
});

test.each(["save", "publish"])(
  "automatic checkpoint %s failures leave no active compaction",
  async (fault) => {
    const session = await openStore().create();
    try {
      await seedHead(session, "main", [
        message(user("old work")),
        message(
          assistant("earlier answer", {
            usage: {
              ...assistant("").usage,
              input: model.contextWindow,
              totalTokens: model.contextWindow,
            },
          }),
        ),
      ]);
      const turn = bindTurn({
        model,
        systemPrompt: "test",
        tools: [],
        compaction: { enabled: true, reserveTokens: 1_000, keepRecentTokens: 0 },
        streamFn: () => {
          const stream = createAssistantMessageEventStream();
          stream.push({ type: "done", reason: "stop", message: assistant("summary") });
          return stream;
        },
      });
      await submit(session, { head: "main", lane: "now", body: message(user("continue")) });
      await step(session, turn, { head: "main", landing });
      const tip = await session.refs.read(headRef("main"));
      const seq = await session.events.last();
      const faulted: Session = {
        ...session,
        objects: {
          get: (oid) => session.objects.get(oid),
          chain: (from, options) => session.objects.chain(from, options),
          list: () => session.objects.list(),
          commits: () => session.objects.commits(),
          delete: (oids) => session.objects.delete(oids),
          put: (objects) => {
            if (
              fault === "save" &&
              objects.some(
                (object) => object.kind === "commit" && object.body.kind === "checkpoint",
              )
            ) {
              throw new Error("storage unavailable");
            }
            return session.objects.put(objects);
          },
        },
        refs: {
          read: (name) => session.refs.read(name),
          list: (prefix) => session.refs.list(prefix),
          update: async (updates, options) => {
            if (fault === "publish") {
              for (const update of updates) {
                const object =
                  update.to === null ? undefined : await session.objects.get(update.to);
                if (object?.kind === "commit" && object.body.kind === "checkpoint")
                  throw new Error("storage unavailable");
              }
            }
            return session.refs.update(updates, options);
          },
        },
      };
      await assert.rejects(step(faulted, turn, { head: "main", landing }), /storage unavailable/);
      assert.equal(await activeCompaction(session, "main"), undefined);
      const events = (
        await Promise.all(
          (await session.events.read({ afterSeq: seq })).map((event) =>
            projectEvent(event, session.objects),
          ),
        )
      ).flat();
      assert.equal(events.filter((event) => event.kind === "compaction").at(-1)?.compaction, null);
      assert.equal(await session.refs.read(headRef("main")), tip);
      assert.equal(await session.leases.read(headRef("main")), undefined);
    } finally {
      await session.close();
    }
  },
);
