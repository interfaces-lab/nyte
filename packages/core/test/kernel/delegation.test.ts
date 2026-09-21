/**
 * Children as persistent sessions: the parent creates one, sends it work,
 * waits with a deadline, reads it, and stops it; each answered request lands
 * on the parent as one completion. The provider is a script; the store, the
 * runners, and every session are real. Design: design.mdx, "Agents".
 */
import assert from "node:assert/strict";
import { dirname } from "node:path";
import { contentText, createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import {
  isTerminalPhase,
  sessionId,
  type DelegateRequest,
  type JobReport,
  type SessionId,
} from "@nyte-ai/protocol";
import { Type } from "typebox";
import { expect, test } from "vitest";
import {
  putDelegationRecord,
  readDelegation,
  type DelegationRecord,
} from "../../src/kernel/delegation-record.ts";
import { branch } from "../../src/kernel/graph.ts";
import type { Run } from "../../src/kernel/model.ts";
import { trimStream } from "../../src/kernel/gc.ts";
import { delegationPrefix, delegationRef, headRef, runRef } from "../../src/kernel/names.ts";
import { pending, submit } from "../../src/kernel/queue.ts";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import type { SessionEvent } from "../../src/kernel/sdk/types.ts";
import type { StreamFn } from "../../src/kernel/loop/types.ts";
import { toolResultText } from "../../src/kernel/loop/tool-result.ts";
import { step } from "../../src/kernel/step.ts";
import type { Refs, Session, Store } from "../../src/kernel/store.ts";
import type { RespondOutcome, ToolBatchOutcome, Turn } from "../../src/kernel/turn.ts";
import { definePlugin, inlinePlugin } from "../../src/plugins/index.ts";
import {
  assistant,
  call,
  granted,
  drain,
  message,
  only,
  openSession,
  openStore,
  storePath,
  user,
  within,
} from "./helpers.ts";

const model: Model<Api> = {
  id: "test-model",
  name: "Script",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};
const MODEL = `${model.provider}/${model.id}`;
const poll = { timeout: 5_000, interval: 10 };

type RefUpdateHook = (input: {
  readonly session: Session;
  readonly updates: Parameters<Refs["update"]>[0];
  readonly options: Parameters<Refs["update"]>[1];
  readonly proceed: () => ReturnType<Refs["update"]>;
}) => ReturnType<Refs["update"]>;

function hookedStore(store: Store, hook: RefUpdateHook): Store {
  const wrap = (session: Session): Session => ({
    id: session.id,
    objects: session.objects,
    leases: session.leases,
    events: session.events,
    refs: {
      read: (name) => session.refs.read(name),
      list: (prefix) => session.refs.list(prefix),
      update: (updates, options) =>
        hook({
          session,
          updates,
          options,
          proceed: () => session.refs.update(updates, options),
        }),
    },
    close: () => session.close(),
  });
  return {
    create: async (options) => wrap(await store.create(options)),
    open: async (id) => wrap(await store.open(id)),
    list: () => store.list(),
    delete: (id) => store.delete(id),
    close: () => store.close(),
  };
}

/**
 * One script for every session. A user message `do <tool> <json>` makes the
 * parent call that tool; a session holding a tool result repeats it; anything
 * else is answered as `answer: <text>`, held while its gate is closed.
 */
async function fixture(hook: RefUpdateHook = ({ proceed }) => proceed()) {
  const path = storePath();
  const cwd = dirname(path);
  const gates = new Map<string, PromiseWithResolvers<void>>();
  const requests: { text: string; tools: readonly string[]; completions: string[] }[] = [];
  const streamFn: StreamFn = (_model, context, options) => {
    const messages = context.messages;
    const isCompletion = (message: (typeof messages)[number]) =>
      message.role === "user" &&
      typeof message.content === "string" &&
      message.content.startsWith("Background ");
    const tail = messages.slice(
      messages.findLastIndex((message) => message.role === "user" && !isCompletion(message)),
    );
    const user = tail[0];
    const text = user?.role === "user" ? contentText(user.content) : "";
    requests.push({
      text,
      tools: (context.tools ?? []).map((tool) => tool.name),
      completions: messages.filter(isCompletion).map((message) => contentText(message.content)),
    });
    const result = tail.findLast((message) => message.role === "toolResult");
    const command = /^do (\S+) (.*)$/su.exec(text);
    const answer =
      result?.role === "toolResult"
        ? assistant(`got: ${toolResultText(result.content)}`)
        : command !== null
          ? assistant("", {
              calls: [call("call", command[1] ?? "", JSON.parse(command[2] ?? "{}"))],
            })
          : assistant(`answer: ${text}`);
    const stream = createAssistantMessageEventStream();
    const signal = options?.signal;
    const aborted = Promise.withResolvers<void>();
    const onAbort = () => aborted.resolve();
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    void Promise.race([gates.get(text)?.promise ?? Promise.resolve(), aborted.promise]).then(() => {
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) {
        stream.push({
          type: "error",
          reason: "aborted",
          error: { ...answer, stopReason: "aborted", content: [] },
        });
        return;
      }
      stream.push({
        type: "done",
        reason: answer.stopReason === "toolUse" ? "toolUse" : "stop",
        message: answer,
      });
    });
    return stream;
  };
  const store = openStore(path);
  const nyte = await createNyte({
    store: hookedStore(store, hook),
    streamFn,
    model,
    models: {
      getModels: () => [model],
      getModel: () => model,
      getAvailable: async () => [model],
    },
    plugins: [
      inlinePlugin(
        definePlugin({
          id: "delegation-test-tools",
          session(api) {
            api.tools.add((draft) => {
              // Foreground availability, not the tool's name, keeps a tool from a child.
              draft.set("clarify", {
                name: "clarify",
                availability: "foreground",
                description: "Ask the user",
                parameters: Type.Object({}),
                execute: async () => ({ content: [{ type: "text", text: "answer" }], details: {} }),
              });
            });
          },
        }),
      ),
    ],
    env: { cwd },
  });
  const { sessionId: parent } = await nyte.sessions.create();
  nyte.attach();
  const events: SessionEvent[] = [];
  const watching = new AbortController();
  const watch = (async () => {
    for await (const event of nyte.watch({ sessionId: parent, signal: watching.signal }))
      events.push(event);
  })();
  const reader = openStore(path);
  const idle = async (id: SessionId) => {
    await expect
      .poll(async () => (await within(nyte.runs.wait({ sessionId: id }), 5_000)).kind, poll)
      .toBe("idle");
  };
  return {
    nyte,
    parent,
    requests,
    events,
    idle,
    hold(text: string) {
      const gate = Promise.withResolvers<void>();
      gates.set(text, gate);
      return () => gate.resolve();
    },
    /** Send a command to the parent and wait for its run to settle. */
    async command(tool: string, args: object) {
      await nyte.messages.send({
        sessionId: parent,
        content: `do ${tool} ${JSON.stringify(args)}`,
      });
      await idle(parent);
      const turns = await nyte.messages.list({ sessionId: parent });
      const parts = turns.flatMap((turn) => (turn.kind === "turn" ? turn.parts : []));
      const part = parts.findLast((item) => item.kind === "tool");
      assert.ok(part?.kind === "tool");
      const said = parts.findLast((item) => item.kind === "assistant");
      assert.ok(said?.kind === "assistant");
      return { part, said: said.text };
    },
    async child() {
      const children = await nyte.sessions.list({ parent });
      return only(children.items);
    },
    async childCommits(id: SessionId) {
      const session = await reader.open(id);
      return branch(session.objects, await session.refs.read(headRef("main")));
    },
    async queuedCompletions() {
      const session = await reader.open(parent);
      return (await pending(session, "main")).flatMap((item) =>
        item.change.body.kind === "completion" && item.change.body.job.kind === "delegate"
          ? [item.change.body.job]
          : [],
      );
    },
    async rewindDeliveryMark(child: SessionId, request: DelegateRequest) {
      const session = await reader.open(parent);
      const prefix = delegationPrefix(child);
      const records = await Promise.all(
        (await session.refs.list(prefix)).map((ref) => readDelegation(session, ref, prefix)),
      );
      const stored = only(
        records.filter(
          (candidate) =>
            candidate.record.answer.kind === "ready" &&
            candidate.record.answer.request.kind === request.kind &&
            candidate.record.answer.request.oid === request.oid,
        ),
      );
      assert.equal(stored.record.delivery.kind, "delivered");
      const record: DelegationRecord = {
        ...stored.record,
        delivery: { kind: "owed" },
      };
      const oid = await putDelegationRecord(session, record);
      const outcome = await session.refs.update([{ name: stored.ref, from: stored.oid, to: oid }], {
        reason: "simulate crash before delivery mark",
      });
      assert.equal(outcome.ok, true);
      return stored;
    },
    async trimChild(id: SessionId) {
      const session = await reader.open(id);
      await trimStream(session, { keepAfterSeq: await session.events.last() });
    },
    /** Every child completion the parent has, landed or still queued. */
    async completions() {
      const session = await reader.open(parent);
      const landed = (
        await branch(session.objects, await session.refs.read(headRef("main")))
      ).flatMap((item) =>
        item.commit.body.kind === "completion" && item.commit.body.job.kind === "delegate"
          ? [item.commit.body.job]
          : [],
      );
      return [...landed, ...(await this.queuedCompletions())];
    },
    async close() {
      watching.abort();
      for (const gate of gates.values()) gate.resolve();
      try {
        await nyte.close();
      } finally {
        await watch;
      }
    },
  };
}

