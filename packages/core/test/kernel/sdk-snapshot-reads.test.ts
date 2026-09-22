import assert from "node:assert/strict";
import type { Api, Model } from "@nyte-ai/ai";
import { test } from "vitest";
import type { Oid, Run } from "../../src/kernel/model.ts";
import { headRef, runRef } from "../../src/kernel/names.ts";
import { submit } from "../../src/kernel/queue.ts";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import { NyteClosed, sessionId } from "../../src/kernel/sdk/types.ts";
import { step } from "../../src/kernel/step.ts";
import type { Session, Store } from "../../src/kernel/store.ts";
import type { Turn } from "../../src/kernel/turn.ts";
import { definePlugin, inlinePlugin } from "../../src/plugins/index.ts";
import { assistant, call, drain, message, openStore, seedHead, setHead, user } from "./helpers.ts";

const model: Model<Api> = {
  id: "test-model",
  name: "Snapshot",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: true,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};

async function fixture() {
  const store = openStore();
  const session = await store.create();
  /** Commit oids each store query returned; one entry per query. */
  const reads: Oid[][] = [];
  const forwarding: Store = {
    create: (input) => store.create(input),
    async open(id) {
      const opened = await store.open(id);
      const wrapped: Session = {
        ...opened,
        close: () => opened.close(),
        objects: {
          put: (objects) => opened.objects.put(objects),
          async get(oid) {
            const object = await opened.objects.get(oid);
            if (object?.kind === "commit") reads.push([oid]);
            return object;
          },
          async chain(from, options) {
            const page = await opened.objects.chain(from, options);
            reads.push(page.flatMap((item) => (item.object.kind === "commit" ? [item.oid] : [])));
            return page;
          },
          list: () => opened.objects.list(),
          commits: () => opened.objects.commits(),
          delete: (oids) => opened.objects.delete(oids),
        },
      };
      return wrapped;
    },
    list: () => store.list(),
    delete: (id) => store.delete(id),
    close: () => store.close(),
  };
  const nyte = await createNyte({
    store: forwarding,
    model: { ...model, id: "observer-default", contextWindow: 500_000 },
    thinkingLevel: "low",
    models: {
      getModels: () => [model],
      getModel: (provider, id) =>
        provider === model.provider && id === model.id ? model : undefined,
      getAvailable: async () => [model],
    },
    streamFn: () => {
      throw new Error("Snapshot must not invoke a provider");
    },
    plugins: [
      inlinePlugin(
        definePlugin({
          id: "observer",
          session() {
            assert.fail("Snapshot must not instantiate observer plugins");
          },
        }),
      ),
    ],
    env: { cwd: "/tmp/snapshot-fixture" },
  });
  const id = sessionId(session.id);
  await nyte.sessions.get({ sessionId: id });
  return { session, nyte, id, reads };
}

for (const checkpoints of [0, 2]) {
  for (const head of ["main", "side"]) {
    test(`${head} snapshot with ${checkpoints} checkpoints reads each branch in one query and stays fresh`, async () => {
      const f = await fixture();
      try {
        const config = {
          model: { provider: model.provider, id: model.id },
          thinkingLevel: "high",
          agent: "writer",
        };
        const shared = await seedHead(f.session, "main", [
          { kind: "config", ...config },
          ...Array.from({ length: 32 }, (_, index) => message(user(`shared ${index}`))),
        ]);
        for (let index = 0; index < checkpoints; index += 1) {
          shared.push(
            ...(await seedHead(f.session, "main", [
              {
                kind: "checkpoint",
                summary: `checkpoint ${index}`,
                retainedTail: [user("retained")],
                tokensBefore: 1_000,
              },
              message(user(`after checkpoint ${index}`)),
            ])),
          );
        }
        await setHead(f.session, "side", shared.at(-1) ?? null);
        const main = await seedHead(f.session, "main", [message(assistant("main answer"))]);
        const side = await seedHead(f.session, "side", [message(assistant("side answer"))], {
          run: "side-run",
        });
        const run: Run = {
          kind: "run",
          id: "side-run",
          head: "side",
          origin: { kind: "user" },
          root: "side-run",
          phase: { kind: "respond" },
          config: { ...config, thinkingLevel: "medium" },
          startedAt: 1_000,
          attempts: 1,
        };
        const [runOid] = await f.session.objects.put([run]);
        assert.ok(runOid);
        await f.session.refs.update([{ name: runRef("side"), from: null, to: runOid }], {
          reason: "test",
        });
        await submit(f.session, {
          preparation: { kind: "none" },
          head: "main",
          delivery: "next",
          kind: "passive",
          body: { kind: "config", thinkingLevel: "xhigh" },
        });
        await submit(f.session, {
          preparation: { kind: "none" },
          head,
          delivery: "next",
          kind: "user",
          body: message(user("still pending")),
        });
        const reachable = new Set([...shared, ...main, ...(head === "side" ? side : [])]);
        for (let request = 0; request < 2; request += 1) {
          const input = { sessionId: f.id, head };
          const currentRun = await f.nyte.runs.current(input);
          const expected = {
            seq: await f.session.events.last(),
            session: await f.nyte.sessions.get(input),
            head,
            tip: await f.session.refs.read(headRef(head)),
            config: head === "side" ? run.config : config,
            transcript: await f.nyte.messages.list(input),
            pending: await f.nyte.messages.pending(input),
            context: await f.nyte.runs.context(input),
          };
          f.reads.length = 0;
          const snapshot = await f.nyte.sessions.snapshot(input);
          assert.deepEqual(
            snapshot,
            currentRun === undefined ? expected : { ...expected, run: currentRun },
          );
          assert.deepEqual(snapshot?.session.config, { ...config, thinkingLevel: "xhigh" });
          assert.equal(snapshot?.context.contextWindow, model.contextWindow);
          assert.deepEqual(new Set(f.reads.flat()), reachable);
          // Main is one chain query; a side head adds one for its own branch.
          const branches = head === "side" ? 2 : 1;
          assert.ok(
            f.reads.length <= branches,
            `${f.reads.length} SQLite commit queries exceed ${branches} branch reads`,
          );
          // The narrow read agrees with the snapshot and costs no more branch queries.
          f.reads.length = 0;
          assert.deepEqual(await f.nyte.sessions.metadata(input), {
            session: expected.session,
            head,
            config: expected.config,
            context: expected.context,
          });
          assert.ok(
            f.reads.length <= branches,
            `${f.reads.length} SQLite commit queries exceed ${branches} metadata reads`,
          );
          if (request === 0) {
            for (const oid of await seedHead(f.session, head, [message(user("new commit"))])) {
              reachable.add(oid);
            }
          }
        }
      } finally {
        await f.nyte.close();
      }
    });
  }
}

