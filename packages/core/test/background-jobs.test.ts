import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { contentText, createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import { isUserJob } from "@nyte-ai/protocol";
import { Type } from "typebox";
import { expect, test } from "vitest";
import { createNyte } from "../src/kernel/sdk/nyte.ts";
import {
  sessionId,
  type Nyte,
  type SessionEvent,
  type SessionId,
} from "../src/kernel/sdk/types.ts";
import { definePlugin, inlinePlugin } from "../src/plugins/index.ts";
import { createBashTool } from "../src/tools/bash.ts";
import { WorkspaceTrustStore } from "../src/workspace-trust.ts";
import type { StreamFn } from "../src/types.ts";
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

function gate() {
  const deferred = Promise.withResolvers<void>();
  return { promise: deferred.promise, release: () => deferred.resolve() };
}

const poll = { timeout: 5_000, interval: 10 };

function alive(pid: number) {
  try {
    process.kill(pid, 0);
    return "alive";
  } catch (cause) {
    if (cause instanceof Error && "code" in cause && cause.code === "ESRCH") return "dead";
    throw cause;
  }
}

async function idle(nyte: Nyte, id: SessionId) {
  await expect
    .poll(async () => (await within(nyte.runs.wait({ sessionId: id }), 5_000)).kind, poll)
    .toBe("idle");
}

/** Gates hold real work open so assertions do not depend on process or provider speed. */
async function fixture(kind: "bash" | "task", background: boolean, continuingParent = false) {
  const path = storePath();
  const cwd = dirname(path);
  const releasePath = join(cwd, "release");
  const startsPath = join(cwd, "starts");
  const pidPath = join(cwd, "pid");
  writeFileSync(
    join(cwd, "work.cjs"),
    `
    const fs = require('node:fs');
    fs.appendFileSync('starts', 'start\\n');
    fs.writeFileSync('pid', String(process.pid));
    process.stdout.write('working\\n');
    const timer = setInterval(() => {
      if (!fs.existsSync('release')) return;
      clearInterval(timer);
      process.stdout.write('job-result\\n');
    }, 10);
  `,
  );
  const childGate = gate();
  const parentGate = gate();
  const parent = sessionId("jobs-parent");
  const requests: { text: string; tools: readonly string[] }[] = [];
  const resolved: SessionId[] = [];
  const command = `exec '${process.execPath.replaceAll("'", "'\\''")}' work.cjs`;
  const streamFn: StreamFn = (_model, context, options) => {
    const tail = context.messages.slice(
      context.messages.findLastIndex((message) => message.role === "user"),
    );
    const user = tail[0];
    const text = user?.role === "user" ? contentText(user.content) : "";
    requests.push({ text, tools: (context.tools ?? []).map((tool) => tool.name) });
    const result = tail.find((message) => message.role === "toolResult");
    const answer =
      text === "start" && result === undefined
        ? assistant("", {
            calls: [
              call(
                "work",
                kind,
                kind === "task"
                  ? { model: "openai/test-model", prompt: "child-work", background }
                  : { command, background },
              ),
            ],
          })
        : continuingParent &&
            text === "start" &&
            !tail.some(
              (message) => message.role === "toolResult" && message.toolName === "checkpoint",
            )
          ? assistant("parent-still-working", { calls: [call("next", "checkpoint", {})] })
          : assistant(
              text === "child-work"
                ? "job-result"
                : text.startsWith("Background ")
                  ? "received job-result"
                  : "parent-finished",
            );
    const waiting =
      text === "child-work"
        ? childGate.promise
        : text === "start" && result !== undefined
          ? parentGate.promise
          : Promise.resolve();
    const stream = createAssistantMessageEventStream();
    const signal = options?.signal;
    const aborted = gate();
    const onAbort = () => aborted.release();
    if (signal?.aborted) onAbort();
    else signal?.addEventListener("abort", onAbort, { once: true });
    void Promise.race([waiting, aborted.promise]).then(() => {
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
  const plugins = [
    inlinePlugin(
      definePlugin({
        id: "job-test-tools",
        session(api) {
          api.agents.add((draft) => draft.set("worker", { id: "worker", mode: "subagent" }));
          api.tools.add((draft) => {
            draft.set("bash", createBashTool(cwd));
            draft.set("checkpoint", {
              name: "checkpoint",
              description: "Continue the parent run",
              parameters: Type.Object({}),
              execute: async () => ({
                content: [{ type: "text", text: "continued" }],
                details: {},
              }),
            });
            // Foreground availability, not the tool's name, determines background availability.
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
  ];
  const open = () =>
    createNyte({
      store: openStore(path),
      streamFn,
      model,
      models: {
        getModels: () => [model],
        getModel: () => model,
        getAvailable: async () => [model],
      },
      resolveActivation(target) {
        if (target.kind === "session") resolved.push(target.sessionId);
        return target.kind === "session" && target.sessionId === parent
          ? { kind: "active", plugins, env: { cwd } }
          : { kind: "requires", requirement: { kind: "workspace_trust", cwd } };
      },
    });
  const nyte = await open();
  await nyte.sessions.create({ sessionId: parent });
  nyte.attach({ sessions: [parent] });
  const events: SessionEvent[] = [];
  const watching = new AbortController();
  const watch = (async () => {
    for await (const event of nyte.watch({ sessionId: parent, signal: watching.signal }))
      events.push(event);
  })();
  return {
    cwd,
    nyte,
    parent,
    open,
    requests,
    resolved,
    events,
    parentGate,
    release() {
      childGate.release();
      writeFileSync(releasePath, "");
    },
    async start() {
      await nyte.messages.send({ sessionId: parent, content: "start" });
      await expect
        .poll(async () => (await nyte.jobs.list({ sessionId: parent })).length, poll)
        .toBe(1);
      if (kind === "bash") await expect.poll(() => existsSync(pidPath), poll).toBe(true);
      else
        await expect
          .poll(() => requests.filter((request) => request.text === "child-work").length, poll)
          .toBe(1);
      return only(await nyte.jobs.list({ sessionId: parent }));
    },
    async reload() {
      await nyte.setPlugins(plugins);
    },
    executions() {
      return kind === "bash"
        ? readFileSync(startsPath, "utf8").trim().split("\n").length
        : requests.filter((request) => request.text === "child-work").length;
    },
    pid() {
      return Number(readFileSync(pidPath, "utf8"));
    },
    async close() {
      watching.abort();
      parentGate.release();
      try {
        await nyte.close();
      } finally {
        childGate.release();
        await watch;
      }
    },
  };
}

for (const kind of ["bash", "task"] as const) {
  for (const background of [false, true]) {
    test(`${kind}: ${background ? "background:true" : "park then background"} delivers once at the next response without interrupting streaming or queuing user input`, async () => {
      const f = await fixture(kind, background, true);
      try {
        expect(await f.nyte.jobs.list({ sessionId: f.parent })).toEqual([]);
        const job = await f.start();
        expect(job).toMatchObject({
          mode: background ? "background" : "foreground",
          state: "running",
          callId: "work",
          head: "main",
          kind: kind === "bash" ? "command" : "subagent",
        });
        if (!background) {
          expect((await within(f.nyte.runs.wait({ sessionId: f.parent }), 5_000)).kind).toBe(
            "waiting",
          );
          expect((await f.nyte.sessions.snapshot({ sessionId: f.parent }))?.parked).toEqual(
            expect.arrayContaining([expect.objectContaining({ callId: "work", tool: kind })]),
          );
          expect(await f.nyte.jobs.background({ sessionId: f.parent, jobId: job.id })).toEqual({
            kind: "applied",
          });
        }
        await expect
          .poll(() => f.requests.filter((request) => request.text === "start").length, poll)
          .toBe(2);
        expect(await f.nyte.jobs.background({ sessionId: f.parent, jobId: job.id })).toEqual({
          kind: "applied",
        });
        expect(await f.nyte.jobs.list({ sessionId: f.parent, head: "other" })).toEqual([]);
        f.release();
        await expect
          .poll(async () => only(await f.nyte.jobs.list({ sessionId: f.parent })).state, poll)
          .toBe("completed");
        expect(await f.nyte.messages.pending({ sessionId: f.parent })).toEqual([]);
        expect((await f.nyte.sessions.snapshot({ sessionId: f.parent }))?.pending).toEqual([]);
        expect(f.requests.filter((request) => request.text.startsWith("Background "))).toHaveLength(
          0,
        );
        expect((await f.nyte.runs.current({ sessionId: f.parent }))?.phase.kind).toBe("respond");
        expect(only(await f.nyte.jobs.list({ sessionId: f.parent })).output).toContain(
          "job-result",
        );
        f.parentGate.release();
        await idle(f.nyte, f.parent);
        await f.nyte.reactivate();
        await idle(f.nyte, f.parent);
        expect(f.requests.filter((request) => request.text.startsWith("Background "))).toHaveLength(
          1,
        );
        expect(f.executions()).toBe(1);
        expect(await f.nyte.jobs.background({ sessionId: f.parent, jobId: job.id })).toEqual({
          kind: "finished",
        });
        expect(await f.nyte.jobs.cancel({ sessionId: f.parent, jobId: job.id })).toEqual({
          kind: "finished",
        });
        await expect
          .poll(
            () =>
              f.events.some(
                (event) =>
                  event.kind === "job" &&
                  event.job.id === job.id &&
                  event.job.state === "completed" &&
                  event.job.output.includes("job-result"),
              ),
            poll,
          )
          .toBe(true);
        expect(
          f.events.some(
            (event) =>
              event.kind === "job" && event.job.id === job.id && event.job.state === "running",
          ),
        ).toBe(true);
        expect(
          f.events.filter((event) => event.kind === "queued" && event.item.lane === "background"),
        ).toHaveLength(0);
        expect((await f.nyte.runs.current({ sessionId: f.parent }))?.runId).toBe(job.runId);
        const transcript = await f.nyte.messages.list({ sessionId: f.parent });
        expect(
          transcript.flatMap((turn) =>
            turn.kind === "turn" ? turn.parts.filter((part) => part.kind === "user") : [],
          ),
        ).toEqual([expect.objectContaining({ kind: "user", content: "start" })]);
        await f.close();
        const reopened = await f.open();
        try {
          reopened.attach({ sessions: [f.parent] });
          await reopened.reactivate();
          await idle(reopened, f.parent);
          expect(only(await reopened.jobs.list({ sessionId: f.parent }))).toMatchObject({
            id: job.id,
            state: "completed",
            mode: "background",
          });
          expect(await reopened.messages.list({ sessionId: f.parent })).toEqual(transcript);
          expect(
            f.requests.filter((request) => request.text.startsWith("Background ")),
          ).toHaveLength(1);
          expect(f.executions()).toBe(1);
        } finally {
          await reopened.close();
        }
      } finally {
        await f.close();
      }
    }, 15_000);

    test(`${kind}: runs.abort cancels ${background ? "background" : "parked foreground"} work the run owns`, async () => {
      const f = await fixture(kind, background);
      try {
        const job = await f.start();
        if (background)
          await expect
            .poll(() => f.requests.filter((request) => request.text === "start").length, poll)
            .toBe(2);
        else
          expect((await within(f.nyte.runs.wait({ sessionId: f.parent }), 5_000)).kind).toBe(
            "waiting",
          );
        expect((await f.nyte.runs.abort({ sessionId: f.parent })).kind).toBe("requested");
        await idle(f.nyte, f.parent);
        expect
          .soft((await f.nyte.runs.current({ sessionId: f.parent }))?.phase)
          .toEqual({ kind: "aborted" });
        expect.soft(only(await f.nyte.jobs.list({ sessionId: f.parent })).state).toBe("cancelled");
        if (job.kind === "command") {
          await expect.poll(() => alive(f.pid()), poll).toBe("dead");
        } else {
          await idle(f.nyte, job.childSessionId);
          expect((await f.nyte.runs.current({ sessionId: job.childSessionId }))?.phase.kind).toBe(
            "aborted",
          );
          await expect
            .poll(
              () =>
                f.events.some(
                  (event) =>
                    event.kind === "job" &&
                    event.job.id === job.id &&
                    event.job.state === "cancelled",
                ),
              poll,
            )
            .toBe(true);
        }
      } finally {
        await f.close();
      }
    }, 15_000);
  }

  test(`${kind}: close/reopen retains interrupted jobs without replaying work or redelivering completion`, async () => {
    const f = await fixture(kind, true);
    try {
      const job = await f.start();
      f.parentGate.release();
      await idle(f.nyte, f.parent);
      await f.close();
      const reopened = await f.open();
      try {
        expect(only(await reopened.jobs.list({ sessionId: f.parent }))).toMatchObject({
          id: job.id,
          state: "interrupted",
        });
        reopened.attach({ sessions: [f.parent] });
        await expect
          .poll(
            () => f.requests.filter((request) => request.text.startsWith("Background ")).length,
            poll,
          )
          .toBe(1);
        await idle(reopened, f.parent);
        expect(f.executions()).toBe(1);
        expect(only(await reopened.jobs.list({ sessionId: f.parent })).state).toBe("interrupted");
      } finally {
        await reopened.close();
      }
      const again = await f.open();
      try {
        again.attach({ sessions: [f.parent] });
        await again.reactivate();
        await idle(again, f.parent);
        expect(f.requests.filter((request) => request.text.startsWith("Background "))).toHaveLength(
          1,
        );
        expect(f.executions()).toBe(1);
      } finally {
        await again.close();
      }
    } finally {
      await f.close();
    }
  }, 15_000);
}

for (const background of [false, true]) {
  test(`task background=${background}: child inherits trust and ${background ? "cannot" : "can"} ask questions`, async () => {
    const f = await fixture("task", background);
    try {
      const job = await f.start();
      assert.equal(job.kind, "subagent");
      const child = await f.nyte.sessions.get({ sessionId: job.childSessionId });
      expect(child?.activation).toEqual({ kind: "active" });
      expect(f.resolved).toEqual([f.parent]);
      expect(
        only(f.requests.filter((request) => request.text === "child-work")).tools.includes(
          "clarify",
        ),
      ).toBe(!background);
      expect(only(f.requests.filter((request) => request.text === "child-work")).tools).toContain(
        "bash",
      );
      expect(f.requests[0]?.tools).toContain("clarify");
      f.release();
      f.parentGate.release();
      await expect
        .poll(async () => only(await f.nyte.jobs.list({ sessionId: f.parent })).state, poll)
        .toBe("completed");
      await idle(f.nyte, f.parent);
    } finally {
      await f.close();
    }
  }, 15_000);
}

test("jobs.cancel kills the local process and publishes cancelled output", async () => {
  const f = await fixture("bash", true);
  try {
    expect(await f.nyte.jobs.background({ sessionId: f.parent, jobId: "missing" })).toEqual({
      kind: "not_found",
    });
    expect(await f.nyte.jobs.cancel({ sessionId: f.parent, jobId: "missing" })).toEqual({
      kind: "not_found",
    });
    const job = await f.start();
    const pid = f.pid();
    process.kill(pid, 0);
    await expect
      .poll(async () => only(await f.nyte.jobs.list({ sessionId: f.parent })).output, poll)
      .toContain("working");
    expect(await f.nyte.jobs.cancel({ sessionId: f.parent, jobId: job.id })).toEqual({
      kind: "applied",
    });
    await expect.poll(() => alive(pid), poll).toBe("dead");
    expect(only(await f.nyte.jobs.list({ sessionId: f.parent })).state).toBe("cancelled");
    await expect
      .poll(
        () =>
          f.events.some(
            (event) =>
              event.kind === "job" && event.job.id === job.id && event.job.state === "cancelled",
          ),
        poll,
      )
      .toBe(true);
    f.parentGate.release();
    await idle(f.nyte, f.parent);
    expect(
      only(f.requests.filter((request) => request.text.startsWith("Background "))).text,
    ).toContain("cancelled");
    expect(f.executions()).toBe(1);
  } finally {
    await f.close();
  }
}, 15_000);

test("a user job runs without a run: streams, lists, backgrounds, cancels, survives an abort, and is interrupted by close", async () => {
  const f = await fixture("bash", false);
  const command = `exec '${process.execPath.replaceAll("'", "'\\''")}' work.cjs`;
  try {
    const job = await f.nyte.jobs.start({ sessionId: f.parent, command });
    expect(job).toMatchObject({
      kind: "command",
      callId: job.id,
      head: "main",
      title: command,
      mode: "foreground",
      state: "running",
    });
    expect(isUserJob(job)).toBe(true);
    await expect
      .poll(async () => only(await f.nyte.jobs.list({ sessionId: f.parent })).output, poll)
      .toContain("working");
    const pid = f.pid();
    await expect
      .poll(
        () =>
          f.events.some(
            (event) =>
              event.kind === "job" &&
              event.job.id === job.id &&
              event.job.state === "running" &&
              event.job.output.includes("working"),
          ),
        poll,
      )
      .toBe(true);
    expect(
      f.events.some((event) => event.kind === "tool_progress" && event.callId === job.callId),
    ).toBe(false);
    // Aborting a run the user's job does not belong to leaves the job alone.
    await f.nyte.messages.send({ sessionId: f.parent, content: "child-work" });
    await expect
      .poll(() => f.requests.filter((request) => request.text === "child-work").length, poll)
      .toBe(1);
    expect((await f.nyte.runs.abort({ sessionId: f.parent })).kind).toBe("requested");
    await idle(f.nyte, f.parent);
    const abortedRun = await f.nyte.runs.current({ sessionId: f.parent });
    expect(abortedRun?.phase).toEqual({ kind: "aborted" });
    expect(abortedRun?.runId).not.toBe(job.runId);
    expect(only(await f.nyte.jobs.list({ sessionId: f.parent })).state).toBe("running");
    expect(alive(pid)).toBe("alive");
    expect(await f.nyte.jobs.background({ sessionId: f.parent, jobId: job.id })).toEqual({
      kind: "applied",
    });
    expect(only(await f.nyte.jobs.list({ sessionId: f.parent })).mode).toBe("background");
    expect(await f.nyte.jobs.cancel({ sessionId: f.parent, jobId: job.id })).toEqual({
      kind: "applied",
    });
    await expect.poll(() => alive(pid), poll).toBe("dead");
    expect(only(await f.nyte.jobs.list({ sessionId: f.parent })).state).toBe("cancelled");
    // A user job is never a completion: no background lane item, no model turn.
    expect(await f.nyte.messages.pending({ sessionId: f.parent })).toEqual([]);
    expect(
      f.events.filter((event) => event.kind === "queued" && event.item.lane === "background"),
    ).toHaveLength(0);
    expect(f.requests.filter((request) => request.text.startsWith("Background "))).toEqual([]);

    const completed = await f.nyte.jobs.start({
      sessionId: f.parent,
      command: "printf 'natural\\n'",
    });
    await expect
      .poll(
        async () =>
          (await f.nyte.jobs.list({ sessionId: f.parent })).find((item) => item.id === completed.id)
            ?.state,
        poll,
      )
      .toBe("completed");
    expect(
      (await f.nyte.jobs.list({ sessionId: f.parent })).find((item) => item.id === completed.id),
    ).toMatchObject({ state: "completed", output: "natural\n" });

    const failed = await f.nyte.jobs.start({
      sessionId: f.parent,
      command: "printf 'failure\\n'; exit 7",
    });
    await expect
      .poll(
        async () =>
          (await f.nyte.jobs.list({ sessionId: f.parent })).find((item) => item.id === failed.id)
            ?.state,
        poll,
      )
      .toBe("failed");
    const failedJob = (await f.nyte.jobs.list({ sessionId: f.parent })).find(
      (item) => item.id === failed.id,
    );
    expect(failedJob?.state).toBe("failed");
    expect(failedJob?.output).toContain("failure");
    expect(failedJob?.output).toMatch(/Command exited with code 7$/u);

    const truncated = await f.nyte.jobs.start({
      sessionId: f.parent,
      command: `exec '${process.execPath.replaceAll("'", "'\\''")}' -e "process.stdout.write('x'.repeat(60000))"`,
    });
    await expect
      .poll(
        async () =>
          (await f.nyte.jobs.list({ sessionId: f.parent })).find((item) => item.id === truncated.id)
            ?.state,
        poll,
      )
      .toBe("completed");
    const truncatedOutput = (await f.nyte.jobs.list({ sessionId: f.parent })).find(
      (item) => item.id === truncated.id,
    )?.output;
    expect(truncatedOutput?.length).toBeLessThanOrEqual(50_000);
    expect(truncatedOutput).toContain("[Showing last");

    const second = await f.nyte.jobs.start({ sessionId: f.parent, command });
    await expect
      .poll(
        async () =>
          (await f.nyte.jobs.list({ sessionId: f.parent })).find((item) => item.id === second.id)
            ?.output,
        poll,
      )
      .toContain("working");
    await f.close();
    const reopened = await f.open();
    try {
      const reopenedJobs = await reopened.jobs.list({ sessionId: f.parent });
      expect(reopenedJobs).toHaveLength(5);
      expect(reopenedJobs).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ id: job.id, state: "cancelled" }),
          expect.objectContaining({ id: completed.id, state: "completed", output: "natural\n" }),
          expect.objectContaining({ id: failed.id, state: "failed" }),
          expect.objectContaining({ id: truncated.id, state: "completed" }),
          expect.objectContaining({ id: second.id, state: "interrupted" }),
        ]),
      );
    } finally {
      await reopened.close();
    }
  } finally {
    await f.close();
  }
}, 20_000);

for (const kind of ["bash", "task"] as const) {
  test(`${kind}: foreground work waits and returns a normal tool result, including after plugin reload`, async () => {
    const f = await fixture(kind, false);
    try {
      const job = await f.start();
      expect((await within(f.nyte.runs.wait({ sessionId: f.parent }), 5_000)).kind).toBe("waiting");
      expect(f.requests.filter((request) => request.text === "start")).toHaveLength(1);
      await f.reload();
      f.parentGate.release();
      f.release();
      await expect
        .poll(async () => only(await f.nyte.jobs.list({ sessionId: f.parent })).state, poll)
        .toBe("completed");
      await idle(f.nyte, f.parent);
      const transcript = await f.nyte.messages.list({ sessionId: f.parent });
      const parts = transcript.flatMap((turn) => (turn.kind === "turn" ? turn.parts : []));
      expect(
        parts.find((part) => part.kind === "tool" && part.callId === job.callId),
      ).toMatchObject({
        result: { output: expect.stringContaining("job-result"), isError: false },
      });
      expect(f.requests.filter((request) => request.text.startsWith("Background "))).toEqual([]);
      expect(f.requests.filter((request) => request.text === "start")).toHaveLength(2);
      expect(f.executions()).toBe(1);
    } finally {
      await f.close();
    }
  });

  test(`${kind}: an idle parent cannot relocate while background work is running`, async () => {
    const f = await fixture(kind, true);
    const destination = dirname(storePath());
    const workspace = await new WorkspaceTrustStore(join(destination, "trust.json")).trust(
      destination,
    );
    try {
      const job = await f.start();
      f.parentGate.release();
      await idle(f.nyte, f.parent);
      expect((await f.nyte.runs.current({ sessionId: f.parent }))?.phase.kind).toBe("done");
      expect(await f.nyte.relocate({ sessionId: f.parent, workspace, plugins: [] })).toEqual({
        kind: "busy",
      });
      expect(await f.nyte.sessionCwd({ sessionId: f.parent })).toBe(f.cwd);
      expect(only(await f.nyte.jobs.list({ sessionId: f.parent })).state).toBe("running");
      f.release();
      await expect
        .poll(async () => only(await f.nyte.jobs.list({ sessionId: f.parent })).state, poll)
        .toBe("completed");
      await idle(f.nyte, f.parent);
      if (job.kind === "subagent") await idle(f.nyte, job.childSessionId);
      await expect
        .poll(() => f.nyte.relocate({ sessionId: f.parent, workspace, plugins: [] }), poll)
        .toEqual({ kind: "relocated" });
    } finally {
      await f.close();
    }
  }, 15_000);
}
