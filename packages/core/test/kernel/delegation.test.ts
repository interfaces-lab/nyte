/**
 * Children as persistent sessions: the parent creates one, sends it work,
 * waits with a deadline, reads it, and stops it; each answered request lands
 * on the parent as one completion. The provider is a script; the store, the
 * runners, and every session are real. Design: design.mdx, "Agents".
 */
import assert from "node:assert/strict";
import { dirname } from "node:path";
import { contentText, createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import { isTerminalPhase, type SessionId } from "@nyte-ai/protocol";
import { Type } from "typebox";
import { expect, test } from "vitest";
import { branch } from "../../src/kernel/graph.ts";
import { headRef } from "../../src/kernel/names.ts";
import { pending } from "../../src/kernel/queue.ts";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import type { SessionEvent } from "../../src/kernel/sdk/types.ts";
import type { StreamFn } from "../../src/kernel/loop/types.ts";
import { toolResultText } from "../../src/kernel/loop/tool-result.ts";
import { definePlugin, inlinePlugin } from "../../src/plugins/index.ts";
import { assistant, call, only, openStore, storePath, within } from "./helpers.ts";

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

/**
 * One script for every session. A user message `do <tool> <json>` makes the
 * parent call that tool; a session holding a tool result repeats it; anything
 * else is answered as `answer: <text>`, held while its gate is closed.
 */
async function fixture() {
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
  const nyte = await createNyte({
    store: openStore(path),
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
  const store = openStore(path);
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
      const session = await store.open(id);
      return branch(session.objects, await session.refs.read(headRef("main")));
    },
    async queuedCompletions() {
      const session = await store.open(parent);
      return (await pending(session, "main")).flatMap((item) =>
        item.change.body.kind === "completion" && item.change.body.job.kind === "delegate"
          ? [item.change.body.job]
          : [],
      );
    },
    /** Every child completion the parent has, landed or still queued. */
    async completions() {
      const session = await store.open(parent);
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
      session: child.sessionId,
      title: "helper",
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

test("send lands on the child and its answer reaches the parent once, as a completion naming both commits", async () => {
  const f = await fixture();
  try {
    await f.command("create", { title: "helper", model: MODEL });
    const child = await f.child();
    const release = f.hold("first question");
    const sent = await f.command("send", { agent: child.sessionId, message: "first question" });
    expect(sent.part.class).toEqual({
      kind: "delegate",
      role: "send",
      session: child.sessionId,
      title: "helper",
    });
    expect(sent.said).toContain("Sent to agent helper");
    await expect
      .poll(
        async () => (await f.nyte.runs.current({ sessionId: child.sessionId }))?.phase.kind,
        poll,
      )
      .toBe("respond");
    const childRequest = only(f.requests.filter((request) => request.text === "first question"));
    expect(childRequest.tools).not.toContain("clarify");
    expect(childRequest.tools).not.toContain("task");
    expect(await f.queuedCompletions()).toEqual([]);

    release();
    await f.idle(child.sessionId);
    await expect.poll(() => f.queuedCompletions(), poll).toHaveLength(1);
    const completion = only(await f.queuedCompletions());
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
    expect(completion).toEqual({
      kind: "delegate",
      session: child.sessionId,
      title: "helper",
      request: request.oid,
      end: { kind: "completed" },
      report: { kind: "text", text: "answer: first question", commit: answer.oid },
    });

    // The completion waits for the user; the next message hears it once.
    expect(f.requests.filter((request) => request.completions.length > 0)).toEqual([]);
    await f.nyte.messages.send({ sessionId: f.parent, content: "hello" });
    await f.idle(f.parent);
    const heard = only(f.requests.filter((request) => request.completions.length > 0));
    expect(heard.completions).toEqual([
      `Background agent helper (${child.sessionId}) finished. Its report:\n\nanswer: first question`,
    ]);
    expect(await f.queuedCompletions()).toEqual([]);
    expect(await f.completions()).toHaveLength(1);

    // A second request earns a second completion; the child keeps its context.
    await f.command("send", { agent: child.sessionId, message: "second question" });
    await f.idle(child.sessionId);
    await expect.poll(() => f.completions(), poll).toHaveLength(2);
    expect(new Set((await f.completions()).map((item) => item.request)).size).toBe(2);
    const second = only(f.requests.filter((request) => request.text === "second question"));
    expect(second.completions).toEqual([]);
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
      session: child.sessionId,
      title: "helper",
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
      class: { kind: "delegate", role: "create", session: child.sessionId, title: "worker" },
      result: { isError: false, output: expect.stringContaining("answer: prompt") },
    });
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
      class: { kind: "delegate_call", role: "await", session: child.sessionId },
      result: { isError: true, output: expect.stringContaining("cancelled") },
    });
    const running = await f.nyte.runs.current({ sessionId: child.sessionId });
    assert.ok(running && !isTerminalPhase(running.phase));
    expect(await f.queuedCompletions()).toEqual([]);

    const stopped = await f.command("stop", { agent: child.sessionId });
    expect(stopped.part.class).toEqual({
      kind: "delegate",
      role: "stop",
      session: child.sessionId,
      title: "helper",
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
      session: child.sessionId,
      title: "helper",
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

test("a task whose child outlasts waitMs returns the child's phase; the report follows as a completion", async () => {
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
      session: child.sessionId,
      title: "Investigate the build",
    });
    expect(said).toContain(`Agent Investigate the build (${child.sessionId}) is respond`);
    release();
    await f.idle(child.sessionId);
    await expect
      .poll(() => f.queuedCompletions(), poll)
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
  } finally {
    await f.close();
  }
});
