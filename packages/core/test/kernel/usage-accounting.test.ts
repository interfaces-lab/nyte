import assert from "node:assert/strict";
import { test } from "vitest";
import { contentText, createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import type { AssistantMessage, Usage } from "@nyte-ai/schema";
import { prepareCheckpoint, writeCheckpoint } from "../../src/kernel/compaction.ts";
import { contextMessages, estimateContextTokens, projectContextStatus } from "@nyte-ai/client";
import { contextCommits } from "../../src/kernel/graph.ts";
import type { Commit } from "../../src/kernel/model.ts";
import { headRef } from "../../src/kernel/names.ts";
import { submit } from "../../src/kernel/queue.ts";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import { sessionId } from "../../src/kernel/sdk/types.ts";
import { step } from "../../src/kernel/step.ts";
import type { Session } from "../../src/kernel/store.ts";
import { bindTurn } from "../../src/kernel/turn.ts";
import { projectUsage } from "@nyte-ai/client";
import type { StreamFn } from "../../src/kernel/loop/types.ts";
import {
  assistant,
  commit,
  drain,
  localEnv,
  localOptions,
  message,
  openSession,
  openStore,
  seedHead,
  setHead,
  storePath,
  usage,
  user,
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
  contextWindow: 2_000,
  maxTokens: 100,
};
const settings = { enabled: true, reserveTokens: 100, keepRecentTokens: 1 };
const retry = { enabled: true, maxRetries: 1, baseDelayMs: 0 };

function usageOf(tokens: number): Usage {
  return {
    input: tokens * 0.4,
    output: tokens * 0.3,
    cacheRead: tokens * 0.2,
    cacheWrite: tokens * 0.1,
    cacheWrite1h: tokens * 0.1,
    reasoning: tokens * 0.1,
    totalTokens: tokens,
    cost: {
      input: tokens * 0.004,
      output: tokens * 0.003,
      cacheRead: tokens * 0.002,
      cacheWrite: tokens * 0.001,
      total: tokens * 0.01,
    },
  };
}

function stream(answer: AssistantMessage) {
  const result = createAssistantMessageEventStream();
  if (answer.stopReason === "error" || answer.stopReason === "aborted") {
    result.push({ type: "error", reason: answer.stopReason, error: answer });
  } else {
    result.push({ type: "done", reason: "stop", message: answer });
  }
  return result;
}

async function storedCommits(session: Session): Promise<Commit[]> {
  return (await session.objects.commits()).map((entry) => entry.commit);
}

test("a successful checkpoint records every retry's reported tokens and costs once", async () => {
  const session = await openStore().create();
  await seedHead(session, "main", [message(user("old work")), message(user("continue"))]);
  let requests = 0;
  const outcome = await writeCheckpoint(session, {
    head: "main",
    model,
    settings,
    reason: "manual",
    retry,
    streamFn: () => {
      requests += 1;
      return stream(
        requests === 1
          ? assistant("partial", { stop: "error", error: "503", usage: usageOf(100) })
          : assistant("summary", { usage: usageOf(200) }),
      );
    },
  });
  assert.equal(outcome.kind, "compacted");
  assert.equal(requests, 2);
  const commits = await storedCommits(session);
  const recorded = projectUsage(commits).compaction;
  assert.equal(recorded.totalTokens, 300);
  assert.equal(recorded.input, 120);
  assert.equal(recorded.output, 90);
  assert.equal(recorded.cacheRead, 60);
  assert.equal(recorded.cacheWrite, 30);
  assert.equal(recorded.cacheWrite1h, 30);
  assert.equal(recorded.reasoning, 30);
  assert.equal(recorded.cost.total, 3);
  assert.equal(commits.filter((commit) => commit.body.kind === "summary").length, 0);
});

test.each(["exhausted", "thrown", "cancelled", "provider-aborted", "backoff"] as const)(
  "%s compaction retains reported usage after reopening without changing context or publishing a checkpoint",
  async (mode) => {
    const path = storePath();
    const store = openStore(path);
    const session = await store.create();
    await seedHead(session, "main", [message(user("old work")), message(user("continue"))]);
    const tip = await session.refs.read(headRef("main"));
    const before = contextMessages(
      (await contextCommits(session.objects, tip)).map((x) => x.commit),
    );
    const controller = new AbortController();
    let requests = 0;
    const outcome = await writeCheckpoint(session, {
      head: "main",
      model,
      settings,
      reason: "manual",
      retry,
      signal: controller.signal,
      streamFn: () => {
        requests += 1;
        if (mode === "backoff") {
          controller.abort();
          return stream(assistant("partial", { stop: "error", error: "503", usage: usageOf(100) }));
        }
        if (requests === 1) {
          return stream(
            assistant("history summary", { stop: "error", error: "503", usage: usageOf(100) }),
          );
        }
        if (mode === "thrown") throw new Error("transport broke");
        if (mode === "cancelled") controller.abort();
        return stream(
          assistant("partial", {
            stop: mode === "provider-aborted" ? "aborted" : "error",
            error: "billing",
            usage: usageOf(200),
          }),
        );
      },
    });
    assert.equal(
      outcome.kind,
      mode === "cancelled" || mode === "provider-aborted" || mode === "backoff"
        ? "aborted"
        : "failed",
    );
    assert.equal(requests, mode === "backoff" ? 1 : 2);
    assert.equal(await session.refs.read(headRef("main")), tip);
    assert.equal(await session.leases.read(headRef("main")), undefined);
    await session.close();
    const reopened = await openStore(path).open(session.id);
    const commits = await storedCommits(reopened);
    assert.ok(commits.every((commit) => commit.body.kind !== "checkpoint"));
    assert.equal(
      projectUsage(commits).compaction.totalTokens,
      mode === "thrown" || mode === "backoff" ? 100 : 300,
    );
    assert.deepEqual(
      contextMessages((await contextCommits(reopened.objects, tip)).map((x) => x.commit)),
      before,
    );
  },
);

test.each([false, true])(
  "automatic compaction failure retains usage when cancelled=%s",
  async (cancelled) => {
    const session = await openStore().create();
    await seedHead(session, "main", [
      message(user("old work")),
      message(assistant("answer", { usage: usageOf(2_000) })),
    ]);
    const controller = new AbortController();
    const streamFn: StreamFn = () => stream(assistant("normal answer", { usage: usageOf(200) }));
    const turn = bindTurn({
      streamFn,
      compactionStreamFn: () => {
        if (cancelled) controller.abort();
        return stream(
          assistant("partial summary", { stop: "error", error: "billing", usage: usageOf(100) }),
        );
      },
      model,
      sections: { prompt: "normal agent" },
      tools: [],
      env: localEnv("/tmp"),
      compaction: settings,
      retry,
    });
    await submit(session, {
      preparation: { kind: "none" },
      head: "main",
      delivery: "steer",
      kind: "user",
      body: message(user("continue")),
    });
    const options = { head: "main", drain, signal: controller.signal };
    await step(session, turn, options);
    const outcome = await step(session, turn, options);
    assert.ok(outcome.kind === "finished");
    assert.equal(outcome.run.phase.kind, cancelled ? "aborted" : "done");
    const commits = await storedCommits(session);
    assert.equal(projectUsage(commits).compaction.totalTokens, 100);
    assert.ok(commits.every((commit) => commit.body.kind !== "checkpoint"));
  },
);

test("a conflicting checkpoint publish records its usage once and leaves the competing head alone", async () => {
  const session = await openStore().create();
  const oids = await seedHead(session, "main", [
    message(user("old work")),
    message(user("continue")),
  ]);
  const target = oids[0];
  assert.ok(target);
  const outcome = await writeCheckpoint(session, {
    head: "main",
    model,
    settings,
    reason: "manual",
    streamFn: async () => {
      await setHead(session, "main", target);
      return stream(assistant("summary", { usage: usageOf(100) }));
    },
  });
  assert.equal(outcome.kind, "failed");
  assert.equal(await session.refs.read(headRef("main")), target);
  assert.equal(projectUsage(await storedCommits(session)).compaction.totalTokens, 100);
});

test("failed branch summarization retains its usage without navigating", async () => {
  const store = openStore();
  const session = await store.create();
  const oids = await seedHead(session, "main", [message(user("start")), message(user("branch"))]);
  const target = oids[0];
  assert.ok(target);
  const tip = await session.refs.read(headRef("main"));
  const nyte = await createNyte({
    store,
    model,
    ...localOptions("/tmp"),
    models: { getModels: () => [model], getModel: () => model, getAvailable: async () => [model] },
    streamFn: () =>
      stream(assistant("partial", { stop: "error", error: "billing", usage: usageOf(100) })),
  });
  try {
    const result = await nyte.heads.move({
      sessionId: sessionId(session.id),
      to: target,
      summary: {},
    });
    assert.equal(result.kind, "failed");
    assert.equal(await session.refs.read(headRef("main")), tip);
    assert.equal(projectUsage(await storedCommits(session)).compaction.totalTokens, 100);
  } finally {
    await nyte.close();
  }
});

test("overflow retries count rejected chunks as well as successful chunks", async () => {
  const session = await openStore().create();
  await seedHead(session, "main", [
    message(user("old work ".repeat(2_000))),
    message(user("continue")),
  ]);
  let requests = 0;
  let rejected = 0;
  const result = await writeCheckpoint(session, {
    head: "main",
    model,
    settings,
    reason: "manual",
    streamFn: (_model, context) => {
      requests += 1;
      const tooLarge = contentText(context.messages[0]?.content ?? "").length > 4_000;
      if (tooLarge) rejected += 1;
      return stream(
        tooLarge
          ? assistant("", {
              stop: "error",
              error: "Your input exceeds the context window of this model",
              usage: usageOf(100),
            })
          : assistant("summary", { usage: usageOf(100) }),
      );
    },
  });
  assert.equal(result.kind, "compacted");
  assert.ok(rejected > 0);
  assert.equal(projectUsage(await storedCommits(session)).compaction.totalTokens, requests * 100);
});

test.each([false, true])(
  "overflow recovery retains original model spend with conflicting head=%s",
  async (conflict) => {
    const path = storePath();
    const session = await openStore(path).create();
    const [target] = await seedHead(session, "main", [message(user("old work"))]);
    assert.ok(target);
    const failed = assistant("partial answer", {
      stop: "error",
      error: "Your input exceeds the context window of this model",
      usage: usageOf(100),
    });
    let requests = 0;
    const turn = bindTurn({
      model,
      sections: { prompt: "normal agent" },
      tools: [],
      env: localEnv("/tmp"),
      compaction: settings,
      retry,
      streamFn: () =>
        stream(++requests === 1 ? failed : assistant("recovered answer", { usage: usageOf(300) })),
      compactionStreamFn: async () => {
        if (conflict) await setHead(session, "main", target);
        return stream(assistant("summary", { usage: usageOf(200) }));
      },
    });
    await submit(session, {
      preparation: { kind: "none" },
      head: "main",
      delivery: "steer",
      kind: "user",
      body: message(user("continue")),
    });
    const options = { head: "main", drain };
    await step(session, turn, options);
    assert.equal((await step(session, turn, options)).kind, "continue");
    if (conflict) {
      assert.equal(await session.refs.read(headRef("main")), target);
    } else {
      const outcome = await step(session, turn, options);
      assert.ok(outcome.kind === "finished");
      assert.equal(outcome.run.phase.kind, "done");
    }
    await session.close();
    const reopened = await openStore(path).open(session.id);
    const commits = await storedCommits(reopened);
    const recorded = projectUsage(commits);
    assert.equal(recorded.total.totalTokens, conflict ? 300 : 600);
    assert.equal(recorded.compaction.totalTokens, 200);
    assert.equal(recorded.models[0]?.usage.totalTokens, conflict ? 100 : 400);
    assert.equal(recorded.total.cost.total, conflict ? 3 : 6);
    const originals = commits.filter(
      (commit) =>
        commit.body.kind === "message" &&
        commit.body.message.role === "assistant" &&
        commit.body.message.stopReason === "error",
    );
    assert.equal(originals.length, 1);
    assert.deepEqual(originals[0]?.body, message(failed));
    const context = contextMessages(
      (await contextCommits(reopened.objects, await reopened.refs.read(headRef("main")))).map(
        (entry) => entry.commit,
      ),
    );
    assert.ok(
      context.every((message) => message.role !== "assistant" || message.stopReason !== "error"),
    );
  },
);

test("recorded usage survives rewind and reopen, including loose compaction usage", async () => {
  const path = storePath();
  const store = openStore(path);
  const session = await store.create();
  const [first] = await session.objects.put([commit(null, message(assistant("first")), { at: 1 })]);
  assert.ok(first);
  const [second] = await session.objects.put([
    commit(first, message(assistant("second")), { at: 2 }),
  ]);
  assert.ok(second);
  await session.refs.update([{ name: headRef("main"), from: null, to: second }], {
    reason: "respond",
  });
  await session.refs.update([{ name: headRef("other"), from: null, to: second }], {
    reason: "branch",
  });
  const failedSummary = commit(second, { kind: "summary", text: "", usage }, { at: 3 });
  await session.objects.put([failedSummary, failedSummary, { kind: "blob", value: "metadata" }]);
  await session.refs.update(
    [
      { name: headRef("main"), from: second, to: first },
      { name: headRef("other"), from: second, to: null },
    ],
    { reason: "rewind" },
  );
  const id = session.id;
  await session.close();
  await store.close();

  const reopened = await openStore(path).open(id);
  try {
    const commits = await storedCommits(reopened);
    const summary = projectUsage(commits);
    assert.equal(commits.length, 3);
    assert.equal(summary.total.totalTokens, 45);
    assert.equal(summary.models[0]?.turns, 2);
    assert.equal(summary.compaction.totalTokens, 15);
    assert.equal(await reopened.refs.read(headRef("main")), first);
  } finally {
    await reopened.close();
  }
});

test("portable checkpoints invalidate retained usage until a response sees the replacement prefix", async () => {
  const selected = { provider: "openai", api: "openai-responses", model: "test-model" } as const;
  const session = await openSession();
  await seedHead(session, "main", [
    message(user("old request", 100)),
    message(assistant("old answer", { at: 150 })),
    {
      kind: "checkpoint",
      summary: "gist",
      retainedTail: [
        assistant("kept", { at: 200, usage: { ...usage, input: 9_495, totalTokens: 9_500 } }),
      ],
      tokensBefore: 9_500,
    },
    message(user("tail", 2_000)),
  ]);
  const entries = await contextCommits(session.objects, await session.refs.read(headRef("main")));
  const commits = entries.map((entry) => entry.commit);
  for (const target of [undefined, selected]) {
    const status = projectContextStatus(commits, 10_000, target);
    assert.equal(status.usageTokens, 0);
    assert.equal(status.estimatedTokens, status.trailingTokens);
    assert.equal(status.percent, 0);
  }
  const prepared = prepareCheckpoint(entries, settings);
  assert.ok(prepared.ok && prepared.value);
  assert.equal(prepared.value.tokensBefore, projectContextStatus(commits, 10_000).estimatedTokens);

  await seedHead(session, "main", [
    message(
      assistant("new reply", { at: 3_000, usage: { ...usage, input: 195, totalTokens: 200 } }),
    ),
    message(user("tail", 4_000)),
  ]);
  const resumed = (
    await contextCommits(session.objects, await session.refs.read(headRef("main")))
  ).map((entry) => entry.commit);
  assert.equal(projectContextStatus(resumed, 10_000, selected).estimatedTokens, 201);
  assert.equal(projectContextStatus(resumed, 10_000, selected).usageTokens, 200);
});

test("usage applicability checks the whole prefix, not only the adjacent message", () => {
  const messages = [
    user("inserted", 500),
    user("older", 100),
    assistant("stale", { at: 200, usage: { ...usage, totalTokens: 9_500 } }),
  ];
  assert.equal(estimateContextTokens(messages).usageTokens, 0);
  assert.equal(
    estimateContextTokens([...messages, assistant("fresh", { at: 500 })]).usageTokens,
    usage.totalTokens,
  );
});
