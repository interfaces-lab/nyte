/**
 * End-to-end behavior of `wait_task`: a parent that parked on an existing
 * background task resumes when the child completes, and cancelling either
 * side settles the right work without touching the other.
 */
import assert from "node:assert/strict";
import { contentText, createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import type { AssistantMessage, Context } from "@nyte-ai/schema";
import { expect, test } from "vitest";
import { createNyte } from "../src/kernel/sdk/nyte.ts";
import type { Nyte, SessionId } from "../src/kernel/sdk/types.ts";
import type { StreamFn } from "../src/kernel/loop/types.ts";
import { assistant, call, only, openStore, within } from "./kernel/helpers.ts";

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
const poll = { timeout: 5_000, interval: 10 };

function script(
  respond: (request: { text: string; context: Context }) => {
    answer: AssistantMessage;
    wait?: Promise<void>;
  },
): StreamFn {
  return (_selected, context, options) => {
    const user = context.messages.findLast((message) => message.role === "user");
    const response = respond({
      text: user === undefined ? "" : contentText(user.content),
      context,
    });
    const stream = createAssistantMessageEventStream();
    const aborted = Promise.withResolvers<void>();
    const signal = options?.signal;
    const onAbort = () => aborted.resolve();
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    void Promise.race([response.wait ?? Promise.resolve(), aborted.promise]).then(() => {
      signal?.removeEventListener("abort", onAbort);
      if (signal?.aborted) {
        stream.push({
          type: "error",
          reason: "aborted",
          error: { ...response.answer, content: [], stopReason: "aborted" },
        });
        return;
      }
      stream.push({
        type: "done",
        reason: response.answer.stopReason === "toolUse" ? "toolUse" : "stop",
        message: response.answer,
      });
    });
    return stream;
  };
}

async function open(streamFn: StreamFn) {
  return createNyte({
    store: openStore(),
    streamFn,
    model,
    models: {
      getModels: () => [model],
      getModel: (provider, id) =>
        provider === model.provider && id === model.id ? model : undefined,
      getAvailable: async () => [model],
    },
    plugins: [],
    env: { cwd: "/tmp/nowhere" },
  });
}

async function idle(nyte: Nyte, sessionId: SessionId) {
  await expect
    .poll(async () => (await within(nyte.runs.wait({ sessionId }), 5_000)).kind, poll)
    .toBe("idle");
}

async function toolParts(nyte: Nyte, sessionId: SessionId) {
  return (await nyte.messages.list({ sessionId, head: "main" })).flatMap((turn) =>
    turn.kind === "turn" ? turn.parts.filter((part) => part.kind === "tool") : [],
  );
}

function jobIdFromReceipt(context: Context): string {
  const receipt = context.messages.findLast(
    (message) => message.role === "toolResult" && message.toolName === "task",
  );
  assert.ok(receipt !== undefined && receipt.role === "toolResult");
  const details = receipt.details;
  assert.ok(typeof details === "object" && details !== null && "jobId" in details);
  assert.equal(typeof details.jobId, "string");
  return String(details.jobId);
}

function lastWaitResult(context: Context) {
  const result = context.messages.findLast(
    (message) => message.role === "toolResult" && message.toolName === "wait_task",
  );
  return result?.role === "toolResult" ? result : undefined;
}

const delegate = call("start", "task", {
  model: "openai/test-model",
  prompt: "child",
  background: true,
});

test("a parked wait_task resumes the parent when the background child completes", async () => {
  const release = Promise.withResolvers<void>();
  const reports: string[] = [];
  const nyte = await open(
    script(({ text, context }) => {
      reports.push(text);
      if (text === "child")
        return { answer: assistant("child report ready"), wait: release.promise };
      const waited = lastWaitResult(context);
      if (waited !== undefined)
        return { answer: assistant(`heard: ${contentText(waited.content)}`) };
      const result = context.messages.findLast((message) => message.role === "toolResult");
      if (result === undefined) return { answer: assistant("", { calls: [delegate] }) };
      return {
        answer: assistant("", {
          calls: [call("wait", "wait_task", { jobId: jobIdFromReceipt(context) })],
        }),
      };
    }),
  );
  try {
    const parent = await nyte.sessions.create();
    nyte.attach();
    await nyte.messages.send({ sessionId: parent.sessionId, content: "delegate" });
    // The run must be durably parked on the wait, not settled, before the child ends.
    await expect
      .poll(
        async () =>
          (await nyte.jobs.list({ sessionId: parent.sessionId })).find(
            (job) => job.callId === "wait",
          )?.state,
        poll,
      )
      .toBe("running");
    expect((await within(nyte.runs.wait({ sessionId: parent.sessionId }), 5_000)).kind).toBe(
      "waiting",
    );
    const waitingRun = await nyte.runs.current({ sessionId: parent.sessionId });
    assert.ok(waitingRun !== undefined);
    release.resolve();
    await idle(nyte, parent.sessionId);
    expect((await nyte.runs.current({ sessionId: parent.sessionId }))?.runId).toBe(
      waitingRun.runId,
    );
    const jobs = await nyte.jobs.list({ sessionId: parent.sessionId });
    expect(jobs.filter((job) => job.kind === "subagent")).toHaveLength(1);
    const waited = (await toolParts(nyte, parent.sessionId)).find((part) => part.callId === "wait");
    assert.ok(waited?.result !== undefined);
    expect(waited.result.isError ?? false).toBe(false);
    expect(waited.result.output).toContain("child report ready");
    const turns = await nyte.messages.list({ sessionId: parent.sessionId, head: "main" });
    const answers = turns.flatMap((turn) =>
      turn.kind === "turn"
        ? turn.parts.flatMap((part) => (part.kind === "assistant" ? [part.text] : []))
        : [],
    );
    expect(answers.at(-1)).toContain("heard: child report ready");
    // The wait handed the report to the agent, so the completion is not repeated.
    expect(reports.filter((text) => text.startsWith("Background "))).toHaveLength(0);
    for (const job of await nyte.jobs.list({ sessionId: parent.sessionId })) {
      expect(job.state).toBe("completed");
    }
  } finally {
    release.resolve();
    await nyte.close();
  }
});

test("stopping the parent run cancels the wait but not a task from an earlier run", async () => {
  const release = Promise.withResolvers<void>();
  const nyte = await open(
    script(({ text, context }) => {
      if (text === "child")
        return { answer: assistant("late child report"), wait: release.promise };
      if (text === "delegate") {
        const result = context.messages.findLast((message) => message.role === "toolResult");
        if (result === undefined) return { answer: assistant("", { calls: [delegate] }) };
        return { answer: assistant("started") };
      }
      if (text.startsWith("wait ") && context.messages.at(-1)?.role === "user")
        return {
          answer: assistant("", { calls: [call("wait", "wait_task", { jobId: text.slice(5) })] }),
        };
      return { answer: assistant("done") };
    }),
  );
  try {
    const parent = await nyte.sessions.create();
    nyte.attach();
    await nyte.messages.send({ sessionId: parent.sessionId, content: "delegate" });
    await idle(nyte, parent.sessionId);
    const task = only(await nyte.jobs.list({ sessionId: parent.sessionId }));
    assert.equal(task.kind, "subagent");
    expect(task.state).toBe("running");

    await nyte.messages.send({ sessionId: parent.sessionId, content: `wait ${task.id}` });
    await expect
      .poll(
        async () =>
          (await nyte.jobs.list({ sessionId: parent.sessionId })).find(
            (job) => job.callId === "wait",
          )?.state,
        poll,
      )
      .toBe("running");
    expect((await nyte.runs.abort({ sessionId: parent.sessionId })).kind).toBe("requested");
    await expect
      .poll(
        async () =>
          (await nyte.runs.current({ sessionId: parent.sessionId }))?.phase.kind ?? "idle",
        poll,
      )
      .toBe("aborted");
    // The stop took the wait with the run it owned; the earlier run's task keeps working.
    const jobs = await nyte.jobs.list({ sessionId: parent.sessionId });
    expect(jobs.find((job) => job.callId === "wait")?.state).toBe("cancelled");
    expect(jobs.find((job) => job.kind === "subagent")?.state).toBe("running");

    release.resolve();
    await expect
      .poll(
        async () =>
          (await nyte.jobs.list({ sessionId: parent.sessionId })).find(
            (job) => job.kind === "subagent",
          )?.state,
        poll,
      )
      .toBe("completed");
    // A completion on the idle, aborted head waits for user input; nothing restarts.
    expect((await nyte.runs.current({ sessionId: parent.sessionId }))?.phase.kind).toBe("aborted");
  } finally {
    release.resolve();
    await nyte.close();
  }
});

test("cancelling the awaited task settles the wait and the parent continues", async () => {
  const release = Promise.withResolvers<void>();
  const nyte = await open(
    script(({ text, context }) => {
      if (text === "child") return { answer: assistant("never"), wait: release.promise };
      const waited = lastWaitResult(context);
      if (waited !== undefined)
        return { answer: assistant(`outcome: ${contentText(waited.content)}`) };
      if (text === "delegate") {
        const result = context.messages.findLast((message) => message.role === "toolResult");
        if (result === undefined) return { answer: assistant("", { calls: [delegate] }) };
        return { answer: assistant("started") };
      }
      if (text.startsWith("wait ") && context.messages.at(-1)?.role === "user")
        return {
          answer: assistant("", { calls: [call("wait", "wait_task", { jobId: text.slice(5) })] }),
        };
      return { answer: assistant("done") };
    }),
  );
  try {
    const parent = await nyte.sessions.create();
    nyte.attach();
    await nyte.messages.send({ sessionId: parent.sessionId, content: "delegate" });
    await idle(nyte, parent.sessionId);
    const task = only(await nyte.jobs.list({ sessionId: parent.sessionId }));
    assert.equal(task.kind, "subagent");

    await nyte.messages.send({ sessionId: parent.sessionId, content: `wait ${task.id}` });
    await expect
      .poll(
        async () =>
          (await nyte.jobs.list({ sessionId: parent.sessionId })).find(
            (job) => job.callId === "wait",
          )?.state,
        poll,
      )
      .toBe("running");
    expect(await nyte.jobs.cancel({ sessionId: parent.sessionId, jobId: task.id })).toEqual({
      kind: "applied",
    });
    await idle(nyte, parent.sessionId);
    const waited = (await toolParts(nyte, parent.sessionId)).find((part) => part.callId === "wait");
    assert.ok(waited?.result !== undefined);
    expect(waited.result.isError).toBe(true);
    expect(waited.class).toEqual({ kind: "delegate", role: "await", jobId: task.id });
    expect(
      (await nyte.jobs.list({ sessionId: parent.sessionId })).find((job) => job.id === task.id)
        ?.state,
    ).toBe("cancelled");
    expect((await nyte.runs.current({ sessionId: parent.sessionId }))?.phase.kind).toBe("done");
  } finally {
    release.resolve();
    await nyte.close();
  }
});

test("wait_task on a finished task returns the stored report at once", async () => {
  const nyte = await open(
    script(({ text, context }) => {
      if (text === "child") return { answer: assistant("early child report") };
      const waited = lastWaitResult(context);
      if (waited !== undefined)
        return { answer: assistant(`heard: ${contentText(waited.content)}`) };
      if (text === "delegate") {
        const result = context.messages.findLast((message) => message.role === "toolResult");
        if (result === undefined) return { answer: assistant("", { calls: [delegate] }) };
        return { answer: assistant("started") };
      }
      if (text.startsWith("wait ") && context.messages.at(-1)?.role === "user")
        return {
          answer: assistant("", { calls: [call("wait", "wait_task", { jobId: text.slice(5) })] }),
        };
      return { answer: assistant("done") };
    }),
  );
  try {
    const parent = await nyte.sessions.create();
    nyte.attach();
    await nyte.messages.send({ sessionId: parent.sessionId, content: "delegate" });
    await idle(nyte, parent.sessionId);
    const task = only(await nyte.jobs.list({ sessionId: parent.sessionId }));
    await expect
      .poll(async () => only(await nyte.jobs.list({ sessionId: parent.sessionId })).state, poll)
      .toBe("completed");
    await nyte.messages.send({ sessionId: parent.sessionId, content: `wait ${task.id}` });
    await idle(nyte, parent.sessionId);
    const waited = (await toolParts(nyte, parent.sessionId)).find((part) => part.callId === "wait");
    assert.ok(waited?.result !== undefined);
    expect(waited.result.isError ?? false).toBe(false);
    expect(waited.result.output).toContain("early child report");
  } finally {
    await nyte.close();
  }
});

test("wait_task refuses an unknown job id", async () => {
  const nyte = await open(
    script(({ text, context }) => {
      const waited = lastWaitResult(context);
      if (waited !== undefined)
        return { answer: assistant(`outcome: ${contentText(waited.content)}`) };
      if (text.startsWith("wait ") && context.messages.at(-1)?.role === "user")
        return {
          answer: assistant("", { calls: [call("wait", "wait_task", { jobId: text.slice(5) })] }),
        };
      return { answer: assistant("done") };
    }),
  );
  try {
    const parent = await nyte.sessions.create();
    nyte.attach();
    await nyte.messages.send({ sessionId: parent.sessionId, content: "wait job_missing" });
    await idle(nyte, parent.sessionId);
    const waited = (await toolParts(nyte, parent.sessionId)).find((part) => part.callId === "wait");
    assert.ok(waited?.result !== undefined);
    expect(waited.result.isError).toBe(true);
    expect(waited.result.output).toBe("Task job not found in this session: job_missing");
  } finally {
    await nyte.close();
  }
});

test("wait_task cannot observe another session's running task", async () => {
  const release = Promise.withResolvers<void>();
  const nyte = await open(
    script(({ text, context }) => {
      if (text === "child")
        return { answer: assistant("private child report"), wait: release.promise };
      const waited = lastWaitResult(context);
      if (waited !== undefined)
        return { answer: assistant(`outcome: ${contentText(waited.content)}`) };
      if (text === "delegate") {
        const result = context.messages.findLast((message) => message.role === "toolResult");
        return result === undefined
          ? { answer: assistant("", { calls: [delegate] }) }
          : { answer: assistant("started") };
      }
      if (text.startsWith("wait ") && context.messages.at(-1)?.role === "user")
        return {
          answer: assistant("", { calls: [call("wait", "wait_task", { jobId: text.slice(5) })] }),
        };
      return { answer: assistant("done") };
    }),
  );
  try {
    const owner = await nyte.sessions.create();
    const other = await nyte.sessions.create();
    nyte.attach();
    await nyte.messages.send({ sessionId: owner.sessionId, content: "delegate" });
    await idle(nyte, owner.sessionId);
    const task = only(await nyte.jobs.list({ sessionId: owner.sessionId }));
    expect(task.state).toBe("running");
    await nyte.messages.send({ sessionId: other.sessionId, content: `wait ${task.id}` });
    await idle(nyte, other.sessionId);
    const waited = (await toolParts(nyte, other.sessionId)).find((part) => part.callId === "wait");
    assert.ok(waited?.result !== undefined);
    expect(waited.result.isError).toBe(true);
    expect(waited.result.output).toBe(`Task job not found in this session: ${task.id}`);
    expect(waited.result.output).not.toContain("private child report");
    expect(only(await nyte.jobs.list({ sessionId: owner.sessionId })).state).toBe("running");
  } finally {
    release.resolve();
    await nyte.close();
  }
});

test("closing the host settles a pending wait without waiting for the child's report", async () => {
  const release = Promise.withResolvers<void>();
  const nyte = await open(
    script(({ text, context }) => {
      if (text === "child") return { answer: assistant("not released"), wait: release.promise };
      const waited = lastWaitResult(context);
      if (waited !== undefined) return { answer: assistant("done") };
      const result = context.messages.findLast((message) => message.role === "toolResult");
      return result === undefined
        ? { answer: assistant("", { calls: [delegate] }) }
        : {
            answer: assistant("", {
              calls: [call("wait", "wait_task", { jobId: jobIdFromReceipt(context) })],
            }),
          };
    }),
  );
  try {
    const parent = await nyte.sessions.create();
    nyte.attach();
    await nyte.messages.send({ sessionId: parent.sessionId, content: "delegate" });
    await expect
      .poll(
        async () =>
          (await nyte.jobs.list({ sessionId: parent.sessionId })).find(
            (job) => job.callId === "wait",
          )?.state,
        poll,
      )
      .toBe("running");
    await within(nyte.close(), 5_000);
  } finally {
    release.resolve();
    await nyte.close();
  }
});
