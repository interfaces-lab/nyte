/**
 * The SDK, by the scenes the design is built for: several senders at once,
 * an abort mid-stream, a question a tool asks and a phone answers later, a
 * head that goes back, a session deleted under a run. The provider is a
 * script; everything else is real.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import type { AssistantMessage } from "@nyte-ai/schema";
import { InMemoryTelemetryContext, type TelemetryContext } from "@nyte-ai/telemetry";
import { Type } from "typebox";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import {
  type Drain,
  type Nyte,
  type SessionEvent,
  type SessionId,
} from "../../src/kernel/sdk/types.ts";
import {
  definePlugin,
  inlinePlugin,
  type AgentTool,
  type LoadedPlugin,
} from "../../src/plugins/index.ts";
import { headRef } from "../../src/kernel/names.ts";
import type { Store } from "../../src/kernel/store.ts";
import { ToolWait, type StreamFn } from "../../src/kernel/loop/types.ts";
import { assistant, call, openStore, sleep, usage, within } from "./helpers.ts";

const model: Model<Api> = {
  id: "echo-model",
  name: "Echo",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};

/**
 * Answers with how many user messages it saw, after `gate` (if any) opens.
 * The tail message decides: `ask` makes the model call one waiting tool;
 * `ask many` calls two whose IDs do not sort in call order.
 */
function echo(options: { readonly gate?: () => Promise<void> } = {}): StreamFn {
  return (_model, context, streamOptions) => {
    const users = context.messages.filter((item) => item.role === "user").length;
    const tail = context.messages.at(-1);
    const tailText =
      tail?.role === "user" && !Array.isArray(tail.content) ? tail.content : undefined;
    const wantsTool = tailText === "ask" || tailText === "ask many";
    const calls =
      tailText === "ask many"
        ? [call("z", "ask", { question: "first" }), call("a", "ask", { question: "second" })]
        : [call("ask-1", "ask", { question: "which?" })];
    const answer: AssistantMessage = wantsTool
      ? assistant("", { calls })
      : assistant(`saw ${String(users)}`, { usage });
    const stream = createAssistantMessageEventStream();
    // A real provider stream ends when its request is aborted; so does this one.
    const aborted = new Promise<"aborted">((resolve) => {
      const signal = streamOptions?.signal;
      if (signal === undefined) return;
      if (signal.aborted) resolve("aborted");
      else signal.addEventListener("abort", () => resolve("aborted"), { once: true });
    });
    void (async () => {
      stream.push({ type: "start", partial: { ...answer, content: [] } });
      stream.push({ type: "text_delta", contentIndex: 0, delta: "saw", partial: answer });
      const outcome = await Promise.race([options.gate?.() ?? Promise.resolve(), aborted]);
      if (outcome === "aborted") {
        stream.push({
          type: "error",
          reason: "aborted",
          error: { ...answer, stopReason: "aborted", content: [{ type: "text", text: "saw" }] },
        });
        return;
      }
      stream.push({ type: "done", reason: wantsTool ? "toolUse" : "stop", message: answer });
    })();
    return stream;
  };
}

const askParameters = Type.Object({ question: Type.String() });
const askTool: AgentTool<typeof askParameters> = {
  name: "ask",
  description: "asks the user",
  parameters: askParameters,
  execute: async () => {
    throw new ToolWait();
  },
  wake: async (_call, context) => ({
    kind: "settle",
    result: {
      content: [{ type: "text", text: `they said ${JSON.stringify(context.reply)}` }],
      details: {},
    },
  }),
};

function plugins(): LoadedPlugin[] {
  return [
    inlinePlugin(
      definePlugin({
        id: "tools",
        session(api) {
          api.tools.add((draft) => draft.set("ask", askTool));
          api.prompt.add((draft) => draft.set("p", { text: "You are a test." }));
        },
      }),
    ),
  ];
}

async function open(
  streamFn: StreamFn = echo(),
  extra: {
    readonly drain?: Drain;
    readonly store?: Store;
    readonly telemetry?: TelemetryContext;
  } = {},
): Promise<Nyte> {
  return createNyte({
    store: extra.store ?? openStore(),
    streamFn,
    models: {
      getModels: () => [model],
      getModel: (_provider, id) => (id === model.id ? model : undefined),
      getAvailable: async () => [model],
    },
    model,
    plugins: plugins(),
    env: { cwd: "/tmp/nowhere" },
    ...extra,
  });
}