class ResponseScript implements Turn {
  readonly answers: RespondOutcome[];
  calls = 0;

  constructor(answers: readonly RespondOutcome[]) {
    this.answers = [...answers];
  }

  async respond(): Promise<RespondOutcome> {
    const answer = this.answers.shift();
    if (answer === undefined) assert.fail("respond was called without a scripted answer");
    this.calls += 1;
    return answer;
  }

  async tools(): Promise<ToolBatchOutcome> {
    return assert.fail("tools was called in a response-only script");
  }
}

function completed(text: string): RespondOutcome {
  return { kind: "complete", message: assistant(text) };
}

function failed(reason: string): RespondOutcome {
  return {
    kind: "failed",
    message: assistant(reason, { stop: "error", error: reason }),
    failure: { class: "runner", message: reason },
  };
}

async function storedRunAt(session: Session, head: string): Promise<Run | undefined> {
  const oid = await session.refs.read(runRef(head));
  if (oid === null) return undefined;
  const object = await session.objects.get(oid);
  return object?.kind === "run" ? object : undefined;
}

function storedRun(session: Session): Promise<Run | undefined> {
  return storedRunAt(session, "main");
}

async function writeDelegation(input: {
  readonly session: Session;
  readonly child: SessionId;
  readonly change: string;
  readonly request: DelegateRequest;
  readonly runId: string;
  readonly head: string;
  readonly continuation: DelegationRecord["continuation"];
}): Promise<void> {
  const record: DelegationRecord = {
    runId: input.runId,
    callId: `call-${input.change}`,
    head: input.head,
    at: Date.now(),
    continuation: input.continuation,
    delivery: { kind: "delivered", change: `completion-${input.change}` },
    answer: { kind: "ready", request: input.request, source: { kind: "cancelled" } },
  };
  const oid = await putDelegationRecord(input.session, record);
  const outcome = await input.session.refs.update(
    [{ name: delegationRef(input.child, input.change), from: null, to: oid }],
    { reason: "test delegation" },
  );
  assert.equal(outcome.ok, true);
}

