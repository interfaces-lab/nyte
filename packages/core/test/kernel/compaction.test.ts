/**
 * Checkpoints: when the context must shrink, what the cut keeps, and how a
 * checkpoint reaches the branch. The summarizing model is a script.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { NOOP_TELEMETRY_CONTEXT } from "@nyte-ai/telemetry";
import { createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import type { AssistantMessage, Context, Usage } from "@nyte-ai/schema";
import {
  prepareCheckpoint,
  writeCheckpoint,
  type CompactionSettings,
} from "../../src/kernel/compaction.ts";
import { contextCommits } from "../../src/kernel/graph.ts";
import { hashObject } from "../../src/kernel/hash.ts";
import type { Commit, CommitBody, Oid } from "../../src/kernel/model.ts";
import { headRef, runRef } from "../../src/kernel/names.ts";
import { submit } from "../../src/kernel/queue.ts";
import { step } from "../../src/kernel/step.ts";
import type { Session } from "../../src/kernel/store.ts";
import { bindTurn, type TurnInput } from "../../src/kernel/turn.ts";
import type { StreamFn } from "../../src/types.ts";
import {
  assistant,
  call,
  commit,
  landing,
  lease,
  message,
  openSession,
  seedHead,
  toolResult,
  usage,
  user,
} from "./helpers.ts";

const model: Model<Api> = {
  id: "test-model",
  name: "Test model",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 1_000,
  maxTokens: 100,
};

const settings: CompactionSettings = { enabled: true, reserveTokens: 100, keepRecentTokens: 40 };

const heavy: Usage = { ...usage, input: 900, output: 50, totalTokens: 950 };

type Item = { readonly oid: Oid; readonly commit: Commit };

function items(bodies: readonly CommitBody[]): Item[] {
  const out: Item[] = [];
  let parent: Oid | null = null;
  for (const [index, body] of bodies.entries()) {
    const value = commit(parent, body, { at: 1_000 + index });
    const oid = hashObject(value);
    out.push({ oid, commit: value });
    parent = oid;
  }
  return out;
}

/** A model that answers every request with the same text. */
function summarizer(text: string) {
  const streamFn: StreamFn = () => {
    const stream = createAssistantMessageEventStream();
    const answer: AssistantMessage = assistant(text);
    queueMicrotask(() => stream.push({ type: "done", reason: "stop", message: answer }));
    return stream;
  };
  return { streamFn };
}

const longChat = (): CommitBody[] => [
  message(user("first question, with quite a lot of words in it to take up room")),
  message(
    assistant("first answer, also with a good number of words to take up room", {
      calls: [call("c1", "read")],
    }),
  ),
  message(toolResult("c1", "read", "a file with plenty of contents in it, line after line")),
  message(assistant("here is what the file says, in some detail, for the record")),
  message(user("second question")),
  message(assistant("second answer", { usage: heavy })),
  message(user("third question")),
];

test("a checkpoint cut keeps the recent tail whole and never separates a call from its result", () => {
  const prepared = prepareCheckpoint(items(longChat()), { ...settings, keepRecentTokens: 5 });
  assert.ok(prepared.ok && prepared.value !== undefined);
  const { messagesToSummarize, retainedTail } = prepared.value;
  assert.ok(messagesToSummarize.length > 0);
  assert.ok(retainedTail.length > 0);
  assert.notEqual(retainedTail[0]?.role, "toolResult");

  const alreadyCut = items([
    { kind: "checkpoint", summary: "s", retainedTail: [], tokensBefore: 1 },
  ]);
  assert.deepEqual(prepareCheckpoint(alreadyCut, settings), { ok: true, value: undefined });
});

test("a checkpoint lands on an idle head and becomes where the model's context starts", async () => {
  const session = await openSession();
  const oids = await seedHead(session, "main", longChat());
  const outcome = await writeCheckpoint(session, {
    head: "main",
    streamFn: summarizer("THE GIST").streamFn,
    model,
    settings,
    reason: "manual",
  });
  assert.equal(outcome.kind, "compacted");
  if (outcome.kind !== "compacted") return;
  assert.equal(await session.refs.read(headRef("main")), outcome.commit);
  const context = await contextCommits(session.objects, outcome.commit);
  assert.equal(context.length, 1);
  const checkpoint = context[0]?.commit;
  assert.equal(checkpoint?.parent, oids.at(-1));
  assert.ok(checkpoint?.body.kind === "checkpoint");
  assert.match(checkpoint.body.summary, /THE GIST/u);
  assert.ok(checkpoint.body.retainedTail.length > 0);
  assert.equal(checkpoint.body.usage?.totalTokens, usage.totalTokens);
  assert.equal(await session.leases.read(headRef("main")), undefined);

  assert.equal(
    (
      await writeCheckpoint(session, {
        head: "other",
        streamFn: summarizer("x").streamFn,
        model,
        settings,
        reason: "manual",
      })
    ).kind,
    "nothing_to_compact",
  );

  const held = await lease(session, "main");
  const busy = await writeCheckpoint(session, {
    head: "main",
    streamFn: summarizer("x").streamFn,
    model,
    settings,
    reason: "manual",
  });
  assert.equal(busy.kind, "busy");
  await session.leases.release(held);
});