async function transcript(nyte: Nyte, id: SessionId): Promise<string[]> {
  const turns = await nyte.messages.list({ sessionId: id });
  return turns.flatMap((turn) =>
    turn.kind === "turn"
      ? turn.parts.flatMap((part) =>
          part.kind === "user"
            ? [`user:${Array.isArray(part.content) ? "…" : part.content}`]
            : part.kind === "assistant"
              ? [`assistant:${part.text}`]
              : part.kind === "tool"
                ? ["tool"]
                : [],
        )
      : [],
  );
}

async function collect(
  nyte: Nyte,
  input: { readonly sessionId: SessionId; readonly afterSeq: number },
  done: (event: SessionEvent, seen: readonly SessionEvent[]) => boolean,
): Promise<SessionEvent[]> {
  const stop = new AbortController();
  const seen: SessionEvent[] = [];
  try {
    for await (const event of nyte.watch({ ...input, signal: stop.signal })) {
      seen.push(event);
      if (done(event, seen)) return seen;
    }
    throw new Error("Watch ended before the expected event");
  } finally {
    stop.abort();
  }
}

async function waitIdFor(nyte: Nyte, id: SessionId, callId: string): Promise<string> {
  const snapshot = await nyte.sessions.snapshot({ sessionId: id });
  const call = snapshot?.parked?.find((candidate) => candidate.callId === callId);
  if (call === undefined) throw new Error(`Missing parked call ${callId}`);
  return call.waitId;
}

test("messages default to next and may steer explicitly", async () => {
  const nyte = await open();
  try {
    const { sessionId } = await nyte.sessions.create();
    await nyte.messages.send({ sessionId, content: "one" });
    await nyte.messages.send({ sessionId, delivery: "steer", content: "two" });
    assert.deepEqual(
      (await nyte.messages.pending({ sessionId })).map((item) => [item.delivery, item.content]),
      [
        ["next", "one"],
        ["steer", "two"],
      ],
    );
  } finally {
    await nyte.close();
  }
});

test("three phones send at the same moment; one run answers each, in order, and nobody sees an error", async () => {
  const nyte = await open();
  try {
    const { sessionId: id } = await nyte.sessions.create({ name: "room" });
    nyte.attach();
    const receipts = await Promise.all(
      ["one", "two", "three"].map((content) => nyte.messages.send({ sessionId: id, content })),
    );
    assert.ok(receipts.every((receipt) => receipt.kind === "queued"));
    assert.deepEqual(await nyte.runs.wait({ sessionId: id }), { kind: "idle" });

    const lines = await transcript(nyte, id);
    assert.deepEqual(
      lines.filter((line) => line.startsWith("user:")),
      ["user:one", "user:two", "user:three"],
    );
    assert.deepEqual(
      lines.filter((line) => line.startsWith("assistant:")),
      ["assistant:saw 1", "assistant:saw 2", "assistant:saw 3"],
    );
    assert.deepEqual(await nyte.messages.pending({ sessionId: id }), []);
    assert.equal((await nyte.heads.list({ sessionId: id })).length, 1);
    const info = await nyte.sessions.get({ sessionId: id });
    assert.equal(info?.name, "room");
    assert.equal(info?.preview, "saw 3");
  } finally {
    await nyte.close();
  }
});

test("a client that opens from a snapshot and watches from its seq sees synced, then every new commit", async () => {
  const nyte = await open();
  try {
    const { sessionId: id } = await nyte.sessions.create();
    const snapshot = await nyte.sessions.snapshot({ sessionId: id });
    assert.ok(snapshot !== undefined);
    assert.deepEqual(snapshot.transcript, []);

    nyte.attach();
    const choice = await nyte.sessions.configure({ sessionId: id, thinkingLevel: "high" });
    assert.ok(choice.kind === "queued");
    await nyte.messages.send({ sessionId: id, content: "hello" });
    const events = await collect(
      nyte,
      { sessionId: id, afterSeq: snapshot.seq },
      (event) => event.kind === "run" && event.run.phase.kind === "done",
    );
    assert.ok(
      events.some((event) => event.kind === "synced"),
      "replay ends with synced",
    );
    // The choice is announced when queued, before the drain that commits it.
    const queuedChoice = events.findIndex(
      (event) => event.kind === "config_queued" && event.change === choice.change,
    );
    const landedChoice = events.findIndex(
      (event) => event.kind === "landed" && event.change === choice.change,
    );
    assert.ok(queuedChoice !== -1 && landedChoice > queuedChoice);
    assert.equal(
      events[queuedChoice]?.kind === "config_queued" && events[queuedChoice].head,
      "main",
    );
    const commits = events.flatMap((event) =>
      event.kind === "commit"
        ? [
            event.item.commit.body.kind === "message"
              ? event.item.commit.body.message.role
              : event.item.commit.body.kind,
          ]
        : [],
    );
    assert.deepEqual(commits, ["config", "user", "assistant"]);
    assert.ok(events.some((event) => event.kind === "text_delta" && event.delta === "saw"));
    assert.ok(events.some((event) => event.kind === "queued"));
    assert.ok(events.some((event) => event.kind === "landed"));
  } finally {
    await nyte.close();
  }
});