function delegateReport(child: SessionId, request: DelegateRequest): JobReport {
  return {
    kind: "delegate",
    session: child,
    title: child,
    request,
    end: { kind: "completed" },
    report: { kind: "none" },
  };
}

async function queueDelegate(
  session: Session,
  child: SessionId,
  request: DelegateRequest,
  head: string,
): Promise<void> {
  await submit(session, {
    preparation: { kind: "none" },
    head,
    delivery: "steer",
    kind: "answer",
    body: { kind: "completion", job: delegateReport(child, request) },
  });
}

test("create makes a persistent child session the parent names; it is not a job", async () => {
  const f = await fixture();
  try {
    const { part, said } = await f.command("create", { title: "helper", model: MODEL });
    const child = await f.child();
    const run = await f.nyte.runs.current({ sessionId: f.parent });
    expect(child.parent).toEqual({
      sessionId: f.parent,
      runId: run?.runId,
      callId: "call",
      depth: 1,
    });
    expect(child.name).toBe("helper");
    expect(child.config.model).toEqual({ provider: model.provider, id: model.id });
    expect(child.heads[0]?.run).toBeUndefined();
    expect(part.class).toEqual({
      kind: "delegate",
      role: "create",
      target: { kind: "one", session: child.sessionId },
    });
    expect(said).toContain(`Created agent helper as ${child.sessionId}`);
    expect(await f.nyte.jobs.list({ sessionId: f.parent })).toEqual([]);
    expect(f.requests[0]?.tools).toEqual(
      expect.arrayContaining(["task", "create", "send", "await", "read", "stop", "clarify"]),
    );
  } finally {
    await f.close();
  }
});

test("a delegate answer continues the run that authorized its request", async () => {
  const f = await fixture();
  try {
    await f.command("create", { title: "helper", model: MODEL });
    const child = await f.child();
    const release = f.hold("first question");
    const sent = await f.command("send", { agent: child.sessionId, message: "first question" });
    expect(sent.part.class).toEqual({
      kind: "delegate",
      role: "send",
      target: { kind: "one", session: child.sessionId },
    });
    const parentRun = await f.nyte.runs.current({ sessionId: f.parent });
    assert.ok(parentRun);
    await expect
      .poll(
        async () => (await f.nyte.runs.current({ sessionId: child.sessionId }))?.phase.kind,
        poll,
      )
      .toBe("respond");

    release();
    await f.idle(child.sessionId);
    await expect
      .poll(async () => (await f.nyte.runs.current({ sessionId: f.parent }))?.origin.kind, poll)
      .toBe("continuation");
    await f.idle(f.parent);

    const commits = await f.childCommits(child.sessionId);
    const request = commits.find(
      (item) =>
        item.commit.body.kind === "message" &&
        item.commit.body.message.role === "user" &&
        contentText(item.commit.body.message.content) === "first question",
    );
    const answer = commits.findLast(
      (item) =>
        item.commit.body.kind === "message" && item.commit.body.message.role === "assistant",
    );
    assert.ok(request && answer);
    expect(request.commit.author).toEqual({ clientId: f.parent, device: "delegate" });
    const completion = only(await f.completions());
    expect(completion).toEqual({
      kind: "delegate",
      session: child.sessionId,
      title: "helper",
      request: { kind: "commit", oid: request.oid },
      end: { kind: "completed" },
      report: { kind: "text", text: "answer: first question", commit: answer.oid },
    });
    const continued = await f.nyte.runs.current({ sessionId: f.parent });
    expect(continued).toMatchObject({
      origin: {
        kind: "continuation",
        session: child.sessionId,
        request: { kind: "commit", oid: request.oid },
      },
      root: parentRun.root,
      phase: { kind: "done" },
    });
    const heard = only(f.requests.filter((item) => item.completions.length > 0));
    expect(heard.completions).toEqual([
      `Background agent helper (${child.sessionId}) finished. Its report:\n\nanswer: first question`,
    ]);
    expect(await f.queuedCompletions()).toEqual([]);

    await f.command("send", { agent: child.sessionId, message: "second question" });
    await f.idle(child.sessionId);
    await expect.poll(() => f.completions(), poll).toHaveLength(2);
    expect(
      new Set((await f.completions()).map((item) => `${item.request.kind}:${item.request.oid}`))
        .size,
    ).toBe(2);
    const childTurns = await f.nyte.messages.list({ sessionId: child.sessionId });
    expect(
      childTurns.flatMap((turn) =>
        turn.kind === "turn" ? turn.parts.filter((part) => part.kind === "user") : [],
      ),
    ).toHaveLength(2);
  } finally {
    await f.close();
  }
});

