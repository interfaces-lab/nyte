/**
 * The bound turn: the agent loop over a real store, with the effect sandwich
 * around every tool call. The provider is a script; the tools are real
 * functions.
 */
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { NOOP_TELEMETRY_CONTEXT } from "@nyte-ai/telemetry";
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type Model,
} from "@nyte-ai/ai";
import { Type } from "typebox";
import { bindTool } from "../../src/tools/bind-tool.ts";
import { createAllTools } from "../../src/tools/index.ts";
import { createJobs } from "../../src/kernel/sdk/jobs.ts";
import { sessionId } from "../../src/kernel/sdk/types.ts";
import { openEffect, readEffect, signalEffect } from "../../src/kernel/effects.ts";
import type { Commit, EventBody, Lease, Run } from "../../src/kernel/model.ts";
import { effectPrefix, headRef } from "../../src/kernel/names.ts";
import type { Session } from "../../src/kernel/store.ts";
import { bindTurn, type Turn, type TurnInput, type TurnOptions } from "../../src/kernel/turn.ts";
import { ToolWait, type AgentTool, type StreamFn } from "../../src/types.ts";
import {
  assistant,
  call,
  commit,
  lease,
  message,
  openSession,
  storePath,
  user,
  within,
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
  contextWindow: 100_000,
  maxTokens: 1_000,
};

const parameters = Type.Object({ value: Type.String() });
type TestTool = AgentTool<typeof parameters>;

interface ProviderScript {
  readonly streamFn: StreamFn;
  requests: number;
}

/** A provider that answers each request from a script; stream events arrive on the next tick. */
function scripted(answers: readonly AssistantMessage[]): ProviderScript {
  const queue = [...answers];
  const script = {
    requests: 0,
    streamFn: ((): StreamFn => () => {
      script.requests += 1;
      const answer = queue.shift();
      if (answer === undefined) throw new Error("the script ran out of answers");
      const stream = createAssistantMessageEventStream();
      queueMicrotask(() => {
        if (answer.stopReason === "error" || answer.stopReason === "aborted") {
          stream.push({ type: "error", reason: answer.stopReason, error: answer });
          return;
        }
        if (answer.stopReason === "pending") throw new Error("pending is not terminal");
        stream.push({ type: "start", partial: { ...answer, content: [] } });
        for (const [index, part] of answer.content.entries()) {
          if (part.type === "text") {
            stream.push({
              type: "text_delta",
              contentIndex: index,
              delta: part.text,
              partial: answer,
            });
          } else if (part.type === "thinking") {
            stream.push({
              type: "thinking_delta",
              contentIndex: index,
              delta: part.thinking,
              partial: answer,
            });
          }
        }
        stream.push({ type: "done", reason: answer.stopReason, message: answer });
      });
      return stream;
    })(),
  };
  return script;
}

interface Bench {
  readonly session: Session;
  readonly lease: Lease;
  readonly events: EventBody[];
  readonly run: Run;
  input(options?: {
    readonly signal?: AbortSignal;
    readonly abort?: true;
    readonly attempts?: number;
    readonly now?: number;
  }): TurnInput;
}

async function bench(): Promise<Bench> {
  const session = await openSession();
  const held = await lease(session, "main");
  const events: EventBody[] = [];
  const run: Run = {
    kind: "run",
    id: "run_1",
    head: "main",
    phase: { kind: "respond" },
    startedAt: 1,
    attempts: 0,
    config: {},
  };
  const opening: Commit = commit(null, message(user("hello")));
  return {
    session,
    lease: held,
    events,
    run,
    input: (options = {}) => {
      const activeRun: Run = options.abort
        ? {
            ...run,
            attempts: options.attempts ?? 0,
            abortRequested: true,
          }
        : {
            ...run,
            attempts: options.attempts ?? 0,
          };
      return {
        session,
        telemetry: NOOP_TELEMETRY_CONTEXT,
        lease: held,
        run: activeRun,
        now: options.now ?? 1,
        attempt: (options.attempts ?? 0) + 1,
        commits: [{ oid: "opening", commit: opening }],
        emit: (event) => events.push(event),
        signal: options.signal ?? new AbortController().signal,
      };
    },
  };
}

function tool(
  execute: TestTool["execute"],
  extra: Partial<Pick<TestTool, "replay" | "wake">> = {},
): AgentTool {
  return bindTool({ name: "test", description: "a test tool", parameters, execute, ...extra });
}