test("a stop with a steer waiting ends the run; a new run answers the steer, and a second stop ends that one too", async () => {
  const gates: (() => void)[] = [];
  const nyte = await open(
    echo({ gate: () => new Promise<void>((resolve) => gates.push(resolve)) }),
  );
  try {
    const { sessionId: id } = await nyte.sessions.create();
    nyte.attach();
    await nyte.messages.send({ sessionId: id, content: "hello" });
    await collect(nyte, { sessionId: id, afterSeq: 0 }, (event) => event.kind === "text_delta");
    const first = (await nyte.sessions.snapshot({ sessionId: id }))?.run;
    assert.ok(first !== undefined);

    await nyte.messages.send({ sessionId: id, content: "do this instead", delivery: "steer" });
    assert.equal((await nyte.runs.abort({ sessionId: id })).kind, "requested");
    // The interrupted answer stays and the stopped run ends. The steer lands as
    // a new run, asked under a fresh signal: the stop did not cancel that call.
    const seen = await collect(
      nyte,
      { sessionId: id, afterSeq: 0 },
      (_event, seen) => seen.filter((item) => item.kind === "text_delta").length === 2,
    );
    assert.ok(
      seen.some(
        (event) =>
          event.kind === "run" &&
          event.run.runId === first.runId &&
          event.run.phase.kind === "aborted",
      ),
    );
    const steered = (await nyte.sessions.snapshot({ sessionId: id }))?.run;
    assert.ok(steered !== undefined);
    assert.notEqual(steered.runId, first.runId);
    assert.equal(steered.phase.kind, "respond");
    assert.equal(steered.abortRequested, undefined);
    assert.deepEqual(await nyte.messages.pending({ sessionId: id }), []);

    const afterSteer = seen.at(-1)?.seq ?? 0;
    assert.equal((await nyte.runs.abort({ sessionId: id })).kind, "requested");
    await collect(
      nyte,
      { sessionId: id, afterSeq: afterSteer },
      (event) =>
        event.kind === "run" &&
        event.run.runId === steered.runId &&
        event.run.phase.kind === "aborted",
    );
    assert.deepEqual(await nyte.runs.wait({ sessionId: id }), { kind: "idle" });
    assert.deepEqual(await nyte.runs.abort({ sessionId: id }), { kind: "not_running" });
    assert.deepEqual(await transcript(nyte, id), [
      "user:hello",
      "assistant:saw",
      "user:do this instead",
      "assistant:saw",
    ]);
    assert.equal(gates.length, 2);
  } finally {
    for (const release of gates) release();
    await nyte.close();
  }
});

test("pending messages can be taken back or moved between deliveries while a run is live", async () => {
  let release: (() => void) | undefined;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  const nyte = await open(echo({ gate: () => opened }));
  try {
    const { sessionId: id } = await nyte.sessions.create();
    nyte.attach();
    await nyte.messages.send({ sessionId: id, content: "first" });
    await collect(nyte, { sessionId: id, afterSeq: 0 }, (event) => event.kind === "text_delta");

    const later = await nyte.messages.send({ sessionId: id, content: "next", delivery: "next" });
    const gone = await nyte.messages.send({ sessionId: id, content: "mistake" });
    assert.ok(later.kind === "queued" && gone.kind === "queued");
    assert.deepEqual(await nyte.messages.cancel({ sessionId: id, change: gone.change }), {
      kind: "cancelled",
    });
    const moved = await nyte.messages.redeliver({
      sessionId: id,
      change: later.change,
      delivery: "steer",
    });
    assert.equal(moved.kind, "redelivered");
    assert.deepEqual(
      (await nyte.messages.pending({ sessionId: id })).map((item) => [item.delivery, item.content]),
      [["steer", "next"]],
    );

    release?.();
    assert.deepEqual(await nyte.runs.wait({ sessionId: id }), { kind: "idle" });
    assert.deepEqual(
      (await transcript(nyte, id)).filter((line) => line.startsWith("user:")),
      ["user:first", "user:next"],
    );
  } finally {
    release?.();
    await nyte.close();
  }
});