test("an abort that wins the parent-run assertion prevents the child submission", async () => {
  const assertionEntered = Promise.withResolvers<void>();
  const releaseAssertion = Promise.withResolvers<void>();
  let blockAuthorization = false;
  const f = await fixture(async ({ updates, proceed }) => {
    if (
      blockAuthorization &&
      updates.some((update) => update.name.startsWith("refs/delegations/")) &&
      updates.some((update) => update.name === runRef("main") && update.from === update.to)
    ) {
      assertionEntered.resolve();
      await releaseAssertion.promise;
    }
    return proceed();
  });
  try {
    await f.command("create", { title: "helper", model: MODEL });
    const child = await f.child();
    blockAuthorization = true;
    await f.nyte.messages.send({
      sessionId: f.parent,
      content: `do send ${JSON.stringify({ agent: child.sessionId, message: "too late" })}`,
    });
    await within(assertionEntered.promise);
    expect((await f.nyte.runs.abort({ sessionId: f.parent })).kind).toBe("requested");
    releaseAssertion.resolve();
    await f.idle(f.parent);

    expect(await f.nyte.messages.list({ sessionId: child.sessionId })).toEqual([]);
    expect(await f.completions()).toEqual([]);
    expect((await f.nyte.runs.current({ sessionId: f.parent }))?.phase.kind).toBe("aborted");
  } finally {
    releaseAssertion.resolve();
    await f.close();
  }
});

test("a failed child publication abandons its prepared delegation request", async () => {
  const failPublications = new Set<string>();
  const f = await fixture(async ({ session, updates, proceed }) => {
    if (
      failPublications.has(session.id) &&
      updates.some(
        (update) => update.name.startsWith("refs/inbox/main/") && update.name.endsWith("/tip"),
      )
    ) {
      failPublications.delete(session.id);
      throw new Error("crash before child publication");
    }
    return proceed();
  });
  try {
    await f.command("create", { title: "helper", model: MODEL });
    const child = await f.child();
    failPublications.add(child.sessionId);
    const sent = await f.command("send", {
      agent: child.sessionId,
      message: "orphaned request",
    });
    expect(sent.part.result?.isError).toBe(true);
    expect(await f.nyte.messages.list({ sessionId: child.sessionId })).toEqual([]);

    await f.command("stop", { agent: child.sessionId });
    expect(await f.completions()).toEqual([]);
  } finally {
    await f.close();
  }
});

test("reconcile delivers once after a crash between completion submit and delivery mark", async () => {
  const f = await fixture();
  try {
    await f.command("create", { title: "helper", model: MODEL });
    const child = await f.child();
    await f.command("send", { agent: child.sessionId, message: "crash window" });
    await f.idle(child.sessionId);
    await f.idle(f.parent);
    const first = only(await f.completions());
    await f.rewindDeliveryMark(child.sessionId, first.request);

    await f.nyte.sessions.configure({
      sessionId: child.sessionId,
      thinkingLevel: "off",
    });
    expect(await f.completions()).toEqual([first]);
  } finally {
    await f.close();
  }
});

test("delivery reads the retained terminal run after the child event stream is trimmed", async () => {
  const deliveryParents = new Set<string>();
  let failDelivery = false;
  const f = await fixture(async ({ session, updates, proceed }) => {
    if (
      failDelivery &&
      deliveryParents.has(session.id) &&
      updates.some(
        (update) =>
          update.name.startsWith("refs/inbox/main/steer/") && update.name.endsWith("/tip"),
      )
    ) {
      failDelivery = false;
      throw new Error("crash before completion publication");
    }
    return proceed();
  });
  deliveryParents.add(f.parent);
  try {
    await f.command("create", { title: "helper", model: MODEL });
    const child = await f.child();
    const release = f.hold("trimmed answer");
    await f.command("send", { agent: child.sessionId, message: "trimmed answer" });
    failDelivery = true;
    release();
    await f.idle(child.sessionId);
    expect(await f.completions()).toEqual([]);
    await f.trimChild(child.sessionId);

    await f.nyte.sessions.configure({
      sessionId: child.sessionId,
      thinkingLevel: "off",
    });
    await expect
      .poll(() => f.completions(), poll)
      .toEqual([
        expect.objectContaining({
          session: child.sessionId,
          end: { kind: "completed" },
        }),
      ]);
  } finally {
    await f.close();
  }
});