function turnWith(
  streamFn: StreamFn,
  tools: readonly AgentTool[] = [],
  options: Partial<TurnOptions> = {},
): Turn {
  return bindTurn({ streamFn, model, systemPrompt: "system", tools, ...options });
}

const askTool = (id = "call-1", value = "input") =>
  assistant("", { calls: [call(id, "test", { value })] });

async function effectState(session: Session, callId = "call-1"): Promise<string | undefined> {
  return (await readEffect(session, { runId: "run_1", callId }))?.effect.state;
}

test("a response streams its text and thinking as deltas and comes back complete", async () => {
  const b = await bench();
  const answer: AssistantMessage = {
    ...assistant("hello there"),
    content: [
      { type: "thinking", thinking: "hmm" },
      { type: "text", text: "hello there" },
    ],
  };
  let seen: { systemPrompt?: string; messages: number } | undefined;
  const script = scripted([answer]);
  const streamFn: StreamFn = (requested, context, options) => {
    seen = { systemPrompt: context.systemPrompt, messages: context.messages.length };
    assert.equal(requested.id, model.id);
    return script.streamFn(requested, context, options);
  };
  const outcome = await turnWith(streamFn).respond(b.input());
  assert.equal(outcome.kind, "complete");
  assert.deepEqual(seen, { systemPrompt: "system", messages: 1 });
  assert.deepEqual(
    b.events.map((event) =>
      event.kind === "delta" ? `${event.part}:${event.delta}@${event.attempt}` : event.kind,
    ),
    ["thinking:hmm@1", "text:hello there@1"],
  );
});

test("a response with tool calls asks for the tool phase; a failed provider retries, then gives up", async () => {
  const b = await bench();
  const calls = await turnWith(scripted([askTool()]).streamFn).respond(b.input());
  assert.equal(calls.kind, "tools");

  const failing = scripted([
    assistant("", { stop: "error", error: "rate limited" }),
    assistant("", { stop: "error", error: "rate limited" }),
  ]);
  const turn = turnWith(failing.streamFn, [], {
    retry: { enabled: true, maxRetries: 1, baseDelayMs: 10 },
  });
  const first = await turn.respond(b.input({ attempts: 0 }));
  assert.equal(first.kind, "retry");
  if (first.kind === "retry") assert.ok(first.at > Date.now() - 1);
  const second = await turn.respond(b.input({ attempts: 1 }));
  assert.equal(second.kind, "failed");
  if (second.kind === "failed") assert.match(second.error, /rate limited/u);

  const aborted = await turnWith(scripted([assistant("", { stop: "aborted" })]).streamFn).respond(
    b.input(),
  );
  assert.equal(aborted.kind, "aborted");
});

test("a tool runs once inside its effect, reports progress, and settles with its result", async () => {
  const b = await bench();
  let executions = 0;
  const turn = turnWith(scripted([]).streamFn, [
    tool(async (_id, params, _signal, onUpdate) => {
      executions += 1;
      onUpdate?.({ content: [{ type: "text", text: "half" }], details: {} });
      return { content: [{ type: "text", text: `got ${params.value}` }], details: { ok: true } };
    }),
  ]);
  const outcome = await turn.tools({ ...b.input(), assistant: askTool() });
  assert.equal(outcome.kind, "complete");
  if (outcome.kind !== "complete") return;
  assert.equal(outcome.messages[0]?.toolCallId, "call-1");
  assert.equal(
    outcome.messages[0]?.content[0]?.type === "text" ? outcome.messages[0].content[0].text : "",
    "got input",
  );
  assert.equal(executions, 1);
  assert.equal(await effectState(b.session), "result");
  assert.deepEqual(
    b.events.map((event) => (event.kind === "progress" ? event.progress.text : event.kind)),
    ["half"],
  );

  const again = await turn.tools({ ...b.input(), assistant: askTool() });
  assert.equal(again.kind, "complete");
  assert.equal(executions, 1, "a settled effect is reused, never re-run");
});