test("submission metadata follows a message from the queue into the record, outside its content", async () => {
  let release: (() => void) | undefined;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  const nyte = await open(echo({ gate: () => opened }));
  try {
    const { sessionId: id } = await nyte.sessions.create();
    nyte.attach();
    await nyte.messages.send({ sessionId: id, content: "first" });
    await collect(nyte, { sessionId: id, afterSeq: 0 }, (event) => event.kind === "text_delta");
    const before = await nyte.sessions.snapshot({ sessionId: id });
    assert.ok(before !== undefined);

    const source = { kind: "action", label: "Commit changes" } as const;
    const keyed = await nyte.messages.send({
      sessionId: id,
      content: "keyed",
      delivery: "next",
      key: "outbox-1",
      source,
    });
    assert.equal(keyed.kind, "queued");
    const queuedItem = (await nyte.messages.pending({ sessionId: id })).find(
      (item) => item.change === keyed.change,
    );
    assert.deepEqual(queuedItem?.source, source);
    const held = await nyte.sessions.snapshot({ sessionId: id });
    assert.deepEqual(
      held?.pending.map((item) => [item.change, item.key, item.source]),
      [[keyed.change, "outbox-1", source]],
    );

    release?.();
    const events = await collect(
      nyte,
      { sessionId: id, afterSeq: before.seq },
      (event) => event.kind === "landed" && event.change === keyed.change,
    );
    const queued = events.find((event) => event.kind === "queued");
    assert.ok(queued?.kind === "queued");
    assert.deepEqual(
      [queued.item.change, queued.item.key, queued.item.source],
      [keyed.change, "outbox-1", source],
    );
    const drain = events.find(
      (event) => event.kind === "commit" && event.item.commit.change === keyed.change,
    );
    assert.ok(drain?.kind === "commit");
    assert.equal(drain.item.commit.key, "outbox-1");
    // The key is commit metadata: the model's message is untouched.
    assert.ok(drain.item.commit.body.kind === "message");
    assert.deepEqual(
      "source" in drain.item.commit.body ? drain.item.commit.body.source : undefined,
      source,
    );
    assert.deepEqual(Object.keys(drain.item.commit.body.message).sort(), [
      "content",
      "role",
      "timestamp",
    ]);
    assert.equal(drain.item.commit.body.message.content, "keyed");

    assert.deepEqual(await nyte.runs.wait({ sessionId: id }), { kind: "idle" });
    const after = await nyte.sessions.snapshot({ sessionId: id });
    const userParts =
      after?.transcript.flatMap((turn) =>
        turn.kind === "turn"
          ? turn.parts.flatMap((part) =>
              part.kind === "user" ? [[part.commit, part.content, part.key, part.source]] : [],
            )
          : [],
      ) ?? [];
    assert.deepEqual(
      userParts.map(([, content, key, partSource]) => [content, key, partSource]),
      [
        ["first", undefined, undefined],
        ["keyed", "outbox-1", source],
      ],
    );
    assert.equal(userParts[1]?.[0], drain.item.oid);
    assert.deepEqual(after?.pending, []);
  } finally {
    release?.();
    await nyte.close();
  }
});

test("a tool that asks a question parks the run; the answer wakes it and the run finishes", async () => {
  const nyte = await open();
  try {
    const { sessionId: id } = await nyte.sessions.create();
    nyte.attach();
    await nyte.messages.send({ sessionId: id, content: "ask" });
    const parked = await nyte.runs.wait({ sessionId: id });
    assert.equal(parked.kind, "waiting");
    const current = await nyte.runs.current({ sessionId: id });
    assert.equal(current?.phase.kind, "waiting");

    const waitId = await waitIdFor(nyte, id, "ask-1");
    // @ts-expect-error A JavaScript caller can omit a required TypeScript field.
    assert.deepEqual(await nyte.runs.reply({ sessionId: id, callId: "ask-1", reply: "stale" }), {
      kind: "not_waiting",
    });
    const answered = await nyte.runs.reply({
      sessionId: id,
      callId: "ask-1",
      waitId,
      reply: "blue",
    });
    assert.equal(answered.kind, "signalled");
    assert.deepEqual(await nyte.runs.wait({ sessionId: id }), { kind: "idle" });
    const lines = await transcript(nyte, id);
    assert.ok(lines.includes("tool"));
    assert.equal(lines.at(-1), "assistant:saw 1");
    // The settled call's effect is cleared with its result; a late answer has nothing to land on.
    assert.equal(
      (await nyte.runs.reply({ sessionId: id, callId: "ask-1", waitId, reply: "red" })).kind,
      "not_found",
    );
  } finally {
    await nyte.close();
  }
});