test("a participant's message to a child does not authorize a continuation", async () => {
  const f = await fixture();
  try {
    await f.command("create", { title: "helper", model: MODEL });
    const child = await f.child();
    const parentBefore = await f.nyte.runs.current({ sessionId: f.parent });
    const release = f.hold("participant question");
    await f.nyte.messages.send({
      sessionId: child.sessionId,
      content: "participant question",
    });
    await expect
      .poll(
        async () => (await f.nyte.runs.current({ sessionId: child.sessionId }))?.phase.kind,
        poll,
      )
      .toBe("respond");
    release();
    await f.idle(child.sessionId);
    await expect.poll(() => f.queuedCompletions(), poll).toHaveLength(1);
    const unchanged = await f.nyte.runs.current({ sessionId: f.parent });
    expect(unchanged?.runId).toBe(parentBefore?.runId);
    expect(unchanged?.origin.kind).toBe("user");

    await f.nyte.messages.send({ sessionId: f.parent, content: "continue with the report" });
    await f.idle(f.parent);
    expect((await f.nyte.runs.current({ sessionId: f.parent }))?.origin.kind).toBe("user");
  } finally {
    await f.close();
  }
});

test("a keyed participant receipt loss abandons the unpublished child request", async () => {
  const blockedChildren = new Set<string>();
  const updateEntered = Promise.withResolvers<void>();
  const releaseUpdate = Promise.withResolvers<void>();
  const f = await fixture(async ({ session, updates, proceed }) => {
    if (
      blockedChildren.has(session.id) &&
      updates.some(
        (update) => update.name.startsWith("refs/inbox/main/") && update.name.endsWith("/tip"),
      )
    ) {
      blockedChildren.delete(session.id);
      updateEntered.resolve();
      await releaseUpdate.promise;
    }
    return proceed();
  });
  try {
    await f.command("create", { title: "helper", model: MODEL });
    const child = await f.child();
    blockedChildren.add(child.sessionId);
    const losing = f.nyte.messages.send({
      sessionId: child.sessionId,
      content: "losing request",
      key: "same-request",
    });
    await within(updateEntered.promise);
    const winner = await f.nyte.messages.send({
      sessionId: child.sessionId,
      content: "winning request",
      key: "same-request",
    });
    releaseUpdate.resolve();
    const lost = await losing;
    expect(new Set([winner.change, lost.change]).size).toBe(1);
    await f.idle(child.sessionId);

    const read = await f.command("read", { agent: child.sessionId, turns: 10 });
    expect(read.said).toContain("User: winning request");
    expect(read.said).not.toContain("losing request");
    const beforeStop = await f.completions();
    expect(beforeStop).toHaveLength(1);
    await f.command("stop", { agent: child.sessionId });
    expect(await f.completions()).toEqual(beforeStop);
  } finally {
    releaseUpdate.resolve();
    await f.close();
  }
});

test("await returns phases at its deadline without settling the child, and the report once the child has answered", async () => {
  const f = await fixture();
  try {
    await f.command("create", { title: "helper", model: MODEL });
    const child = await f.child();
    const release = f.hold("slow question");
    await f.command("send", { agent: child.sessionId, message: "slow question" });
    const timedOut = await f.command("await", {
      agents: [child.sessionId],
      mode: "all",
      timeoutMs: 300,
    });
    expect(timedOut.part.class).toEqual({
      kind: "delegate",
      role: "await",
      target: { kind: "many", sessions: [child.sessionId], mode: "all" },
    });
    expect(timedOut.part.result?.isError).toBe(false);
    expect(timedOut.said).toContain(`Agent helper (${child.sessionId}) is respond; no report yet.`);
    expect(timedOut.said).toContain("reached its timeout");
    expect(
      f.events.some(
        (event) => event.kind === "effect" && event.tool === "await" && event.state === "waiting",
      ),
    ).toBe(true);
    const running = await f.nyte.runs.current({ sessionId: child.sessionId });
    assert.ok(running && !isTerminalPhase(running.phase));

    release();
    await f.idle(child.sessionId);
    const reported = await f.command("await", {
      agents: [child.sessionId],
      mode: "any",
      timeoutMs: 5_000,
    });
    expect(reported.said).toContain(
      `Background agent helper (${child.sessionId}) finished. Its report:\n\nanswer: slow question`,
    );
    expect(reported.said).not.toContain("timeout");
  } finally {
    await f.close();
  }
});

test("await classifies every target and its mode", async () => {
  const f = await fixture();
  try {
    await f.command("create", { title: "first", model: MODEL });
    const first = await f.child();
    await f.command("create", { title: "second", model: MODEL });
    const children = await f.nyte.sessions.list({ parent: f.parent });
    const second = children.items.find((item) => item.sessionId !== first.sessionId);
    assert.ok(second);
    const awaited = await f.command("await", {
      agents: [first.sessionId, second.sessionId],
      mode: "any",
      timeoutMs: 0,
    });
    expect(awaited.part.class).toEqual({
      kind: "delegate",
      role: "await",
      target: {
        kind: "many",
        sessions: [first.sessionId, second.sessionId],
        mode: "any",
      },
    });
  } finally {
    await f.close();
  }
});