test("after-tool patches survive a waiting sibling and recovery without running the hook again", async () => {
  const b = await bench();
  let executions = 0;
  const finalizedCalls: string[] = [];
  const patchedUsage = assistant("").usage;
  const tools = [
    tool(
      async (id, params) => {
        if (id === "waiting") throw new ToolWait();
        executions += 1;
        assert.equal(params.value, "approved");
        return { content: [{ type: "text", text: "private output" }], details: { private: true } };
      },
      {
        wake: async () => ({
          kind: "settle",
          result: { content: [{ type: "text", text: "private reply" }], details: {} },
        }),
      },
    ),
  ];
  const options: Partial<TurnOptions> = {
    loop: {
      beforeToolCall: async () => ({ args: { value: "approved" } }),
      afterToolCall: async ({ toolCall, args }) => {
        assert.deepEqual(args, { value: "approved" });
        finalizedCalls.push(toolCall.id);
        return {
          content: [{ type: "text", text: `public ${toolCall.id}` }],
          details: { public: true },
          isError: true,
          usage: patchedUsage,
        };
      },
    },
  };
  const requested = assistant("", {
    calls: [call("settled", "test", { value: "raw" }), call("waiting", "test", { value: "raw" })],
  });
  const first = await turnWith(scripted([]).streamFn, tools, options).tools({
    ...b.input(),
    assistant: requested,
  });
  assert.deepEqual(first, { kind: "waiting", calls: ["waiting"] });
  const stored = (await readEffect(b.session, { runId: "run_1", callId: "settled" }))?.effect;
  assert.ok(stored?.state === "result");
  assert.deepEqual(stored.result.content, [{ type: "text", text: "public settled" }]);
  assert.deepEqual(stored.result.details, { public: true });
  assert.equal(stored.result.isError, true);
  assert.deepEqual(stored.result.usage, patchedUsage);

  await signalEffect(b.session, { runId: "run_1", callId: "waiting", signal: "yes" });
  const recovered = turnWith(scripted([]).streamFn, tools, options);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const outcome = await recovered.tools({ ...b.input(), assistant: requested });
    assert.ok(outcome.kind === "complete");
    assert.deepEqual(
      outcome.messages.map((result) => ({
        content: result.content,
        details: result.details,
        isError: result.isError,
        usage: result.usage,
      })),
      ["settled", "waiting"].map((id) => ({
        content: [{ type: "text", text: `public ${id}` }],
        details: { public: true },
        isError: true,
        usage: patchedUsage,
      })),
    );
  }
  assert.equal(executions, 1);
  assert.deepEqual(finalizedCalls, ["settled", "waiting"]);
});

test("an after-tool hook failure is the durable result on recovery", async () => {
  const b = await bench();
  let hooks = 0;
  const turn = turnWith(
    scripted([]).streamFn,
    [tool(async () => ({ content: [{ type: "text", text: "private output" }], details: {} }))],
    {
      loop: {
        afterToolCall: async () => {
          hooks += 1;
          throw new Error("redaction failed");
        },
      },
    },
  );
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const outcome = await turn.tools({ ...b.input(), assistant: askTool() });
    assert.ok(outcome.kind === "complete");
    assert.equal(outcome.messages[0]?.isError, true);
    assert.match(JSON.stringify(outcome.messages[0]?.content), /redaction failed/u);
    assert.doesNotMatch(JSON.stringify(outcome.messages[0]?.content), /private output/u);
  }
  assert.equal(hooks, 1);
});

test("a fenced final settlement fences the batch instead of publishing a completed result", async () => {
  const b = await bench();
  const turn = turnWith(
    scripted([]).streamFn,
    [tool(async () => ({ content: [{ type: "text", text: "finished" }], details: {} }))],
    {
      loop: {
        afterToolCall: async () => {
          await b.session.leases.release(b.lease);
          await lease(b.session, "main");
          return undefined;
        },
      },
    },
  );
  const outcome = await turn.tools({ ...b.input(), assistant: askTool() });
  assert.deepEqual(outcome, { kind: "fenced" });
  assert.equal(await effectState(b.session), "intent");
});

test("a failed settlement stays handled while a later policy decision is pending", async () => {
  const b = await bench();
  const fenced = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  const turn = turnWith(
    scripted([]).streamFn,
    [tool(async () => ({ content: [{ type: "text", text: "finished" }], details: {} }))],
    {
      loop: {
        beforeToolCall: async ({ toolCall }) => {
          if (toolCall.id === "later") {
            await release.promise;
            return { block: true, reason: "rejected by policy" };
          }
          return undefined;
        },
        afterToolCall: async () => {
          await b.session.leases.release(b.lease);
          await lease(b.session, "main");
          fenced.resolve();
          return undefined;
        },
      },
    },
  );
  const batch = turn.tools({
    ...b.input(),
    assistant: assistant("", {
      calls: [call("first", "test", { value: "x" }), call("later", "test", { value: "y" })],
    }),
  });
  try {
    await within(fenced.promise);
    await new Promise<void>((resolve) => setImmediate(resolve));
  } finally {
    release.resolve();
  }
  const outcome = await within(batch);
  assert.deepEqual(outcome, { kind: "fenced" });
});