test("parked calls keep the assistant tool-call order instead of sorting opaque IDs", async () => {
  const nyte = await open();
  try {
    const { sessionId: id } = await nyte.sessions.create();
    nyte.attach();
    await nyte.messages.send({ sessionId: id, content: "ask many" });
    assert.equal((await nyte.runs.wait({ sessionId: id })).kind, "waiting");
    assert.deepEqual(
      (await nyte.sessions.snapshot({ sessionId: id }))?.parked?.map((call) => call.callId),
      ["z", "a"],
    );
  } finally {
    await nyte.close();
  }
});

test("telemetry follows a run from response requests through a parked tool and completion", async () => {
  const telemetry = new InMemoryTelemetryContext();
  const nyte = await open(echo(), { telemetry });
  try {
    const { sessionId } = await nyte.sessions.create();
    nyte.attach();
    await nyte.messages.send({ sessionId, content: "ask" });
    assert.equal((await nyte.runs.wait({ sessionId })).kind, "waiting");
    await nyte.runs.reply({
      sessionId,
      callId: "ask-1",
      waitId: await waitIdFor(nyte, sessionId, "ask-1"),
      reply: "blue",
    });
    assert.deepEqual(await nyte.runs.wait({ sessionId }), { kind: "idle" });
    const run = await nyte.runs.current({ sessionId });
    assert.ok(run);
    assert.equal(run.phase.kind, "done");

    const spans = telemetry.spans();
    const response = spans.find(
      (span) => span.name === "nyte.respond" && span.attributes["nyte.respond.outcome"] === "tools",
    );
    assert.ok(response?.ended);
    assert.partialDeepStrictEqual(response.attributes, {
      "nyte.run.id": run.runId,
      "nyte.attempt": 1,
      "nyte.model.provider": model.provider,
      "nyte.model.id": model.id,
      "nyte.respond.outcome": "tools",
      "nyte.stop_reason": "toolUse",
    });
    const responseStep = spans.find((span) => span.id === response.parentId);
    assert.ok(responseStep?.ended);
    assert.equal(responseStep.name, "nyte.step");
    assert.equal(responseStep.parentId, undefined);
    assert.partialDeepStrictEqual(responseStep.attributes, {
      "nyte.session.id": sessionId,
      "nyte.head": "main",
      "nyte.run.id": run.runId,
      "nyte.run.phase": "respond",
      "nyte.step.outcome": "continue",
    });
    const request = spans.find(
      (span) => span.name === "nyte.ai.request" && span.parentId === response.id,
    );
    assert.ok(request?.ended);
    assert.partialDeepStrictEqual(request.attributes, {
      "nyte.model.provider": model.provider,
      "nyte.model.id": model.id,
      "nyte.model.api": model.api,
      "nyte.request.step": "assistant",
      "nyte.stop_reason": "toolUse",
    });
    assert.ok(Number.isFinite(request.attributes["nyte.ai.time_to_first_event_ms"]));
    assert.ok(Number.isSafeInteger(request.attributes["nyte.ai.event_count"]));
    const tool = spans.find(
      (span) => span.name === "nyte.tool" && span.attributes["nyte.tool.parked"] === true,
    );
    assert.ok(tool?.ended);
    assert.deepEqual(tool.attributes, {
      "nyte.run.id": run.runId,
      "nyte.tool.name": "ask",
      "nyte.call.id": "ask-1",
      "nyte.tool.is_error": false,
      "nyte.tool.parked": true,
    });
    const toolStep = spans.find((span) => span.id === tool.parentId);
    assert.ok(toolStep?.ended);
    assert.equal(toolStep.name, "nyte.step");
    assert.equal(toolStep.parentId, undefined);
    assert.partialDeepStrictEqual(toolStep.attributes, {
      "nyte.session.id": sessionId,
      "nyte.head": "main",
      "nyte.run.id": run.runId,
      "nyte.run.phase": "tools",
      "nyte.step.outcome": "waiting",
    });
    assert.ok(
      spans.some(
        (span) =>
          span.name === "nyte.respond" && span.attributes["nyte.respond.outcome"] === "complete",
      ),
    );
    assert.ok(
      spans.some(
        (span) =>
          span.name === "nyte.tool" &&
          span.attributes["nyte.tool.parked"] === false &&
          span.attributes["nyte.tool.is_error"] === false,
      ),
    );
  } finally {
    await nyte.close();
  }
});

