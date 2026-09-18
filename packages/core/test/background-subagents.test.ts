import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { contentText, createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import type { AssistantMessage, Context } from "@nyte-ai/schema";
import { Type } from "typebox";
import { expect, test } from "vitest";
import { createNyte } from "../src/kernel/sdk/nyte.ts";
import type { ModelCatalog, Nyte, SessionEvent, SessionId } from "../src/kernel/sdk/types.ts";
import type { Session, Store } from "../src/kernel/store.ts";
import { definePlugin, inlinePlugin, type Plugin } from "../src/plugins/index.ts";
import { ToolWait, type StreamFn } from "../src/kernel/loop/types.ts";
import { createBashTool } from "../src/tools/bash.ts";
import { assistant, call, only, openStore, storePath, within } from "./kernel/helpers.ts";

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
const otherModel: Model<Api> = { ...model, id: "other-model" };
const catalog = [model, otherModel];
const poll = { timeout: 5_000, interval: 10 };

function script(
  respond: (request: { text: string; context: Context; model: Model<Api> }) => {
    answer: AssistantMessage;
    wait?: Promise<void>;
  },
): StreamFn {
  return (selected, context, options) => {
    const user = context.messages.findLast((message) => message.role === "user");
    const response = respond({
      text: user === undefined ? "" : contentText(user.content),
      context,
      model: selected,
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

async function open(
  streamFn: StreamFn,
  options: {
    session?: Plugin["session"];
    getAvailable?: ModelCatalog["getAvailable"];
    store?: Store;
    cwd?: string;
  } = {},
) {
  const events: SessionEvent[] = [];
  const nyte = await createNyte({
    store: options.store ?? openStore(),
    streamFn,
    model,
    models: {
      getModels: () => catalog,
      getModel: (provider, id) =>
        catalog.find((item) => item.provider === provider && item.id === id),
      getAvailable: options.getAvailable ?? (async () => catalog),
    },
    plugins: [
      inlinePlugin(
        definePlugin({
          id: "background-subagent-regressions",
          async session(api) {
            api.events.subscribe((event) => events.push(event));
            api.agents.add((draft) => draft.set("worker", { id: "worker", mode: "subagent" }));
            await options.session?.(api);
          },
        }),
      ),
    ],
    env: { cwd: options.cwd ?? "/tmp/nowhere" },
  });
  return { nyte, events };
}

async function idle(nyte: Nyte, sessionId: SessionId, head = "main") {
  await expect
    .poll(async () => (await within(nyte.runs.wait({ sessionId, head }), 5_000)).kind, poll)
    .toBe("idle");
}

async function toolParts(nyte: Nyte, sessionId: SessionId, head = "main") {
  return (await nyte.messages.list({ sessionId, head })).flatMap((turn) =>
    turn.kind === "turn" ? turn.parts.filter((part) => part.kind === "tool") : [],
  );
}

test("simultaneous heads reusing a task call id keep their children, models and jobs separate", async () => {
  const parentsReady = Promise.withResolvers<void>();
  const releaseParents = Promise.withResolvers<void>();
  const releaseChildren = Promise.withResolvers<void>();
  const parentRequests = new Set<string>();
  const childRequests = new Map<string, { model: Model<Api>; context: Context }>();
  const { nyte, events } = await open(
    script((request) => {
      if (
        request.text.startsWith("delegate/") &&
        request.context.messages.at(-1)?.role === "user"
      ) {
        parentRequests.add(request.text);
        if (parentRequests.size === 2) parentsReady.resolve();
        return {
          answer: assistant("", {
            calls: [
              call("same-call", "task", {
                model:
                  request.text === "delegate/main" ? "openai/other-model" : "openai/test-model",
                prompt: request.text.replace("delegate/", "child/"),
              }),
            ],
          }),
          wait: releaseParents.promise,
        };
      }
      if (request.text.startsWith("child/")) {
        childRequests.set(request.text, { model: request.model, context: request.context });
        return { answer: assistant(`result:${request.text}`), wait: releaseChildren.promise };
      }
      return { answer: assistant("parent done") };
    }),
  );
  try {
    const parent = await nyte.sessions.create();
    await nyte.heads.create({
      sessionId: parent.sessionId,
      head: "research",
      from: { head: "main" },
    });
    await nyte.sessions.configure({
      sessionId: parent.sessionId,
      head: "research",
      model: { provider: otherModel.provider, id: otherModel.id },
    });
    nyte.attach({ sessions: [parent.sessionId] });
    await Promise.all(
      ["main", "research"].map((head) =>
        nyte.messages.send({ sessionId: parent.sessionId, head, content: `delegate/${head}` }),
      ),
    );
    await within(parentsReady.promise, 5_000);
    releaseParents.resolve();
    await expect.poll(() => childRequests.size, poll).toBe(2);
    const jobs = await nyte.jobs.list({ sessionId: parent.sessionId });
    expect(jobs).toHaveLength(2);
    expect(new Set(jobs.map((job) => job.id)).size).toBe(2);
    expect(new Set(jobs.map((job) => job.runId)).size).toBe(2);
    const children = (await nyte.sessions.list({ parent: parent.sessionId })).items;
    expect(children).toHaveLength(2);
    expect(new Set(children.map((child) => child.sessionId)).size).toBe(2);
    for (const [head, selected] of [
      ["main", otherModel],
      ["research", model],
    ] as const) {
      const job = only(jobs.filter((item) => item.head === head));
      assert.equal(job.kind, "subagent");
      expect(job).toMatchObject({ callId: "same-call", mode: "foreground", state: "running" });
      const run = await nyte.runs.current({ sessionId: parent.sessionId, head });
      expect(job.runId).toBe(run?.runId);
      const child = only(children.filter((item) => item.sessionId === job.childSessionId));
      expect(child.parent).toEqual({
        sessionId: parent.sessionId,
        runId: job.runId,
        callId: "same-call",
        depth: 1,
      });
      expect(job.title).toBe(`${selected.provider}/${selected.id}`);
      expect(child.config.model).toEqual({ provider: selected.provider, id: selected.id });
      expect((await nyte.runs.current({ sessionId: child.sessionId }))?.config.model).toEqual(
        child.config.model,
      );
      const request = childRequests.get(`child/${head}`);
      expect(request?.model).toEqual(selected);
      expect(
        request?.context.messages
          .filter((message) => message.role === "user")
          .map((message) => contentText(message.content)),
      ).toEqual([`child/${head}`]);
      expect(
        (await within(nyte.runs.wait({ sessionId: parent.sessionId, head }), 5_000)).kind,
      ).toBe("waiting");
      expect(await nyte.jobs.background({ sessionId: parent.sessionId, jobId: job.id })).toEqual({
        kind: "applied",
      });
      await idle(nyte, parent.sessionId, head);
      const backgrounded = only(await toolParts(nyte, parent.sessionId, head));
      expect(backgrounded.class).toMatchObject({
        kind: "delegate",
        role: "spawn",
        child: child.sessionId,
      });
      expect(backgrounded.result?.output).toContain(job.id);
    }
    releaseChildren.resolve();
    await expect
      .poll(
        async () =>
          (await nyte.jobs.list({ sessionId: parent.sessionId })).every(
            (job) => job.state === "completed",
          ),
        poll,
      )
      .toBe(true);
    for (const job of jobs) {
      await idle(nyte, parent.sessionId, job.head);
      expect(
        only(await nyte.jobs.list({ sessionId: parent.sessionId, head: job.head })),
      ).toMatchObject({ id: job.id, output: `result:child/${job.head}` });
      await expect
        .poll(
          () =>
            events.some(
              (event) =>
                event.kind === "job" && event.job.id === job.id && event.job.state === "completed",
            ),
          poll,
        )
        .toBe(true);
    }
  } finally {
    releaseParents.resolve();
    releaseChildren.resolve();
    await nyte.close();
  }
}, 15_000);

for (const scenario of ["later request", "delayed before_tool", "parked question"] as const) {
  test(`backgrounding a foreground subagent blocks a question: ${scenario}`, async () => {
    const reached = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();
    const requests: Context[] = [];
    let questionExecutions = 0;
    const { nyte } = await open(
      script((request) => {
        if (request.text === "delegate" && request.context.messages.at(-1)?.role === "user")
          return {
            answer: assistant("", {
              calls: [call("task", "task", { model: "openai/test-model", prompt: "child" })],
            }),
          };
        if (request.text !== "child") return { answer: assistant("parent done") };
        requests.push(request.context);
        const results = request.context.messages.filter((message) => message.role === "toolResult");
        if (results.some((result) => result.toolName === "clarify"))
          return { answer: assistant("child finished without user input") };
        return {
          answer: assistant("", {
            calls: [
              scenario === "later request" && results.length === 0
                ? call("work", "work")
                : call("question", "clarify"),
            ],
          }),
        };
      }),
      {
        session(api) {
          api.tools.add((draft) => {
            draft.set("work", {
              name: "work",
              description: "Do local work",
              parameters: Type.Object({}),
              async execute() {
                reached.resolve();
                await release.promise;
                return { content: [{ type: "text", text: "work done" }], details: {} };
              },
            });
            // Availability follows a host requirement, not the conventional tool name.
            draft.set("clarify", {
              name: "clarify",
              availability: "foreground",
              description: "Ask the user",
              parameters: Type.Object({}),
              async execute() {
                questionExecutions += 1;
                if (scenario === "parked question") throw new ToolWait();
                return {
                  content: [{ type: "text", text: "unexpected user interaction" }],
                  details: {},
                };
              },
              wake: async () => ({ kind: "wait" }),
            });
          });
          api.hook("before_tool", async (event) => {
            if (scenario === "delayed before_tool" && event.toolName === "clarify") {
              reached.resolve();
              await release.promise;
            }
            return { action: "continue" };
          });
        },
      },
    );
    try {
      const parent = await nyte.sessions.create();
      nyte.attach({ sessions: [parent.sessionId] });
      await nyte.messages.send({ sessionId: parent.sessionId, content: "delegate" });
      await expect
        .poll(async () => (await nyte.jobs.list({ sessionId: parent.sessionId })).length, poll)
        .toBe(1);
      const job = only(await nyte.jobs.list({ sessionId: parent.sessionId }));
      assert.equal(job.kind, "subagent");
      if (scenario === "parked question") {
        await expect
          .poll(
            async () =>
              (await nyte.sessions.snapshot({ sessionId: job.childSessionId }))?.parked?.some(
                (item) => item.callId === "question",
              ),
            poll,
          )
          .toBe(true);
        expect((await within(nyte.runs.wait({ sessionId: job.childSessionId }), 5_000)).kind).toBe(
          "waiting",
        );
      } else await within(reached.promise, 5_000);
      expect(requests[0]?.tools?.map((tool) => tool.name)).toContain("clarify");
      expect(await nyte.jobs.background({ sessionId: parent.sessionId, jobId: job.id })).toEqual({
        kind: "applied",
      });
      release.resolve();
      await expect
        .poll(async () => only(await nyte.jobs.list({ sessionId: parent.sessionId })).state, poll)
        .toBe("completed");
      await idle(nyte, job.childSessionId);
      await idle(nyte, parent.sessionId);
      expect(questionExecutions).toBe(scenario === "parked question" ? 1 : 0);
      expect(requests.length).toBe(scenario === "later request" ? 3 : 2);
      for (const request of requests.slice(1)) {
        expect(request.tools?.map((tool) => tool.name)).not.toContain("clarify");
        expect(request.tools?.map((tool) => tool.name)).toContain("work");
      }
      const question = only(
        (await toolParts(nyte, job.childSessionId)).filter((part) => part.callId === "question"),
      );
      expect(question.result?.isError).toBe(true);
      expect(question.result?.output).not.toBe("");
      const snapshot = await nyte.sessions.snapshot({ sessionId: job.childSessionId });
      assert.ok(snapshot);
      expect(snapshot.parked ?? []).toEqual([]);
      expect(only(await nyte.jobs.list({ sessionId: parent.sessionId }))).toMatchObject({
        mode: "background",
        state: "completed",
        output: "child finished without user input",
      });
    } finally {
      release.resolve();
      await nyte.close();
    }
  }, 15_000);
}

test("promotion during child adoption still blocks the child's question tools", async () => {
  const store = openStore();
  const adopting = Promise.withResolvers<void>();
  const promoted = Promise.withResolvers<void>();
  let gated = false;
  // The child's first job-background read is the adoption's; promotion lands
  // inside that window, after the old spawn code read the job's mode.
  const gateChild = (session: Session): Session => ({
    id: session.id,
    objects: session.objects,
    leases: session.leases,
    events: session.events,
    refs: {
      read: async (name) => {
        if (name === "refs/facts/job-background" && !gated) {
          gated = true;
          adopting.resolve();
          await promoted.promise;
        }
        return session.refs.read(name);
      },
      list: (prefix) => session.refs.list(prefix),
      update: (updates, updateOptions) => session.refs.update(updates, updateOptions),
    },
    close: () => session.close(),
  });
  const childRequests: Context[] = [];
  const { nyte } = await open(
    script((request) => {
      if (request.text === "delegate" && request.context.messages.at(-1)?.role === "user")
        return {
          answer: assistant("", {
            calls: [call("task", "task", { model: "openai/test-model", prompt: "child" })],
          }),
        };
      if (request.text === "child") {
        childRequests.push(request.context);
        return { answer: assistant("child done") };
      }
      return { answer: assistant("parent done") };
    }),
    {
      store: {
        create: async (createOptions) => {
          const session = await store.create(createOptions);
          return session.id.startsWith("s_child_") ? gateChild(session) : session;
        },
        open: (id) => store.open(id),
        list: () => store.list(),
        delete: (id) => store.delete(id),
        close: () => store.close(),
      },
      session(api) {
        api.tools.add((draft) => {
          draft.set("clarify", {
            name: "clarify",
            availability: "foreground",
            description: "Ask the user",
            parameters: Type.Object({}),
            execute: async () => ({ content: [{ type: "text", text: "answer" }], details: {} }),
          });
        });
      },
    },
  );
  try {
    const parent = await nyte.sessions.create();
    nyte.attach({ sessions: [parent.sessionId] });
    await nyte.messages.send({ sessionId: parent.sessionId, content: "delegate" });
    await within(adopting.promise, 5_000);
    const job = only(await nyte.jobs.list({ sessionId: parent.sessionId }));
    assert.equal(job.kind, "subagent");
    expect(await nyte.jobs.background({ sessionId: parent.sessionId, jobId: job.id })).toEqual({
      kind: "applied",
    });
    promoted.resolve();
    await expect
      .poll(async () => only(await nyte.jobs.list({ sessionId: parent.sessionId })).state, poll)
      .toBe("completed");
    await idle(nyte, job.childSessionId);
    await idle(nyte, parent.sessionId);
    expect(childRequests.length).toBeGreaterThan(0);
    for (const request of childRequests) {
      expect(request.tools?.map((tool) => tool.name)).not.toContain("clarify");
    }
    const snapshot = await nyte.sessions.snapshot({ sessionId: job.childSessionId });
    assert.ok(snapshot);
    expect(snapshot.parked ?? []).toEqual([]);
    expect(only(await nyte.jobs.list({ sessionId: parent.sessionId }))).toMatchObject({
      mode: "background",
      state: "completed",
    });
  } finally {
    promoted.resolve();
    await nyte.close();
  }
}, 15_000);

for (const stage of ["models.getAvailable", "child setup"] as const) {
  for (const cancel of ["job", "run"] as const) {
    test(`${cancel} cancellation during ${stage} starts no child work`, async () => {
      const reached = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      const returned = Promise.withResolvers<void>();
      const cancellationObserved = Promise.withResolvers<void>();
      let taskRequested = false;
      let gated = false;
      let childRequests = 0;
      const { nyte, events } = await open(
        script((request) => {
          if (request.text === "delegate" && request.context.messages.at(-1)?.role === "user") {
            taskRequested = true;
            return {
              answer: assistant("", {
                calls: [call("task", "task", { model: "openai/test-model", prompt: "child" })],
              }),
            };
          }
          if (request.text === "child") childRequests += 1;
          return { answer: assistant("done") };
        }),
        {
          async getAvailable(_providers, options) {
            // The first lookup advertises the task schema. Gate the execution lookup instead.
            if (taskRequested && !gated) {
              gated = true;
              const signal = options?.signal;
              if (signal?.aborted) cancellationObserved.resolve();
              else
                signal?.addEventListener("abort", () => cancellationObserved.resolve(), {
                  once: true,
                });
              if (stage === "models.getAvailable") {
                reached.resolve();
                await release.promise;
                returned.resolve();
              }
            }
            return catalog;
          },
          async session(api) {
            if (stage !== "child setup" || !(await api.session.info()).child) return;
            reached.resolve();
            await release.promise;
            returned.resolve();
          },
        },
      );
      try {
        const parent = await nyte.sessions.create();
        nyte.attach({ sessions: [parent.sessionId] });
        await nyte.messages.send({ sessionId: parent.sessionId, content: "delegate" });
        await within(reached.promise, 5_000);
        const job = only(await nyte.jobs.list({ sessionId: parent.sessionId }));
        assert.equal(job.kind, "subagent");
        expect(job.state).toBe("running");
        expect(childRequests).toBe(0);
        if (cancel === "job")
          expect(await nyte.jobs.cancel({ sessionId: parent.sessionId, jobId: job.id })).toEqual({
            kind: "applied",
          });
        else
          expect((await nyte.runs.abort({ sessionId: parent.sessionId })).kind).toBe("requested");
        await expect
          .poll(async () => only(await nyte.jobs.list({ sessionId: parent.sessionId })).state, poll)
          .toBe("cancelled");
        await within(cancellationObserved.promise, 5_000);
        release.resolve();
        await within(returned.promise, 5_000);
        await nyte.reactivate();
        await idle(nyte, parent.sessionId);
        const children = (await nyte.sessions.list({ parent: parent.sessionId })).items;
        expect(children).toHaveLength(stage === "models.getAvailable" ? 0 : 1);
        for (const child of children) {
          await idle(nyte, child.sessionId);
          expect(await nyte.messages.pending({ sessionId: child.sessionId })).toEqual([]);
          const run = await nyte.runs.current({ sessionId: child.sessionId });
          expect(run === undefined || run.phase.kind === "aborted").toBe(true);
        }
        expect(childRequests).toBe(0);
        expect(only(await nyte.jobs.list({ sessionId: parent.sessionId })).state).toBe("cancelled");
        await expect
          .poll(
            () =>
              events.some(
                (event) =>
                  event.kind === "job" &&
                  event.job.id === job.id &&
                  event.job.state === "cancelled",
              ),
            poll,
          )
          .toBe(true);
        expect(
          events.some(
            (event) =>
              event.kind === "job" && event.job.id === job.id && event.job.state === "completed",
          ),
        ).toBe(false);
      } finally {
        release.resolve();
        await nyte.close();
      }
    }, 15_000);
  }
}

test("an agent stops its background task by the returned job id", async () => {
  const release = Promise.withResolvers<void>();
  const childStarted = Promise.withResolvers<void>();
  const { nyte } = await open(
    script(({ text, context }) => {
      if (text === "child") {
        childStarted.resolve();
        return { answer: assistant("should not finish"), wait: release.promise };
      }
      const result = context.messages.findLast((message) => message.role === "toolResult");
      if (text === "delegate" && result === undefined)
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
      if (text === "delegate" && result?.toolName === "task") {
        const details = result.details;
        assert.ok(typeof details === "object" && details !== null && "jobId" in details);
        assert.equal(typeof details.jobId, "string");
        return {
          answer: assistant("", { calls: [call("stop", "stop_task", { jobId: details.jobId })] }),
          wait: childStarted.promise,
        };
      }
      if (text.startsWith("stop ") && context.messages.at(-1)?.role === "user")
        return {
          answer: assistant("", {
            calls: [call("stop-again", "stop_task", { jobId: text.slice(5) })],
          }),
        };
      return { answer: assistant("parent ready") };
    }),
  );
  try {
    const parent = await nyte.sessions.create();
    nyte.attach();
    await nyte.messages.send({ sessionId: parent.sessionId, content: "delegate" });
    await expect
      .poll(async () => (await nyte.jobs.list({ sessionId: parent.sessionId }))[0]?.state, poll)
      .toBe("cancelled");
    await idle(nyte, parent.sessionId);
    const job = only(await nyte.jobs.list({ sessionId: parent.sessionId }));
    assert.equal(job.kind, "subagent");
    await idle(nyte, job.childSessionId);
    expect((await nyte.runs.current({ sessionId: job.childSessionId }))?.phase.kind).toBe(
      "aborted",
    );
    const stopped = (await toolParts(nyte, parent.sessionId)).find(
      (part) => part.callId === "stop",
    );
    expect(stopped?.result?.output).toBe(`Task ${job.id} stopped.`);
    for (const [jobId, kind] of [
      [job.id, "finished"],
      ["job_missing", "not_found"],
    ] as const) {
      await nyte.messages.send({ sessionId: parent.sessionId, content: `stop ${jobId}` });
      await idle(nyte, parent.sessionId);
      const stopped = (await toolParts(nyte, parent.sessionId)).findLast(
        (part) => part.callId === "stop-again",
      );
      expect(stopped?.result?.output).toBe(
        kind === "finished"
          ? `Task ${jobId} has already finished.`
          : `Task job not found in this session: ${jobId}`,
      );
      expect(stopped?.result?.isError ?? false).toBe(kind === "not_found");
    }
    expect((await nyte.runs.current({ sessionId: parent.sessionId }))?.phase.kind).toBe("done");
    expect(await nyte.jobs.list({ sessionId: parent.sessionId })).toHaveLength(1);
  } finally {
    release.resolve();
    await nyte.close();
  }
});

test("stop_task cannot cancel another session's task", async () => {
  const release = Promise.withResolvers<void>();
  const { nyte } = await open(
    script(({ text, context }) => {
      if (text === "child") return { answer: assistant("child done"), wait: release.promise };
      if (context.messages.at(-1)?.role === "user") {
        if (text === "delegate")
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
        if (text.startsWith("stop "))
          return {
            answer: assistant("", { calls: [call("stop", "stop_task", { jobId: text.slice(5) })] }),
          };
      }
      return { answer: assistant("done") };
    }),
  );
  try {
    const owner = await nyte.sessions.create();
    const other = await nyte.sessions.create();
    nyte.attach();
    await nyte.messages.send({ sessionId: owner.sessionId, content: "delegate" });
    await idle(nyte, owner.sessionId);
    const job = only(await nyte.jobs.list({ sessionId: owner.sessionId }));
    await nyte.messages.send({ sessionId: other.sessionId, content: `stop ${job.id}` });
    await idle(nyte, other.sessionId);
    const stopped = only(await toolParts(nyte, other.sessionId));
    expect(stopped.result?.isError).toBe(true);
    expect(stopped.result?.output).toBe(`Task job not found in this session: ${job.id}`);
    expect(only(await nyte.jobs.list({ sessionId: owner.sessionId })).state).toBe("running");
    release.resolve();
    await expect
      .poll(async () => only(await nyte.jobs.list({ sessionId: owner.sessionId })).state, poll)
      .toBe("completed");
  } finally {
    release.resolve();
    await nyte.close();
  }
});

/** A real process held open by a file, so cancellation cannot pass just by changing job state. */
function shellWork() {
  const path = storePath();
  const cwd = dirname(path);
  const pidPath = join(cwd, "pid");
  const startsPath = join(cwd, "starts");
  writeFileSync(
    join(cwd, "work.cjs"),
    `
    const fs = require('node:fs');
    fs.appendFileSync('starts', 'started\\n');
    fs.writeFileSync('pid.tmp', String(process.pid));
    fs.renameSync('pid.tmp', 'pid');
    process.stdout.write('working\\n');
    const timer = setInterval(() => {
      if (!fs.existsSync('release')) return;
      clearInterval(timer);
      process.stdout.write('command finished\\n');
    }, 10);
  `,
  );
  return {
    command: `exec '${process.execPath.replaceAll("'", "'\\''")}' work.cjs`,
    options: {
      cwd,
      session(api) {
        api.tools.add((draft) => draft.set("bash", createBashTool(cwd)));
      },
    } satisfies NonNullable<Parameters<typeof open>[1]>,
    store: () => openStore(path),
    async started() {
      await expect.poll(() => existsSync(pidPath), poll).toBe(true);
      const pid = Number(readFileSync(pidPath, "utf8"));
      assert.ok(Number.isSafeInteger(pid) && pid > 0);
      return pid;
    },
    starts: () => readFileSync(startsPath, "utf8"),
    release: () => writeFileSync(join(cwd, "release"), ""),
  };
}

function processRunning(pid: number) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ESRCH") return false;
    throw cause;
  }
}

test("stop_task rejects a shell command in the same session without stopping it", async () => {
  const work = shellWork();
  const { nyte } = await open(
    script(({ text, context }) => {
      if (context.messages.at(-1)?.role === "user") {
        if (text === "start command")
          return {
            answer: assistant("", {
              calls: [call("command", "bash", { command: work.command, background: true })],
            }),
          };
        if (text.startsWith("stop "))
          return {
            answer: assistant("", { calls: [call("stop", "stop_task", { jobId: text.slice(5) })] }),
          };
      }
      return { answer: assistant("ready") };
    }),
    { ...work.options, store: work.store() },
  );
  try {
    const parent = await nyte.sessions.create();
    nyte.attach();
    await nyte.messages.send({ sessionId: parent.sessionId, content: "start command" });
    const pid = await work.started();
    await idle(nyte, parent.sessionId);
    const job = only(await nyte.jobs.list({ sessionId: parent.sessionId }));
    expect(job).toMatchObject({ kind: "command", state: "running" });
    expect(processRunning(pid)).toBe(true);

    await nyte.messages.send({ sessionId: parent.sessionId, content: `stop ${job.id}` });
    await idle(nyte, parent.sessionId);
    const stopped = (await toolParts(nyte, parent.sessionId)).find(
      (part) => part.callId === "stop",
    );
    expect(stopped?.result?.isError).toBe(true);
    expect(stopped?.result?.output).toBe(`Task job not found in this session: ${job.id}`);
    expect(only(await nyte.jobs.list({ sessionId: parent.sessionId })).state).toBe("running");
    expect(processRunning(pid)).toBe(true);

    // Successful completion proves the rejected stop left the command able to do more work.
    work.release();
    await expect
      .poll(async () => only(await nyte.jobs.list({ sessionId: parent.sessionId })).state, poll)
      .toBe("completed");
    expect(only(await nyte.jobs.list({ sessionId: parent.sessionId })).output).toContain(
      "command finished",
    );
    await expect.poll(() => processRunning(pid), poll).toBe(false);
  } finally {
    work.release();
    await nyte.close();
  }
});

for (const background of [false, true]) {
  test(`stop_task stops the child's ${background ? "background" : "foreground"} command and stays cancelled after reopen`, async () => {
    const work = shellWork();
    const releaseChild = Promise.withResolvers<void>();
    const streamFn = script(({ text, context }) => {
      if (context.messages.at(-1)?.role === "user") {
        if (text === "delegate")
          return {
            answer: assistant("", {
              calls: [
                call("task", "task", {
                  model: "openai/test-model",
                  prompt: "child",
                  background: true,
                }),
              ],
            }),
          };
        if (text === "child")
          return {
            answer: assistant("", {
              calls: [call("command", "bash", { command: work.command, background })],
            }),
          };
        if (text.startsWith("stop "))
          return {
            answer: assistant("", { calls: [call("stop", "stop_task", { jobId: text.slice(5) })] }),
          };
      }
      // A background command outlives its tool call; keep its owning child run active.
      if (text === "child")
        return { answer: assistant("child finished"), wait: releaseChild.promise };
      return { answer: assistant("parent ready") };
    });
    const { nyte } = await open(streamFn, { ...work.options, store: work.store() });
    try {
      const parent = await nyte.sessions.create();
      nyte.attach();
      await nyte.messages.send({ sessionId: parent.sessionId, content: "delegate" });
      const pid = await work.started();
      await idle(nyte, parent.sessionId);
      const task = only(await nyte.jobs.list({ sessionId: parent.sessionId }));
      assert.equal(task.kind, "subagent");
      const command = only(await nyte.jobs.list({ sessionId: task.childSessionId }));
      expect(command).toMatchObject({
        kind: "command",
        state: "running",
        mode: background ? "background" : "foreground",
      });
      expect(processRunning(pid)).toBe(true);

      await nyte.messages.send({ sessionId: parent.sessionId, content: `stop ${task.id}` });
      await idle(nyte, parent.sessionId);
      const stopped = (await toolParts(nyte, parent.sessionId)).find(
        (part) => part.callId === "stop",
      );
      expect(stopped?.result?.isError ?? false).toBe(false);
      expect(stopped?.result?.output).toBe(`Task ${task.id} stopped.`);
      // Check before host shutdown: close also kills commands and could hide a broken stop.
      await expect.poll(() => processRunning(pid), poll).toBe(false);
      await idle(nyte, task.childSessionId);
      expect(only(await nyte.jobs.list({ sessionId: parent.sessionId })).state).toBe("cancelled");
      expect(only(await nyte.jobs.list({ sessionId: task.childSessionId })).state).toBe(
        "cancelled",
      );
      expect((await nyte.runs.current({ sessionId: task.childSessionId }))?.phase.kind).toBe(
        "aborted",
      );
      await nyte.close();

      const { nyte: reopened } = await open(streamFn, { ...work.options, store: work.store() });
      try {
        reopened.attach({ sessions: [parent.sessionId, task.childSessionId] });
        await reopened.reactivate();
        await idle(reopened, parent.sessionId);
        await idle(reopened, task.childSessionId);
        expect(only(await reopened.jobs.list({ sessionId: parent.sessionId }))).toMatchObject({
          id: task.id,
          state: "cancelled",
        });
        expect(only(await reopened.jobs.list({ sessionId: task.childSessionId }))).toMatchObject({
          id: command.id,
          state: "cancelled",
        });
        expect((await reopened.runs.current({ sessionId: task.childSessionId }))?.phase.kind).toBe(
          "aborted",
        );
        expect(await reopened.messages.pending({ sessionId: task.childSessionId })).toEqual([]);
        expect(work.starts()).toBe("started\n");
        expect(processRunning(pid)).toBe(false);
        await reopened.messages.send({ sessionId: parent.sessionId, content: "continue" });
        await idle(reopened, parent.sessionId);
        expect((await reopened.runs.current({ sessionId: parent.sessionId }))?.phase.kind).toBe(
          "done",
        );
      } finally {
        await reopened.close();
      }
    } finally {
      work.release();
      releaseChild.resolve();
      await nyte.close();
    }
  });
}