test("a parked await wakes when the child answers", async () => {
  const f = await fixture();
  try {
    const release = f.hold("prompt");
    await f.nyte.messages.send({
      sessionId: f.parent,
      content: `do task ${JSON.stringify({ prompt: "prompt", title: "worker", model: MODEL, waitMs: 60_000 })}`,
    });
    expect((await within(f.nyte.runs.wait({ sessionId: f.parent }), 5_000)).kind).toBe("waiting");
    const child = await f.child();
    expect(child.name).toBe("worker");
    release();
    await f.idle(f.parent);
    const parts = (await f.nyte.messages.list({ sessionId: f.parent })).flatMap((turn) =>
      turn.kind === "turn" ? turn.parts : [],
    );
    expect(parts.find((part) => part.kind === "tool")).toMatchObject({
      class: {
        kind: "delegate",
        role: "create",
        target: { kind: "one", session: child.sessionId },
      },
      result: { isError: false, output: expect.stringContaining("answer: prompt") },
    });
  } finally {
    await f.close();
  }
});

test("aborting the parent revokes its child's continuation", async () => {
  const f = await fixture();
  try {
    const release = f.hold("prompt");
    await f.nyte.messages.send({
      sessionId: f.parent,
      content: `do task ${JSON.stringify({ prompt: "prompt", title: "worker", model: MODEL, waitMs: 60_000 })}`,
    });
    expect((await within(f.nyte.runs.wait({ sessionId: f.parent }), 5_000)).kind).toBe("waiting");
    const child = await f.child();
    expect((await f.nyte.runs.abort({ sessionId: f.parent })).kind).toBe("requested");
    await f.idle(f.parent);
    const parts = (await f.nyte.messages.list({ sessionId: f.parent })).flatMap((turn) =>
      turn.kind === "turn" ? turn.parts.filter((part) => part.kind === "tool") : [],
    );
    expect(parts.at(-1)).toMatchObject({
      class: {
        kind: "delegate",
        role: "create",
        target: { kind: "one", session: child.sessionId },
      },
      result: { isError: true, output: expect.stringContaining("cancelled") },
    });
    const running = await f.nyte.runs.current({ sessionId: child.sessionId });
    assert.ok(running && !isTerminalPhase(running.phase));

    release();
    await f.idle(child.sessionId);
    await expect.poll(() => f.queuedCompletions(), poll).toHaveLength(1);
    expect((await f.nyte.runs.current({ sessionId: f.parent }))?.phase.kind).toBe("aborted");
    await f.nyte.messages.send({ sessionId: f.parent, content: "use the finished report" });
    await f.idle(f.parent);
    expect((await f.nyte.runs.current({ sessionId: f.parent }))?.origin.kind).toBe("user");
  } finally {
    await f.close();
  }
});

test("aborting the parent cancels its parked await and leaves the child running; stop ends the child", async () => {
  const f = await fixture();
  try {
    await f.command("create", { title: "helper", model: MODEL });
    const child = await f.child();
    f.hold("long question");
    await f.command("send", { agent: child.sessionId, message: "long question" });
    await f.nyte.messages.send({
      sessionId: f.parent,
      content: `do await ${JSON.stringify({ agents: [child.sessionId], mode: "all", timeoutMs: 60_000 })}`,
    });
    expect((await within(f.nyte.runs.wait({ sessionId: f.parent }), 5_000)).kind).toBe("waiting");
    expect((await f.nyte.runs.abort({ sessionId: f.parent })).kind).toBe("requested");
    await f.idle(f.parent);
    expect((await f.nyte.runs.current({ sessionId: f.parent }))?.phase).toEqual({
      kind: "aborted",
    });
    const parts = (await f.nyte.messages.list({ sessionId: f.parent })).flatMap((turn) =>
      turn.kind === "turn" ? turn.parts.filter((part) => part.kind === "tool") : [],
    );
    // A failed call keeps its call-time class.
    expect(parts.at(-1)).toMatchObject({
      class: {
        kind: "delegate",
        role: "await",
        target: { kind: "many", sessions: [child.sessionId], mode: "all" },
      },
      result: { isError: true, output: expect.stringContaining("cancelled") },
    });
    const running = await f.nyte.runs.current({ sessionId: child.sessionId });
    assert.ok(running && !isTerminalPhase(running.phase));
    expect(await f.queuedCompletions()).toEqual([]);

    const stopped = await f.command("stop", { agent: child.sessionId });
    expect(stopped.part.class).toEqual({
      kind: "delegate",
      role: "stop",
      target: { kind: "one", session: child.sessionId },
    });
    await expect
      .poll(
        async () => (await f.nyte.runs.current({ sessionId: child.sessionId }))?.phase.kind,
        poll,
      )
      .toBe("aborted");
    await expect
      .poll(() => f.completions(), poll)
      .toEqual([expect.objectContaining({ session: child.sessionId, end: { kind: "cancelled" } })]);
    const refused = await f.command("send", { agent: child.sessionId, message: "again" });
    expect(refused.part.result?.isError).toBe(true);
    expect(refused.said).toContain("was stopped");
    expect((await f.child()).sessionId).toBe(child.sessionId);
  } finally {
    await f.close();
  }
});