test("going back to a message hands it to the composer, and a new head runs on its own", async () => {
  const nyte = await open();
  try {
    const { sessionId: id } = await nyte.sessions.create();
    nyte.attach();
    await nyte.messages.send({ sessionId: id, content: "first" });
    await nyte.runs.wait({ sessionId: id });
    const turns = await nyte.messages.list({ sessionId: id });
    const first = turns[0];
    assert.ok(first?.kind === "turn");
    const userPart = first.parts.find((part) => part.kind === "user");
    assert.ok(userPart?.kind === "user");

    const moved = await nyte.heads.move({ sessionId: id, to: userPart.commit });
    assert.equal(moved.kind, "moved");
    if (moved.kind === "moved") assert.equal(moved.restored?.content, "first");
    assert.deepEqual(await transcript(nyte, id), []);

    const created = await nyte.heads.create({
      sessionId: id,
      head: "side",
      from: { head: "main" },
    });
    assert.equal(created.kind, "created");
    assert.deepEqual(
      await nyte.heads.create({ sessionId: id, head: "typo", from: { head: "mian" } }),
      { kind: "unknown_parent" },
    );
    await nyte.messages.send({ sessionId: id, head: "side", content: "on the side" });
    assert.deepEqual(await nyte.runs.wait({ sessionId: id, head: "side" }), { kind: "idle" });
    assert.deepEqual(
      (await nyte.messages.list({ sessionId: id, head: "side" })).map((turn) => turn.kind),
      ["turn"],
    );
    assert.deepEqual(await transcript(nyte, id), []);
    assert.deepEqual(
      (await nyte.heads.list({ sessionId: id })).map((head) => head.head),
      ["main", "side"],
    );
  } finally {
    await nyte.close();
  }
});

test("deleting a session under a live run ends the run and forgets the session", async () => {
  let release: (() => void) | undefined;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  const nyte = await open(echo({ gate: () => opened }));
  try {
    const { sessionId: id } = await nyte.sessions.create({ name: "doomed" });
    nyte.attach();
    await nyte.messages.send({ sessionId: id, content: "hello" });
    await collect(nyte, { sessionId: id, afterSeq: 0 }, (event) => event.kind === "text_delta");
    const deleting = nyte.sessions.delete({ sessionId: id });
    release?.();
    await within(deleting, 5_000);
    assert.equal(await nyte.sessions.get({ sessionId: id }), undefined);
    assert.deepEqual((await nyte.sessions.list()).items, []);
  } finally {
    release?.();
    await nyte.close();
  }
});

test("a plugin change reaches every watcher of an open session", async () => {
  const nyte = await open();
  try {
    const { sessionId: id } = await nyte.sessions.create();
    nyte.attach();
    const controller = new AbortController();
    const events = nyte
      .watch({ sessionId: id, live: true, signal: controller.signal })
      [Symbol.asyncIterator]();
    const first = await within(events.next(), 5_000);
    assert.equal(first.done === false ? first.value.kind : "done", "synced");

    await nyte.messages.send({ sessionId: id, content: "hello" });
    assert.deepEqual(await nyte.runs.wait({ sessionId: id }), { kind: "idle" });
    await nyte.setPlugins([]);
    let changed = false;
    for (;;) {
      const next = await within(events.next(), 5_000);
      if (next.done === true) break;
      if (next.value.kind === "plugins_changed") {
        changed = true;
        break;
      }
    }
    assert.equal(changed, true);
    controller.abort();
  } finally {
    await nyte.close();
  }
});

test("idle from runs.wait means the head is free: a runner still holding the lease keeps the waiter waiting", async () => {
  const store = openStore();
  const nyte = await open(echo(), { store });
  try {
    const { sessionId: id } = await nyte.sessions.create();
    nyte.attach();
    await nyte.messages.send({ sessionId: id, content: "one" });
    assert.deepEqual(await nyte.runs.wait({ sessionId: id }), { kind: "idle" });

    // The run is over, but a runner that has not let go yet still owns the head.
    const session = await store.open(id);
    const held = await session.leases.acquire(headRef("main"), 30_000);
    assert.ok(held.ok);
    if (!held.ok) return;
    let settled = false;
    const waiting = nyte.runs.wait({ sessionId: id }).then((outcome) => {
      settled = true;
      return outcome;
    });
    await sleep(60);
    assert.equal(settled, false);
    await session.leases.release(held.lease);
    assert.deepEqual(await within(waiting), { kind: "idle" });
  } finally {
    await nyte.close();
  }
});

