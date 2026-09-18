/**
 * A parked task holds the parent turn, and a parked turn has no response
 * boundary for queued input to land at. These cover the ways a task gives the
 * turn back when the user sends something: a wait ends with the task still
 * running, and a foreground task moves to background.
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

async function answers(nyte: Nyte, sessionId: SessionId) {
  const turns = await nyte.messages.list({ sessionId, head: "main" });
  return turns.flatMap((turn) =>
    turn.kind === "turn"
      ? turn.parts.flatMap((part) => (part.kind === "assistant" ? [part.text] : []))
      : [],
  );
}

async function subagentJob(nyte: Nyte, sessionId: SessionId) {
  const job = (await nyte.jobs.list({ sessionId })).find((item) => item.kind === "subagent");
  assert.ok(job !== undefined);
  return job;
}

function jobIdFromReceipt(context: Context): string {
  const receipt = context.messages.findLast(
    (message) => message.role === "toolResult" && message.toolName === "task",
  );
  assert.ok(receipt !== undefined && receipt.role === "toolResult");
  const details = receipt.details;
  assert.ok(typeof details === "object" && details !== null && "jobId" in details);
  return String(details.jobId);
}

/** What the parent's model was given, so delivery is judged by what reached it. */
function prompts() {
  const seen = new Set<string>();
  return {
    record: (context: Context) => {
      for (const message of context.messages) {
        if (message.role === "user") seen.add(contentText(message.content));
      }
    },
    reports: () => [...seen].filter((text) => text.startsWith("Background ")),
  };
}

function waitResultText(context: Context): string | undefined {
  const result = context.messages.findLast(
    (message) => message.role === "toolResult" && message.toolName === "wait_task",
  );
  return result?.role === "toolResult" ? contentText(result.content) : undefined;
}

