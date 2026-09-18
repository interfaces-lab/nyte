import assert from "node:assert/strict";
import { test } from "vitest";
import { contentText, createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import type { AssistantMessage, Usage } from "@nyte-ai/schema";
import { writeCheckpoint } from "../../src/kernel/compaction.ts";
import { contextMessages } from "@nyte-ai/client";
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
import type { StreamFn } from "../../src/types.ts";
import {
  assistant,
  landing,
  message,
  openStore,
  seedHead,
  setHead,
  storePath,
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

function usage(tokens: number): Usage {
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
  const commits: Commit[] = [];
  for (const entry of await session.objects.list()) {
    const object = await session.objects.get(entry.oid);
    if (object?.kind === "commit") commits.push(object);
  }
  return commits;
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
          ? assistant("partial", { stop: "error", error: "503", usage: usage(100) })
          : assistant("summary", { usage: usage(200) }),
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
          return stream(assistant("partial", { stop: "error", error: "503", usage: usage(100) }));
        }
        if (requests === 1) {
          return stream(
            assistant("history summary", { stop: "error", error: "503", usage: usage(100) }),
          );
        }
        if (mode === "thrown") throw new Error("transport broke");
        if (mode === "cancelled") controller.abort();
        return stream(
          assistant("partial", {
            stop: mode === "provider-aborted" ? "aborted" : "error",
            error: "billing",
            usage: usage(200),
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
      message(assistant("answer", { usage: usage(2_000) })),
    ]);
    const controller = new AbortController();
    const streamFn: StreamFn = () => stream(assistant("normal answer", { usage: usage(200) }));
    const turn = bindTurn({
      streamFn,
      compactionStreamFn: () => {
        if (cancelled) controller.abort();
        return stream(
          assistant("partial summary", { stop: "error", error: "billing", usage: usage(100) }),
        );
      },
      model,
      systemPrompt: "normal agent",
      tools: [],
      compaction: settings,
      retry,
    });
    await submit(session, { head: "main", lane: "now", body: message(user("continue")) });
    const options = { head: "main", landing, signal: controller.signal };
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
      return stream(assistant("summary", { usage: usage(100) }));
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
    env: { cwd: "/tmp" },
    plugins: [],
    models: { getModels: () => [model], getModel: () => model, getAvailable: async () => [model] },
    streamFn: () =>
      stream(assistant("partial", { stop: "error", error: "billing", usage: usage(100) })),
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
              usage: usage(100),
            })
          : assistant("summary", { usage: usage(100) }),
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
      usage: usage(100),
    });
    let requests = 0;
    const turn = bindTurn({
      model,
      systemPrompt: "normal agent",
      tools: [],
      compaction: settings,
      retry,
      streamFn: () =>
        stream(++requests === 1 ? failed : assistant("recovered answer", { usage: usage(300) })),
      compactionStreamFn: async () => {
        if (conflict) await setHead(session, "main", target);
        return stream(assistant("summary", { usage: usage(200) }));
      },
    });
    await submit(session, { head: "main", lane: "now", body: message(user("continue")) });
    const options = { head: "main", landing };
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