test("read answers with the child's latest turns and phase without parking", async () => {
  const f = await fixture();
  try {
    await f.command("create", { title: "helper", model: MODEL });
    const child = await f.child();
    await f.command("send", { agent: child.sessionId, message: "what is up" });
    await f.idle(child.sessionId);
    const read = await f.command("read", { agent: child.sessionId, turns: 1 });
    expect(read.part.class).toEqual({
      kind: "delegate",
      role: "read",
      target: { kind: "one", session: child.sessionId },
    });
    expect(read.said).toContain(`Agent helper (${child.sessionId}) is done.`);
    expect(read.said).toContain("User: what is up");
    expect(read.said).toContain("Assistant: answer: what is up");
    expect(
      f.events.some(
        (event) => event.kind === "effect" && event.tool === "read" && event.state === "waiting",
      ),
    ).toBe(false);
    const unknown = await f.command("read", { agent: "s_nobody" });
    expect(unknown.part.result?.isError).toBe(true);
    expect(unknown.said).toContain("No agent s_nobody belongs to this session");
  } finally {
    await f.close();
  }
});

test("a task whose child outlasts waitMs continues when its report arrives", async () => {
  const f = await fixture();
  try {
    const release = f.hold("Investigate the build\nin detail");
    const { part, said } = await f.command("task", {
      prompt: "Investigate the build\nin detail",
      model: MODEL,
      waitMs: 200,
    });
    const child = await f.child();
    expect(child.name).toBe("Investigate the build");
    expect(part.class).toEqual({
      kind: "delegate",
      role: "create",
      target: { kind: "one", session: child.sessionId },
    });
    expect(said).toContain(`Agent Investigate the build (${child.sessionId}) is respond`);
    release();
    await f.idle(child.sessionId);
    await expect
      .poll(() => f.completions(), poll)
      .toEqual([
        expect.objectContaining({
          session: child.sessionId,
          end: { kind: "completed" },
          report: expect.objectContaining({
            kind: "text",
            text: "answer: Investigate the build\nin detail",
          }),
        }),
      ]);
    await f.idle(f.parent);
    expect((await f.nyte.runs.current({ sessionId: f.parent }))?.origin).toMatchObject({
      kind: "continuation",
      session: child.sessionId,
    });
  } finally {
    await f.close();
  }
});

test("a failed parent revokes its outstanding continuation before the child answers", async () => {
  const session = await openSession("failed-parent");
  const script = new ResponseScript([failed("parent failed")]);
  await submit(session, {
    preparation: { kind: "none" },
    head: "main",
    delivery: "steer",
    kind: "user",
    body: message(user("start")),
  });
  expect((await step(session, script, { head: "main", drain })).kind).toBe("continue");
  const parent = await storedRun(session);
  assert.ok(parent);
  const child = sessionId("failed-child");
  const request = { kind: "commit", oid: "failed-request" } satisfies DelegateRequest;
  await writeDelegation({
    session,
    child,
    change: "failed-change",
    request,
    runId: parent.id,
    head: "main",
    continuation: { kind: "authorized", root: parent.root },
  });

  expect((await step(session, script, { head: "main", drain })).kind).toBe("finished");
  expect((await storedRun(session))?.phase.kind).toBe("failed");

  await queueDelegate(session, child, request, "main");
  expect((await step(session, new ResponseScript([]), { head: "main", drain })).kind).toBe("idle");
  expect((await storedRun(session))?.id).toBe(parent.id);

  await submit(session, {
    preparation: { kind: "none" },
    head: "main",
    delivery: "next",
    kind: "user",
    body: message(user("continue")),
  });
  expect((await step(session, new ResponseScript([]), { head: "main", drain })).kind).toBe(
    "continue",
  );
  expect((await storedRun(session))?.origin.kind).toBe("user");
});

test("command and unauthorized delegate completions never start an idle run", async () => {
  const commandSession = await openSession("command-completion");
  await submit(commandSession, {
    preparation: { kind: "none" },
    head: "main",
    delivery: "steer",
    kind: "report",
    body: {
      kind: "completion",
      job: {
        kind: "command",
        id: "command",
        command: "true",
        end: { kind: "completed" },
        output: "",
      },
    },
  });
  expect((await step(commandSession, new ResponseScript([]), { head: "main", drain })).kind).toBe(
    "idle",
  );
  expect(await storedRun(commandSession)).toBeUndefined();

  for (const kind of ["input", "consumed"] as const) {
    const session = await openSession(`delegate-${kind}`);
    const child = sessionId(`child-${kind}`);
    const request = { kind: "commit", oid: `request-${kind}` } satisfies DelegateRequest;
    await writeDelegation({
      session,
      child,
      change: `change-${kind}`,
      request,
      runId: "ended-parent",
      head: "main",
      continuation: { kind },
    });
    await queueDelegate(session, child, request, "main");
    expect((await step(session, new ResponseScript([]), { head: "main", drain })).kind).toBe(
      "idle",
    );
    expect(await storedRun(session)).toBeUndefined();
  }

  const missingSession = await openSession("delegate-missing");
  const missingChild = sessionId("child-missing");
  const missingRequest = {
    kind: "commit",
    oid: "request-missing",
  } satisfies DelegateRequest;
  await queueDelegate(missingSession, missingChild, missingRequest, "main");
  expect((await step(missingSession, new ResponseScript([]), { head: "main", drain })).kind).toBe(
    "idle",
  );
  expect(await storedRun(missingSession)).toBeUndefined();
});