test("a parked wait_task ends on queued user input and leaves the task running", async () => {
  const release = Promise.withResolvers<void>();
  const parentPrompts = prompts();
  const nyte = await open(
    script(({ text, context }) => {
      if (text === "child") return { answer: assistant("child report"), wait: release.promise };
      parentPrompts.record(context);
      if (text === "anything else?" || text.startsWith("Background ")) {
        return { answer: assistant("done") };
      }
      if (text === "steer now") {
        const waited = waitResultText(context);
        assert.ok(waited !== undefined, "the wait must settle before the steer is answered");
        expect(waited).toContain("still running");
        return { answer: assistant("answered user") };
      }
      if (context.messages.every((message) => message.role !== "toolResult")) {
        return {
          answer: assistant("", {
            calls: [
              call("start", "task", {
                model: "openai/test-model",
                prompt: "child",
                background: true,
              }),
            ],
          }),
        };
      }
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
    await nyte.messages.send({
      sessionId: parent.sessionId,
      content: "steer now",
      lane: "steer",
    });
    await idle(nyte, parent.sessionId);
    expect((await answers(nyte, parent.sessionId)).at(-1)).toBe("answered user");
    // The task the parent stopped waiting for is untouched by the yield.
    expect((await subagentJob(nyte, parent.sessionId)).state).toBe("running");
    release.resolve();
    await expect
      .poll(async () => (await subagentJob(nyte, parent.sessionId)).state, poll)
      .toBe("completed");
    // The wait left the report to the completion it had held back.
    await nyte.messages.send({ sessionId: parent.sessionId, content: "anything else?" });
    await idle(nyte, parent.sessionId);
    expect(only(parentPrompts.reports())).toContain("child report");
  } finally {
    release.resolve();
    await nyte.close();
  }
}, 20_000);

test("queued user input moves a parked foreground task to background", async () => {
  const release = Promise.withResolvers<void>();
  const parentPrompts = prompts();
  const nyte = await open(
    script(({ text, context }) => {
      if (text === "child") return { answer: assistant("child report"), wait: release.promise };
      parentPrompts.record(context);
      if (text === "anything else?" || text.startsWith("Background ")) {
        return { answer: assistant("done") };
      }
      if (text === "steer now") {
        const receipt = context.messages.findLast(
          (message) => message.role === "toolResult" && message.toolName === "task",
        );
        assert.ok(receipt?.role === "toolResult");
        expect(contentText(receipt.content)).toContain("runs in the background");
        return { answer: assistant("answered user") };
      }
      return {
        answer: assistant("", {
          calls: [call("start", "task", { model: "openai/test-model", prompt: "child" })],
        }),
      };
    }),
  );
  try {
    const parent = await nyte.sessions.create();
    nyte.attach();
    await nyte.messages.send({ sessionId: parent.sessionId, content: "delegate" });
    await expect
      .poll(async () => (await subagentJob(nyte, parent.sessionId)).mode, poll)
      .toBe("foreground");
    expect((await within(nyte.runs.wait({ sessionId: parent.sessionId }), 5_000)).kind).toBe(
      "waiting",
    );
    await nyte.messages.send({
      sessionId: parent.sessionId,
      content: "steer now",
      lane: "steer",
    });
    await idle(nyte, parent.sessionId);
    expect((await answers(nyte, parent.sessionId)).at(-1)).toBe("answered user");
    const promoted = await subagentJob(nyte, parent.sessionId);
    expect(promoted.mode).toBe("background");
    expect(promoted.state).toBe("running");
    release.resolve();
    await expect
      .poll(async () => (await subagentJob(nyte, parent.sessionId)).state, poll)
      .toBe("completed");
    // The report the promoted call never carried reaches the model as a completion.
    await nyte.messages.send({ sessionId: parent.sessionId, content: "anything else?" });
    await idle(nyte, parent.sessionId);
    expect(only(parentPrompts.reports())).toContain("child report");
  } finally {
    release.resolve();
    await nyte.close();
  }
}, 20_000);

test("input queued for after the turn leaves a parked wait alone", async () => {
  const release = Promise.withResolvers<void>();
  const nyte = await open(
    script(({ text, context }) => {
      if (text === "child") return { answer: assistant("child report"), wait: release.promise };
      if (text === "later") return { answer: assistant("answered later") };
      if (waitResultText(context) !== undefined) return { answer: assistant("got report") };
      if (context.messages.every((message) => message.role !== "toolResult")) {
        return {
          answer: assistant("", {
            calls: [
              call("start", "task", {
                model: "openai/test-model",
                prompt: "child",
                background: true,
              }),
            ],
          }),
        };
      }
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
    await expect
      .poll(
        async () =>
          (await nyte.jobs.list({ sessionId: parent.sessionId })).find(
            (job) => job.callId === "wait",
          )?.state,
        poll,
      )
      .toBe("running");
    // The queue lane lands when the head is idle, so this input is not waiting
    // on a response boundary and the parked wait is not what holds it up.
    await nyte.messages.send({ sessionId: parent.sessionId, content: "later", lane: "queue" });
    await new Promise((resolve) => setTimeout(resolve, 500));
    expect((await nyte.runs.current({ sessionId: parent.sessionId }))?.phase.kind).toBe("waiting");
    expect(
      (await nyte.jobs.list({ sessionId: parent.sessionId })).find((job) => job.callId === "wait")
        ?.state,
    ).toBe("running");
    release.resolve();
    await idle(nyte, parent.sessionId);
    expect(await answers(nyte, parent.sessionId)).toContain("answered later");
  } finally {
    release.resolve();
    await nyte.close();
  }
}, 20_000);

test("a task that finishes as the wait yields still reaches the model", async () => {
  const release = Promise.withResolvers<void>();
  const parentPrompts = prompts();
  const nyte = await open(
    script(({ text, context }) => {
      if (text === "child") return { answer: assistant("child report"), wait: release.promise };
      parentPrompts.record(context);
      if (text === "anything else?") return { answer: assistant("done") };
      if (text === "steer now" || text.startsWith("Background ")) {
        return { answer: assistant(`saw: ${waitResultText(context) ?? "nothing"}`) };
      }
      if (context.messages.every((message) => message.role !== "toolResult")) {
        return {
          answer: assistant("", {
            calls: [
              call("start", "task", {
                model: "openai/test-model",
                prompt: "child",
                background: true,
              }),
            ],
          }),
        };
      }
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
    await expect
      .poll(
        async () =>
          (await nyte.jobs.list({ sessionId: parent.sessionId })).find(
            (job) => job.callId === "wait",
          )?.state,
        poll,
      )
      .toBe("running");
    // The yield and the child's report race here: whichever wins, the report is
    // carried by exactly one of the wait's result and the completion message.
    await Promise.all([
      nyte.messages.send({ sessionId: parent.sessionId, content: "steer now", lane: "steer" }),
      Promise.resolve().then(() => release.resolve()),
    ]);
    await idle(nyte, parent.sessionId);
    await nyte.messages.send({ sessionId: parent.sessionId, content: "anything else?" });
    await idle(nyte, parent.sessionId);
    const carried = [
      ...(await answers(nyte, parent.sessionId)).filter((text) => text.includes("child report")),
      ...parentPrompts.reports(),
    ];
    expect(carried).toHaveLength(1);
    expect(carried[0]).toContain("child report");
  } finally {
    release.resolve();
    await nyte.close();
  }
}, 20_000);

test("two waits on one task both return its report and neither repeats it", async () => {
  const release = Promise.withResolvers<void>();
  const parentPrompts = prompts();
  const nyte = await open(
    script(({ text, context }) => {
      if (text === "child") return { answer: assistant("child report"), wait: release.promise };
      parentPrompts.record(context);
      const waits = context.messages.filter(
        (message) => message.role === "toolResult" && message.toolName === "wait_task",
      );
      if (waits.length > 0) {
        return {
          answer: assistant(
            waits
              .map((message) => (message.role === "toolResult" ? contentText(message.content) : ""))
              .join(" | "),
          ),
        };
      }
      if (context.messages.every((message) => message.role !== "toolResult")) {
        return {
          answer: assistant("", {
            calls: [
              call("start", "task", {
                model: "openai/test-model",
                prompt: "child",
                background: true,
              }),
            ],
          }),
        };
      }
      const jobId = jobIdFromReceipt(context);
      return {
        answer: assistant("", {
          calls: [call("first", "wait_task", { jobId }), call("second", "wait_task", { jobId })],
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
          (await nyte.jobs.list({ sessionId: parent.sessionId })).filter(
            (job) => job.callId === "first" || job.callId === "second",
          ).length,
        poll,
      )
      .toBe(2);
    release.resolve();
    await idle(nyte, parent.sessionId);
    const answer = (await answers(nyte, parent.sessionId)).at(-1) ?? "";
    expect(answer.split("child report")).toHaveLength(3);
    await nyte.messages.send({ sessionId: parent.sessionId, content: "anything else?" });
    await idle(nyte, parent.sessionId);
    expect(parentPrompts.reports()).toHaveLength(0);
  } finally {
    release.resolve();
    await nyte.close();
  }
}, 20_000);