test("a failed response snapshot preserves partial tool-call classes", async () => {
  const f = await fixture();
  try {
    const turn: Turn = {
      async respond() {
        return {
          kind: "failed",
          message: assistant("", {
            calls: [call("partial-call", "read", { path: "README.md" })],
            stop: "error",
            error: "stream failed",
          }),
          failure: { class: "network", message: "stream failed" },
        };
      },
      async tools() {
        assert.fail("failed response must not execute tools");
      },
    };
    await submit(f.session, {
      preparation: { kind: "none" },
      head: "main",
      delivery: "steer",
      kind: "user",
      body: message(user("go")),
    });

    assert.equal((await step(f.session, turn, { head: "main", drain })).kind, "continue");
    assert.equal((await step(f.session, turn, { head: "main", drain })).kind, "finished");

    const snapshot = await f.nyte.sessions.snapshot({ sessionId: f.id });
    assert.ok(snapshot);
    const failed = snapshot.transcript.findLast((item) => item.kind === "turn");
    assert.ok(failed?.kind === "turn");
    assert.deepEqual(failed.failure, { class: "network", message: "stream failed" });
    const tool = failed.parts.find((part) => part.kind === "tool");
    assert.ok(tool?.kind === "tool");
    assert.deepEqual(tool.class, { kind: "custom", label: "read" });
  } finally {
    await f.nyte.close();
  }
});

test("empty and missing snapshots preserve observer defaults and entry errors", async () => {
  const f = await fixture();
  try {
    const snapshot = await f.nyte.sessions.snapshot({ sessionId: f.id });
    assert.deepEqual(snapshot?.config, {});
    assert.deepEqual(snapshot?.transcript, []);
    assert.equal(snapshot?.context.contextWindow, 0);
    assert.equal(await f.nyte.sessions.snapshot({ sessionId: sessionId("missing") }), undefined);
    assert.equal(await f.nyte.sessions.metadata({ sessionId: sessionId("missing") }), undefined);
    await f.nyte.close();
    await assert.rejects(f.nyte.sessions.snapshot({ sessionId: f.id }), NyteClosed);
    await assert.rejects(f.nyte.sessions.metadata({ sessionId: f.id }), NyteClosed);
  } finally {
    await f.nyte.close();
  }
});

test("a new snapshot rechecks stored ancestry even when the tip has not changed", async () => {
  const f = await fixture();
  try {
    const [root] = await seedHead(f.session, "main", [message(user("root"))]);
    assert.ok(root);
    await setHead(f.session, "side", root);
    const input = { sessionId: f.id, head: "side" };
    assert.ok(await f.nyte.sessions.snapshot(input));
    await f.session.objects.delete([root]);
    await assert.rejects(f.nyte.sessions.snapshot(input), {
      message: `Corrupt commit graph at ${root}: missing or non-commit object`,
    });
  } finally {
    await f.nyte.close();
  }
});