test("closing while a run is still streaming does not hang", async () => {
  let release: (() => void) | undefined;
  const opened = new Promise<void>((resolve) => {
    release = resolve;
  });
  const nyte = await open(echo({ gate: () => opened }));
  const { sessionId: id } = await nyte.sessions.create();
  nyte.attach();
  await nyte.messages.send({ sessionId: id, content: "hello" });
  await collect(nyte, { sessionId: id, afterSeq: 0 }, (event) => event.kind === "text_delta");
  await within(nyte.close(), 5_000);
  release?.();
});

test("the prospective plugin catalog is sessionless, cached, and invalidated by setPlugins", async () => {
  const store = openStore();
  let activations = 0;
  let commandRuns = 0;
  const catalogPlugin = (id: string, commandName: string): LoadedPlugin =>
    inlinePlugin(
      definePlugin({
        id,
        async session(api) {
          activations += 1;
          await api.storage.set("catalog", commandName);
          api.settings.add((draft) =>
            draft.set("verbosity", {
              key: "verbosity",
              label: "Verbosity",
              choices: [
                { id: "low", label: "Low" },
                { id: "high", label: "High" },
              ],
              fallback: "high",
            }),
          );
          api.commands.add((draft) =>
            draft.set(commandName, {
              description: `Run ${commandName}`,
              run: () => {
                commandRuns += 1;
                return "ran";
              },
            }),
          );
          api.resources.add((draft) =>
            draft.set(commandName, {
              name: commandName,
              description: `Use ${commandName}`,
              content: `${commandName} instructions`,
              filePath: `/skills/${commandName}/SKILL.md`,
            }),
          );
        },
      }),
    );
  const nyte = await createNyte({
    store,
    streamFn: echo(),
    models: { getModels: () => [model], getModel: () => model, getAvailable: async () => [model] },
    model,
    plugins: [catalogPlugin("first-plugin", "first")],
    env: { cwd: "/tmp/nowhere" },
  });
  try {
    const first = await nyte.plugins.catalog();
    assert.deepEqual(first, {
      plugins: [{ id: "first-plugin", version: "inline", source: "inline", status: "active" }],
      commands: [{ name: "first", owner: "first-plugin", description: "Run first" }],
      skills: [
        {
          name: "first",
          description: "Use first",
          content: "first instructions",
          filePath: "/skills/first/SKILL.md",
        },
      ],
      settings: [
        {
          id: "verbosity",
          owner: "first-plugin",
          label: "Verbosity",
          choices: [
            { id: "low", label: "Low" },
            { id: "high", label: "High" },
          ],
          current: "high",
        },
      ],
    });
    assert.equal(await nyte.plugins.catalog(), first);
    assert.equal(activations, 1);
    assert.equal(commandRuns, 0);
    assert.deepEqual(await store.list(), []);

    await nyte.setPlugins([catalogPlugin("second-plugin", "second")]);
    assert.deepEqual((await nyte.plugins.catalog()).commands, [
      { name: "second", owner: "second-plugin", description: "Run second" },
    ]);
    assert.equal(activations, 2);
    assert.equal(commandRuns, 0);
    assert.deepEqual(await store.list(), []);

    const { sessionId: id } = await nyte.sessions.create();
    assert.deepEqual(
      await nyte.plugins.settings.apply({ sessionId: id, id: "verbosity", choiceId: "low" }),
      {
        kind: "applied",
      },
    );
    assert.equal((await nyte.plugins.settings.list({ sessionId: id }))[0]?.current, "low");
    assert.equal((await nyte.plugins.catalog()).settings[0]?.current, "high");
  } finally {
    await nyte.close();
  }
});

test("the prospective inventory includes failed plugins without creating a chat", async () => {
  const store = openStore();
  const nyte = await createNyte({
    store,
    streamFn: echo(),
    models: { getModels: () => [model], getModel: () => model, getAvailable: async () => [model] },
    model,
    plugins: [
      inlinePlugin(
        definePlugin({
          id: "broken",
          session() {
            throw new Error("Cannot connect");
          },
        }),
      ),
    ],
    env: { cwd: "/tmp/nowhere" },
  });
  try {
    const inventory = await nyte.plugins.catalog();
    assert.deepEqual(inventory.plugins, [
      {
        id: "broken",
        version: "inline",
        source: "inline",
        status: "failed",
        error: "Cannot connect",
      },
    ]);
    assert.deepEqual(inventory.settings, []);
    assert.deepEqual(await store.list(), []);
  } finally {
    await nyte.close();
  }
});