test("a tool that throws settles an error; a truncated batch fails without touching any effect", async () => {
  const b = await bench();
  const throwing = turnWith(scripted([]).streamFn, [
    tool(async () => {
      throw new Error("disk on fire");
    }),
  ]);
  const outcome = await throwing.tools({ ...b.input(), assistant: askTool() });
  assert.equal(outcome.kind, "complete");
  if (outcome.kind === "complete") {
    assert.equal(outcome.messages[0]?.isError, true);
    assert.match(JSON.stringify(outcome.messages[0]?.content), /disk on fire/u);
  }
  assert.equal(await effectState(b.session), "result");

  const truncated = await throwing.tools({
    ...b.input(),
    assistant: { ...askTool("call-2"), stopReason: "length" },
  });
  assert.equal(truncated.kind, "complete");
  if (truncated.kind === "complete") assert.equal(truncated.messages[0]?.isError, true);
  assert.equal(await effectState(b.session, "call-2"), undefined);
});

test("after a crash, an intent replays only when its tool says that is safe", async () => {
  const b = await bench();
  let executions = 0;
  const execute: TestTool["execute"] = async () => {
    executions += 1;
    return { content: [{ type: "text", text: "ran" }], details: {} };
  };
  for (const [callId, replay] of [
    ["safe-1", "safe"],
    ["never-1", "never"],
  ] as const) {
    await openEffect(b.session, {
      lease: b.lease,
      runId: "run_1",
      callId,
      tool: "test",
      args: { value: "x" },
      replay,
    });
  }
  const safe = await turnWith(scripted([]).streamFn, [tool(execute, { replay: "safe" })]).tools({
    ...b.input(),
    assistant: askTool("safe-1", "x"),
  });
  assert.equal(safe.kind, "complete");
  assert.equal(executions, 1);

  const never = await turnWith(scripted([]).streamFn, [tool(execute, { replay: "never" })]).tools({
    ...b.input(),
    assistant: askTool("never-1", "x"),
  });
  assert.equal(never.kind, "complete");
  assert.equal(executions, 1);
  if (never.kind === "complete") {
    assert.equal(never.messages[0]?.isError, true);
    assert.match(JSON.stringify(never.messages[0]?.content), /interrupted/u);
  }
});

test("a tool that waits parks its call, wakes with the reply, and settles exactly once", async () => {
  const b = await bench();
  let wakes = 0;
  const asking = turnWith(scripted([]).streamFn, [
    tool(
      async () => {
        throw new ToolWait();
      },
      {
        wake: async (_call, context) => {
          wakes += 1;
          return {
            kind: "settle",
            result: {
              content: [{ type: "text", text: `answer: ${JSON.stringify(context.reply)}` }],
              details: {},
            },
          };
        },
      },
    ),
  ]);
  const parked = await asking.tools({ ...b.input(), assistant: askTool() });
  assert.deepEqual(parked, { kind: "waiting", calls: ["call-1"] });
  assert.equal(await effectState(b.session), "waiting");

  await signalEffect(b.session, { runId: "run_1", callId: "call-1", signal: "yes" });
  const woken = await asking.tools({ ...b.input(), assistant: askTool() });
  assert.equal(woken.kind, "complete");
  const answered = woken.kind === "complete" ? woken.messages[0]?.content[0] : undefined;
  assert.equal(answered?.type === "text" ? answered.text : "", 'answer: "yes"');
  assert.equal(wakes, 1);
  assert.equal(await effectState(b.session), "result");

  const reused = await asking.tools({ ...b.input(), assistant: askTool() });
  assert.equal(reused.kind, "complete");
  assert.equal(wakes, 1);
});