async function turnInput(
  session: Session,
  commits: readonly Item[],
  runId = "run_1",
): Promise<TurnInput> {
  const held = (await session.leases.read(headRef("main"))) ?? (await lease(session, "main"));
  return {
    session,
    telemetry: NOOP_TELEMETRY_CONTEXT,
    lease: held,
    run: {
      kind: "run",
      id: runId,
      head: "main",
      phase: { kind: "respond" },
      startedAt: 1,
      attempts: 0,
      config: {},
    },
    now: 1,
    attempt: 1,
    commits,
    emit: () => undefined,
    signal: new AbortController().signal,
  };
}

test("the turn asks for a checkpoint before answering only when the last report says the next request will not fit", async () => {
  const session = await openSession();
  const script = summarizer("COMPACTED");
  const bind = (compaction: CompactionSettings) =>
    bindTurn({ streamFn: script.streamFn, model, systemPrompt: "system", tools: [], compaction });
  const turn = bind(settings);
  const outcome = await turn.respond(await turnInput(session, items(longChat())));
  assert.equal(outcome.kind, "checkpoint");
  if (outcome.kind === "checkpoint") assert.match(outcome.body.summary, /COMPACTED/u);

  const light = items([
    message(user("hi")),
    message(assistant("small", { usage })),
    message(user("more")),
  ]);
  assert.equal((await turn.respond(await turnInput(session, light))).kind, "complete");

  const disabled = bind({ ...settings, enabled: false });
  assert.equal(
    (await disabled.respond(await turnInput(session, items(longChat())))).kind,
    "complete",
  );
});

test("an oversized request compacts once, then the failure stands", async () => {
  const session = await openSession();
  const overflow = "prompt is too long: 2000 tokens > 1000 maximum";
  let requests = 0;
  const streamFn: StreamFn = (_model, context) => {
    requests += 1;
    const stream = createAssistantMessageEventStream();
    const summarizing = context.systemPrompt?.includes("summar") === true;
    queueMicrotask(() => {
      if (summarizing) stream.push({ type: "done", reason: "stop", message: assistant("SUMMARY") });
      else
        stream.push({
          type: "error",
          reason: "error",
          error: assistant("", { stop: "error", error: overflow }),
        });
    });
    return stream;
  };
  const turn = bindTurn({
    streamFn,
    model,
    systemPrompt: "system",
    tools: [],
    compaction: settings,
    retry: { enabled: false, maxRetries: 0, baseDelayMs: 0 },
  });
  const light = items([
    message(user("hi")),
    message(assistant("ok", { usage })),
    message(user("go")),
  ]);
  const first = await turn.respond(await turnInput(session, light));
  assert.equal(first.kind, "checkpoint");
  assert.equal(requests, 2);

  const afterCheckpoint = items([
    {
      ...(first.kind === "checkpoint"
        ? first.body
        : { kind: "checkpoint", summary: "", retainedTail: [], tokensBefore: 0 }),
    },
  ]).map((item) => ({ ...item, commit: { ...item.commit, run: "run_1" } }));
  const second = await turn.respond(await turnInput(session, afterCheckpoint));
  assert.equal(second.kind, "failed");
  assert.equal(requests, 3);
});

test("the step commits a checkpoint the turn asked for and asks again over the shorter context", async () => {
  const session = await openSession();
  let request: Context | undefined;
  const streamFn: StreamFn = (_model, context) => {
    request = context;
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "done", reason: "stop", message: assistant("done") });
    return stream;
  };
  const turn = bindTurn({
    streamFn,
    compactionStreamFn: summarizer("SHORTER").streamFn,
    model,
    systemPrompt: "system",
    tools: [],
    compaction: settings,
  });
  await seedHead(session, "main", longChat().slice(0, 6));
  await submit(session, { head: "main", lane: "now", body: message(user("latest")) });
  await step(session, turn, { head: "main", landing });
  const runBefore = await session.refs.read(runRef("main"));

  assert.equal((await step(session, turn, { head: "main", landing })).kind, "continue");
  const tip = await session.refs.read(headRef("main"));
  const tipCommit = tip === null ? undefined : await session.objects.get(tip);
  assert.equal(tipCommit?.kind === "commit" ? tipCommit.body.kind : undefined, "checkpoint");
  assert.equal(await session.refs.read(runRef("main")), runBefore);

  assert.equal((await step(session, turn, { head: "main", landing })).kind, "finished");
  assert.ok(request);
  const messages = JSON.stringify(request.messages);
  assert.match(messages, /SHORTER/u);
  assert.match(messages, /latest/u);
  assert.doesNotMatch(messages, /first question/u);
});