test("one chain budget covers two outstanding children and user input starts a fresh root", async () => {
  const session = await openSession("chain-budget");
  const script = new ResponseScript([
    completed("parent"),
    completed("first continuation"),
    completed("fresh user root"),
  ]);
  await submit(session, {
    preparation: { kind: "none" },
    head: "main",
    delivery: "steer",
    kind: "user",
    body: message(user("start")),
  });
  await step(session, script, { head: "main", drain, steps: 2 });
  const parent = await storedRun(session);
  assert.ok(parent);
  const firstChild = sessionId("first-child");
  const secondChild = sessionId("second-child");
  const firstRequest = { kind: "commit", oid: "first-request" } satisfies DelegateRequest;
  const secondRequest = { kind: "commit", oid: "second-request" } satisfies DelegateRequest;
  await writeDelegation({
    session,
    child: firstChild,
    change: "first-change",
    request: firstRequest,
    runId: parent.id,
    head: "main",
    continuation: { kind: "authorized", root: parent.root },
  });
  await writeDelegation({
    session,
    child: secondChild,
    change: "second-change",
    request: secondRequest,
    runId: parent.id,
    head: "main",
    continuation: { kind: "authorized", root: parent.root },
  });
  await step(session, script, { head: "main", drain, steps: 2 });
  expect((await storedRun(session))?.phase.kind).toBe("done");

  await queueDelegate(session, firstChild, firstRequest, "main");
  await step(session, script, { head: "main", drain, steps: 2 });
  const firstContinuation = await storedRun(session);
  assert.ok(firstContinuation);
  expect(firstContinuation).toMatchObject({
    origin: { kind: "continuation", session: firstChild, request: firstRequest },
    root: parent.root,
    phase: { kind: "respond" },
  });
  await step(session, script, { head: "main", drain, steps: 2 });
  expect((await storedRun(session))?.phase.kind).toBe("done");

  await queueDelegate(session, secondChild, secondRequest, "main");
  await step(session, script, { head: "main", drain, steps: 2 });
  const secondContinuation = await storedRun(session);
  assert.ok(secondContinuation);
  expect(secondContinuation).toMatchObject({
    origin: { kind: "continuation", session: secondChild, request: secondRequest },
    root: parent.root,
    phase: { kind: "respond" },
  });
  await step(session, script, { head: "main", drain, steps: 2 });
  expect((await storedRun(session))?.phase.kind).toBe("failed");
  expect(script.calls).toBe(2);

  await submit(session, {
    preparation: { kind: "none" },
    head: "main",
    delivery: "steer",
    kind: "user",
    body: message(user("fresh")),
  });
  await step(session, script, { head: "main", drain, steps: 2 });
  const fresh = await storedRun(session);
  assert.ok(fresh);
  expect(fresh.origin).toEqual({ kind: "user" });
  expect(fresh.root).toBe(fresh.id);
  expect(fresh.root).not.toBe(parent.root);
  await step(session, script, { head: "main", drain, steps: 2 });
  expect((await storedRun(session))?.phase.kind).toBe("done");
  expect(script.calls).toBe(3);
});

test("two steps racing one authorization publish one continuation", async () => {
  const session = await openSession("continuation-race");
  const parentScript = new ResponseScript([completed("parent")]);
  await submit(session, {
    preparation: { kind: "none" },
    head: "main",
    delivery: "steer",
    kind: "user",
    body: message(user("start")),
  });
  await step(session, parentScript, { head: "main", drain });
  const parent = await storedRun(session);
  assert.ok(parent);
  await step(session, parentScript, { head: "main", drain });
  const child = sessionId("race-child");
  const request = { kind: "commit", oid: "race-request" } satisfies DelegateRequest;
  await writeDelegation({
    session,
    child,
    change: "race-change",
    request,
    runId: parent.id,
    head: "main",
    continuation: { kind: "authorized", root: parent.root },
  });
  await queueDelegate(session, child, request, "main");

  const lease = granted(await session.leases.acquire(headRef("main"), 30_000));
  const gate = Promise.withResolvers<void>();
  let arrived = 0;
  const beforeStep = async (): Promise<void> => {
    arrived += 1;
    if (arrived === 2) gate.resolve();
    await gate.promise;
  };
  try {
    await Promise.all([
      step(session, new ResponseScript([completed("continued")]), {
        head: "main",
        drain,
        lease,
        beforeStep,
      }),
      step(session, new ResponseScript([completed("continued")]), {
        head: "main",
        drain,
        lease,
        beforeStep,
      }),
    ]);
  } finally {
    await session.leases.release(lease);
  }

  const continuationIds = new Set<string>();
  for (const event of await session.events.read({ afterSeq: 0 })) {
    if (event.kind !== "ref" || event.name !== runRef("main") || event.to === null) continue;
    const object = await session.objects.get(event.to);
    if (object?.kind === "run" && object.origin.kind === "continuation") {
      continuationIds.add(object.id);
    }
  }
  expect(continuationIds.size).toBe(1);
  const current = await storedRun(session);
  expect(current).toMatchObject({
    origin: { kind: "continuation", session: child, request },
    root: parent.root,
  });
  const commits = await branch(session.objects, await session.refs.read(headRef("main")));
  expect(
    commits.filter(
      (item) => item.commit.body.kind === "completion" && item.commit.body.job.kind === "delegate",
    ),
  ).toHaveLength(1);
});