test("lazy activation resolves new-session and session targets explicitly", async () => {
  const targets: string[] = [];
  const plugin = inlinePlugin(
    definePlugin({
      id: "catalog",
      session(api) {
        api.commands.add((draft) =>
          draft.set("catalog", { description: "Catalog", run: () => undefined }),
        );
      },
    }),
  );
  const nyte = await createNyte({
    store: openStore(),
    streamFn: echo(),
    models: { getModels: () => [model], getModel: () => model, getAvailable: async () => [model] },
    model,
    resolveActivation(target) {
      targets.push(
        target.kind === "new-session" ? target.kind : `${target.kind}:${target.sessionId}`,
      );
      return { kind: "active", plugins: [plugin], env: { cwd: "/tmp/nowhere" } };
    },
  });
  try {
    await nyte.plugins.catalog();
    const { sessionId: id } = await nyte.sessions.create();
    await nyte.plugins.commands.list({ sessionId: id });
    assert.deepEqual(targets, ["new-session", `session:${id}`]);
  } finally {
    await nyte.close();
  }
});

test("a plugin command may read messages, name its session, or answer with a client prompt", async () => {
  const nyte = await createNyte({
    store: openStore(),
    streamFn: echo(),
    models: { getModels: () => [model], getModel: () => model, getAvailable: async () => [model] },
    model,
    plugins: [
      ...plugins(),
      inlinePlugin(
        definePlugin({
          id: "commands",
          session(api) {
            api.commands.add((draft) => {
              draft.set("rename", {
                description: "Name the chat",
                run: async (argument) => {
                  const users = (await api.session.context()).messages.filter(
                    (message) => message.role === "user",
                  ).length;
                  await api.session.rename(`${argument} after ${String(users)}`);
                  return "named";
                },
              });
              draft.set("review", {
                description: "Review",
                run: (argument) => ({ prompt: `Review ${argument}` }),
              });
            });
          },
        }),
      ),
    ],
    env: { cwd: "/tmp/nowhere" },
  });
  try {
    const { sessionId } = await nyte.sessions.create();
    assert.deepEqual(
      await nyte.plugins.commands.run({ sessionId, name: "rename", argument: "x" }),
      {
        kind: "ran",
        output: "named",
      },
    );
    assert.equal((await nyte.sessions.get({ sessionId }))?.name, "x after 0");
    nyte.attach();
    await nyte.messages.send({ sessionId, content: "hello" });
    await nyte.runs.wait({ sessionId });
    assert.deepEqual(
      await nyte.plugins.commands.run({ sessionId, name: "rename", argument: "y" }),
      {
        kind: "ran",
        output: "named",
      },
    );
    assert.equal((await nyte.sessions.get({ sessionId }))?.name, "y after 1");
    assert.deepEqual(
      await nyte.plugins.commands.run({ sessionId, name: "review", argument: "it" }),
      {
        kind: "prompt",
        prompt: "Review it",
      },
    );
  } finally {
    await nyte.close();
  }
});

test("a directory list served from its cached row still reflects every write made since", async () => {
  const nyte = await open();
  try {
    const { sessionId: id } = await nyte.sessions.create();
    const row = async () =>
      (await nyte.sessions.list({ includeArchived: true })).items.find(
        (item) => item.sessionId === id,
      );
    assert.equal((await row())?.name, undefined);
    // The second list is answered from the row kept by the first; a rename, a
    // pin, an archive, and a message each move the cursor it is keyed by.
    assert.equal((await row())?.name, undefined);
    await nyte.sessions.rename({ sessionId: id, name: "Renamed" });
    assert.equal((await row())?.name, "Renamed");
    await nyte.sessions.setPinned({ sessionId: id, pinned: true });
    assert.equal((await row())?.pinned, true);
    await nyte.sessions.setArchived({ sessionId: id, archived: true });
    assert.equal((await row())?.archived, true);
    assert.equal(
      (await nyte.sessions.list()).items.some((item) => item.sessionId === id),
      false,
    );
    nyte.attach();
    await nyte.messages.send({ sessionId: id, content: "hello" });
    assert.deepEqual(await nyte.runs.wait({ sessionId: id }), { kind: "idle" });
    assert.equal((await row())?.preview, "saw 1");
  } finally {
    await nyte.close();
  }
});