test("a deadline uses the step's clock and wakes without a reply", async () => {
  const b = await bench();
  const wakes: { readonly expired: boolean; readonly reply: unknown }[] = [];
  const asking = turnWith(scripted([]).streamFn, [
    tool(
      async () => {
        throw new ToolWait({ until: 100 });
      },
      {
        wake: async (_waiting, context) => {
          wakes.push({ expired: context.expired, reply: context.reply });
          return {
            kind: "settle",
            result: { content: [{ type: "text", text: "done" }], details: {} },
          };
        },
      },
    ),
  ]);
  assert.deepEqual(await asking.tools({ ...b.input({ now: 99 }), assistant: askTool() }), {
    kind: "waiting",
    calls: ["call-1"],
  });
  const completed = await asking.tools({ ...b.input({ now: 100 }), assistant: askTool() });
  assert.equal(completed.kind, "complete");
  if (completed.kind === "complete") {
    const content = completed.messages[0]?.content[0];
    assert.equal(content?.type === "text" ? content.text : undefined, "done");
  }
  assert.deepEqual(wakes, [{ expired: true, reply: undefined }]);
});

test("an abort settles a parked call as an error so the run can end", async () => {
  const b = await bench();
  const asking = turnWith(scripted([]).streamFn, [
    tool(async () => {
      throw new ToolWait();
    }),
  ]);
  await asking.tools({ ...b.input(), assistant: askTool() });
  const controller = new AbortController();
  controller.abort();
  const outcome = await asking.tools({
    ...b.input({ signal: controller.signal, abort: true }),
    assistant: askTool(),
  });
  assert.equal(outcome.kind, "complete");
  if (outcome.kind === "complete") assert.equal(outcome.messages[0]?.isError, true);
  assert.equal(await effectState(b.session), "result");
  assert.equal((await b.session.refs.list(effectPrefix("run_1"))).length, 1);
  assert.equal(await b.session.refs.read(headRef("main")), null);
});

test("builtin factories execute approved arguments after durable intent and jobs replay reuses their results", async () => {
  const b = await bench();
  const directory = dirname(storePath());
  const release = Promise.withResolvers<void>();
  const started = Promise.withResolvers<void>();
  let executions = 0;
  const diagnostics: unknown[] = [];
  const jobs = createJobs({
    session: b.session,
    childId: () => sessionId("unused-child"),
    backgroundChild: async () => {},
    interruptChild: async () => {},
    notify: async () => {},
    diagnostic: async (cause) => {
      diagnostics.push(cause);
    },
  });
  const tools = createAllTools(directory).map((builtin) =>
    builtin.name !== "bash"
      ? builtin
      : jobs.wrap({
          ...builtin,
          execute: async (id, args, signal, update, context) => {
            executions += 1;
            const effect = await readEffect(b.session, { runId: b.run.id, callId: id });
            assert.ok(effect, "durable intent must precede the real command's side effect");
            assert.deepEqual(effect.intent.args, { command: "printf approved > command.txt" });
            assert.deepEqual(args, effect.intent.args);
            await assert.rejects(access(join(directory, "command.txt")));
            started.resolve();
            await release.promise;
            return builtin.execute(id, args, signal, update, context);
          },
        }),
  );
  const requested = assistant("", {
    calls: [
      call("job", "bash", { command: "printf wrong > command.txt" }),
      call("write", "write", { path: "sibling.txt", content: "sibling" }),
    ],
  });
  const script = scripted([requested]);
  const turn = turnWith(script.streamFn, tools, {
    loop: {
      beforeToolCall: async ({ toolCall }) =>
        toolCall.name === "bash"
          ? { args: { command: "printf approved > command.txt", timeout: null } }
          : undefined,
    },
  });
  try {
    const response = await turn.respond(b.input());
    assert.equal(response.kind, "tools");
    assert.equal(script.requests, 1);
    assert.deepEqual(await turn.tools({ ...b.input(), assistant: requested }), {
      kind: "waiting",
      calls: ["job"],
    });
    await within(started.promise);
    assert.equal(await effectState(b.session, "job"), "waiting");
    assert.equal(await readFile(join(directory, "sibling.txt"), "utf8"), "sibling");
    release.resolve();
    await expect.poll(async () => (await jobs.list())[0]?.state).toBe("completed");
    await jobs.recheck(b.run.id);
    for (let replay = 0; replay < 2; replay += 1) {
      const outcome = await turn.tools({ ...b.input(), assistant: requested });
      assert.ok(outcome.kind === "complete");
      assert.deepEqual(
        outcome.messages.map((result) => result.toolCallId),
        ["job", "write"],
      );
      assert.ok(outcome.messages.every((result) => !result.isError));
    }
    assert.equal(await readFile(join(directory, "command.txt"), "utf8"), "approved");
    assert.equal(executions, 1);
    assert.deepEqual(diagnostics, []);
  } finally {
    release.resolve();
    await jobs.close();
  }
});
