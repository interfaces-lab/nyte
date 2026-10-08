/**
 * The bound turn: the agent loop over a real store, with the effect sandwich
 * around every tool call. The provider is a script; the tools are real
 * functions.
 */
import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { expect, test } from "vitest";
import { NOOP_TELEMETRY_CONTEXT } from "@nyte-ai/telemetry";
import {
  createAssistantMessageEventStream,
  type Api,
  type AssistantMessage,
  type Model,
} from "@nyte-ai/ai";
import { getCurrentSystemPrompt, getCurrentTools } from "@nyte-ai/schema";
import { Type } from "typebox";
import { createBashToolDefinition } from "../../src/tools/bash.ts";
import { bindTool } from "../../src/tools/bind-tool.ts";
import { bindEnv, builtinTools } from "../builtin-tools.ts";
import { createJobs } from "../../src/kernel/sdk/jobs.ts";
import { openEffect, readEffect, signalEffect } from "../../src/kernel/effects.ts";
import type { Commit, EventBody, Lease, Run, ToolClass } from "../../src/kernel/model.ts";
import { effectPrefix, headRef } from "../../src/kernel/names.ts";
import type { Session } from "../../src/kernel/store.ts";
import {
  bindTurn,
  type ToolBatchResults,
  type Turn,
  type TurnInput,
  type TurnOptions,
} from "../../src/kernel/turn.ts";
import {
  backgroundWait,
  ToolWait,
  type ExecutableTool,
  type StreamFn,
  type ToolCall,
} from "../../src/kernel/loop/types.ts";
import { ToolError, ToolStop } from "../../src/kernel/loop/tool-result.ts";
import { runToolCall } from "../../src/kernel/loop/agent-loop.ts";
import { contextCommits } from "../../src/kernel/graph.ts";
import {
  assistant,
  call,
  commit,
  declared,
  lease,
  localEnv,
  message,
  openSession,
  seedHead,
  storePath,
  toolResult,
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

const env = localEnv(tmpdir());

const parameters = Type.Object({ value: Type.String() });
type TestTool = ExecutableTool<typeof parameters>;

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
    readonly phase?: Run["phase"];
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
    origin: { kind: "user" },
    root: "run_1",
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
            phase: options.phase ?? run.phase,
            attempts: options.attempts ?? 0,
            abortRequested: true,
          }
        : {
            ...run,
            phase: options.phase ?? run.phase,
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
        emit: (event) => {
          events.push(event);
        },
        signal: options.signal ?? new AbortController().signal,
      };
    },
  };
}

function tool(
  execute: TestTool["execute"],
  extra: Partial<Pick<TestTool, "replay" | "wake">> = {},
): ExecutableTool {
  return bindEnv(
    bindTool({ name: "test", description: "a test tool", parameters, execute, ...extra }),
    env,
  );
}

function turnWith(
  streamFn: StreamFn,
  tools: readonly ExecutableTool[] = [],
  options: Partial<TurnOptions> = {},
): Turn {
  return bindTurn({
    streamFn,
    model,
    sections: { prompt: "system" },
    tools,
    env,
    ...options,
  });
}

const askTool = (id = "call-1", value = "input") =>
  assistant("", { calls: [call(id, "test", { value })] });

const DENIED = { kind: "error", reason: { kind: "denied" } } as const;

/** The settled class of each call, by call id. */
function classes(results: ToolBatchResults): Record<string, ToolClass> {
  return Object.fromEntries(
    results.settlements.map(({ message, call: settled }) => [message.toolCallId, settled]),
  );
}

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
  let seen: { systemPrompt: string; messages: number } | undefined;
  const script = scripted([answer]);
  const streamFn: StreamFn = (requested, context, options) => {
    seen = {
      systemPrompt: getCurrentSystemPrompt(context.messages),
      messages: context.messages.filter((item) => item.role !== "system").length,
    };
    assert.equal(requested.id, model.id);
    return script.streamFn(requested, context, options);
  };
  const turn = turnWith(streamFn);
  const input = await declared(turn, b.input());
  const outcome = await turn.respond(input);
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
  const second = await turn.respond(
    b.input({
      attempts: 1,
      phase: {
        kind: "retry",
        at: 0,
        retries: 1,
        failure: { class: "rate_limit", message: "rate limited" },
      },
    }),
  );
  assert.equal(second.kind, "failed");
  if (second.kind === "failed") assert.match(second.failure.message, /rate limited/u);

  const aborted = await turnWith(scripted([assistant("", { stop: "aborted" })]).streamFn).respond(
    b.input(),
  );
  assert.equal(aborted.kind, "aborted");
});

test("successful tool turns reset provider retry backoff to attempt one", async () => {
  const b = await bench();
  const turn = turnWith(
    scripted([
      assistant("", {
        stop: "error",
        error: "Server requested 30s retry delay (max: 15s). 429 Too Many Requests",
      }),
    ]).streamFn,
    [],
    { retry: { enabled: true, maxRetries: 1, baseDelayMs: 1_000 } },
  );
  const before = Date.now();
  const outcome = await turn.respond(b.input({ attempts: 3 }));
  assert.equal(outcome.kind, "retry");
  if (outcome.kind !== "retry") return;
  assert.equal(outcome.retries, 1);
  assert.ok(outcome.at >= before + 1_000);
  assert.ok(outcome.at <= Date.now() + 1_000);
});

test("a tool runs once inside its effect, reports progress, and settles with its result", async () => {
  const b = await bench();
  let executions = 0;
  const turn = turnWith(scripted([]).streamFn, [
    tool(async (input, call) => {
      executions += 1;
      call.update({ content: [{ type: "text", text: "half" }], details: {} });
      return { content: [{ type: "text", text: `got ${input.value}` }], details: { ok: true } };
    }),
  ]);
  const outcome = await turn.tools({ ...b.input(), assistant: askTool() });
  assert.equal(outcome.kind, "complete");
  if (outcome.kind !== "complete") return;
  assert.equal(outcome.settlements[0]?.message.toolCallId, "call-1");
  assert.equal(
    outcome.settlements[0]?.message.content[0]?.type === "text"
      ? outcome.settlements[0].message.content[0].text
      : "",
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

test("settled presentation uses arguments replaced by before-tool", async () => {
  const b = await bench();
  const pathParameters = Type.Object({ path: Type.String() });
  const pathTool = bindEnv(
    bindTool({
      name: "path",
      description: "reads a path",
      parameters: pathParameters,
      present: ({ path }) => ({ kind: "file_read", path }),
      execute: async ({ path }) => ({
        content: [{ type: "text", text: path }],
        details: {},
      }),
    }),
    env,
  );
  const requested = assistant("", {
    calls: [call("path-call", "path", { path: "model.txt" })],
  });
  const outcome = await turnWith(scripted([]).streamFn, [pathTool], {
    loop: { beforeToolCall: async () => ({ args: { path: "approved.txt" } }) },
  }).tools({ ...b.input(), assistant: requested });
  assert.equal(outcome.kind, "complete");
  if (outcome.kind !== "complete") return;
  assert.deepEqual(classes(outcome)["path-call"], { kind: "file_read", path: "approved.txt" });
});

test("settled calls without a presenter are classified as custom", async () => {
  const b = await bench();
  const requested = assistant("", {
    calls: [call("known", "test", { value: "x" }), call("missing", "missing", {})],
  });
  const outcome = await turnWith(scripted([]).streamFn, [
    tool(async () => ({ content: [{ type: "text", text: "done" }], details: {} })),
  ]).tools({ ...b.input(), assistant: requested });
  assert.equal(outcome.kind, "complete");
  if (outcome.kind !== "complete") return;
  assert.deepEqual(classes(outcome), {
    known: { kind: "custom", label: "test" },
    missing: { kind: "custom", label: "missing" },
  });
});

test("after-tool patches survive a waiting sibling and recovery without running the hook again", async () => {
  const b = await bench();
  let executions = 0;
  const finalizedCalls: string[] = [];
  const patchedUsage = assistant("").usage;
  const tools = [
    tool(
      async (input, call) => {
        if (call.id === "waiting") throw new ToolWait(backgroundWait);
        executions += 1;
        assert.equal(input.value, "approved");
        return { content: [{ type: "text", text: "private output" }], details: { private: true } };
      },
      {
        wake: async () => ({
          kind: "success",
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
          outcome: DENIED,
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
  assert.deepEqual(stored.settlement, DENIED);
  assert.deepEqual(stored.result.usage, patchedUsage);

  await signalEffect(b.session, { runId: "run_1", callId: "waiting", signal: "yes" });
  const recovered = turnWith(scripted([]).streamFn, tools, options);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const outcome = await recovered.tools({ ...b.input(), assistant: requested });
    assert.ok(outcome.kind === "complete");
    assert.deepEqual(
      outcome.settlements.map(({ message: result, outcome: settled }) => ({
        content: result.content,
        details: result.details,
        isError: result.isError,
        outcome: settled,
        usage: result.usage,
      })),
      ["settled", "waiting"].map((id) => ({
        content: [{ type: "text", text: `public ${id}` }],
        details: { public: true },
        isError: true,
        outcome: DENIED,
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
    assert.equal(outcome.settlements[0]?.message.isError, true);
    assert.match(JSON.stringify(outcome.settlements[0]?.message.content), /redaction failed/u);
    assert.doesNotMatch(JSON.stringify(outcome.settlements[0]?.message.content), /private output/u);
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
          if (toolCall.id === "next") {
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
      calls: [call("first", "test", { value: "x" }), call("next", "test", { value: "y" })],
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
    assert.equal(outcome.settlements[0]?.message.isError, true);
    assert.match(JSON.stringify(outcome.settlements[0]?.message.content), /disk on fire/u);
  }
  assert.equal(await effectState(b.session), "result");

  const truncated = await throwing.tools({
    ...b.input(),
    assistant: { ...askTool("call-2"), stopReason: "length" },
  });
  assert.equal(truncated.kind, "complete");
  if (truncated.kind === "complete") assert.equal(truncated.settlements[0]?.message.isError, true);
  assert.equal(await effectState(b.session, "call-2"), undefined);
});

test("a settled success is reused as a success when the run is stepped again under a participant's stop", async () => {
  const b = await bench();
  let executions = 0;
  const turn = turnWith(scripted([]).streamFn, [
    tool(async () => {
      executions += 1;
      return { content: [{ type: "text", text: "ran" }], details: {} };
    }),
  ]);
  const first = await turn.tools({ ...b.input(), assistant: askTool() });
  assert.ok(first.kind === "complete");
  assert.deepEqual(first.settlements[0]?.outcome, { kind: "success" });
  const stored = (await readEffect(b.session, { runId: "run_1", callId: "call-1" }))?.effect;
  assert.ok(stored?.state === "result");
  assert.deepEqual(stored.settlement, { kind: "success" });

  const controller = new AbortController();
  controller.abort(new ToolStop("cancelled"));
  const again = await turn.tools({
    ...b.input({ signal: controller.signal, abort: true }),
    assistant: askTool(),
  });
  assert.ok(again.kind === "complete");
  assert.deepEqual(again.settlements[0]?.outcome, { kind: "success" });
  assert.equal(again.settlements[0]?.message.isError, false);
  assert.equal(executions, 1);
});

test("a stored result is read before the stop and the policy: a stop mid-batch reuses it, siblings that never started settle cancelled without a policy decision", async () => {
  const b = await bench();
  const controller = new AbortController();
  const executed: string[] = [];
  const policed: string[] = [];
  const turn = turnWith(
    scripted([]).streamFn,
    [
      tool(async (_input, call) => {
        executed.push(call.id);
        return { content: [{ type: "text", text: `ran ${call.id}` }], details: {} };
      }),
    ],
    {
      loop: {
        beforeToolCall: async ({ toolCall }) => {
          policed.push(toolCall.id);
          if (toolCall.id === "fresh") controller.abort(new ToolStop("cancelled"));
          return toolCall.id === "late" ? { block: true, cause: DENIED.reason } : undefined;
        },
      },
    },
  );
  const first = await turn.tools({
    ...b.input(),
    assistant: assistant("", { calls: [call("stored", "test", { value: "x" })] }),
  });
  assert.ok(first.kind === "complete");
  const again = await turn.tools({
    ...b.input({ signal: controller.signal }),
    assistant: assistant("", {
      calls: [
        call("fresh", "test", { value: "x" }),
        call("stored", "test", { value: "x" }),
        call("late", "test", { value: "x" }),
      ],
    }),
  });
  assert.ok(again.kind === "complete");
  assert.deepEqual(
    again.settlements.map(({ message, outcome }) => [message.toolCallId, outcome]),
    [
      ["fresh", { kind: "error", reason: { kind: "cancelled" } }],
      ["stored", { kind: "success" }],
      ["late", { kind: "error", reason: { kind: "cancelled" } }],
    ],
  );
  assert.deepEqual(executed, ["stored"]);
  assert.deepEqual(policed, ["stored", "fresh"]);
  for (const id of ["fresh", "stored", "late"]) {
    assert.equal(await effectState(b.session, id), "result");
  }
});

test("a refusal is durable: a denied call is not executed when its parked sibling wakes, and the stored arguments hold", async () => {
  const b = await bench();
  let deny = true;
  const executed: unknown[] = [];
  const turn = turnWith(
    scripted([]).streamFn,
    [
      tool(
        async (input) => {
          if (input.value === "wait") throw new ToolWait(backgroundWait);
          executed.push(input);
          return { content: [], details: {} };
        },
        { wake: async () => ({ kind: "success", result: { content: [], details: {} } }) },
      ),
    ],
    {
      loop: {
        beforeToolCall: async ({ toolCall }) => {
          if (toolCall.id === "denied")
            return deny ? { block: true, cause: DENIED.reason } : undefined;
          return { args: { value: toolCall.id === "waiting" ? "wait" : "approved" } };
        },
      },
    },
  );
  const requested = assistant("", {
    calls: [
      call("denied", "test", { value: "no" }),
      call("waiting", "test", { value: "raw" }),
      call("ran", "test", { value: "raw" }),
    ],
  });
  const first = await turn.tools({ ...b.input(), assistant: requested });
  assert.deepEqual(first, { kind: "waiting", calls: ["waiting"] });
  const refusal = (await readEffect(b.session, { runId: "run_1", callId: "denied" }))?.effect;
  assert.ok(refusal?.state === "result");
  assert.deepEqual(refusal.settlement, DENIED);
  assert.equal(refusal.result.isError, true);
  deny = false;
  await signalEffect(b.session, { runId: "run_1", callId: "waiting", signal: "yes" });
  const woken = await turn.tools({ ...b.input(), assistant: requested });
  assert.ok(woken.kind === "complete");
  assert.deepEqual(
    woken.settlements.map(({ outcome }) => outcome),
    [DENIED, { kind: "success" }, { kind: "success" }],
  );
  assert.deepEqual(executed, [{ value: "approved" }]);
  assert.deepEqual(classes(woken).ran, { kind: "custom", label: "test" });
});

test("the host's stop is not a settlement: what ran is recorded, what had not started is unrecorded and runs on the next step", async () => {
  const b = await bench();
  const controller = new AbortController();
  const executed: string[] = [];
  const turn = turnWith(scripted([]).streamFn, [
    tool(async (_input, call) => {
      executed.push(call.id);
      if (call.id === "first") controller.abort();
      call.signal.throwIfAborted();
      return { content: [{ type: "text", text: "ran" }], details: {} };
    }),
  ]);
  const requested = assistant("", {
    calls: [call("first", "test", { value: "x" }), call("second", "test", { value: "x" })],
  });
  const left = await turn.tools({
    ...b.input({ signal: controller.signal }),
    assistant: requested,
  });
  assert.deepEqual(left, { kind: "conflict" });
  assert.deepEqual(executed, ["first"]);
  const first = (await readEffect(b.session, { runId: "run_1", callId: "first" }))?.effect;
  assert.ok(first?.state === "result");
  assert.deepEqual(first.settlement, { kind: "error", reason: { kind: "interrupted" } });
  assert.equal(await effectState(b.session, "second"), undefined);
  const resumed = await turn.tools({ ...b.input(), assistant: requested });
  assert.ok(resumed.kind === "complete");
  assert.deepEqual(
    resumed.settlements.map(({ outcome }) => outcome),
    [{ kind: "error", reason: { kind: "interrupted" } }, { kind: "success" }],
  );
  assert.deepEqual(executed, ["first", "second"]);
});

test("a recorded result is answered before lookup and validation: today's tool set and schema do not decide it", async () => {
  const b = await bench();
  const first = await turnWith(scripted([]).streamFn, [
    tool(async () => ({ content: [{ type: "text", text: "ran" }], details: {} })),
  ]).tools({ ...b.input(), assistant: askTool() });
  assert.ok(first.kind === "complete");
  const evolved = bindEnv(
    bindTool({
      name: "test",
      description: "the next release's tool",
      parameters: Type.Object({ value: Type.String(), requiredNow: Type.String() }),
      execute: async () => assert.fail("a recorded result is never re-executed"),
    }),
    env,
  );
  for (const tools of [[evolved], []]) {
    const again = await turnWith(scripted([]).streamFn, tools).tools({
      ...b.input(),
      assistant: assistant("", { calls: [call("call-1", "test", { unknown: true })] }),
    });
    assert.ok(again.kind === "complete");
    assert.deepEqual(again.settlements[0]?.outcome, { kind: "success" });
    assert.deepEqual(again.settlements[0]?.message.content, [{ type: "text", text: "ran" }]);
  }
});

test("a stop is read before preparation: a participant's stop settles an unstarted call without a policy decision, the host's stop still answers a recorded result", async () => {
  const b = await bench();
  let policies = 0;
  const turn = turnWith(
    scripted([]).streamFn,
    [tool(async () => ({ content: [{ type: "text", text: "ran" }], details: {} }))],
    {
      loop: {
        beforeToolCall: async () => {
          policies += 1;
          return { block: true, cause: DENIED.reason };
        },
      },
    },
  );
  const participant = new AbortController();
  participant.abort(new ToolStop("cancelled"));
  const stopped = await turn.tools({
    ...b.input({ signal: participant.signal }),
    assistant: assistant("", {
      calls: [
        call("unknown", "nope", {}),
        call("invalid", "test", { value: 1 }),
        call("fresh", "test", { value: "x" }),
      ],
    }),
  });
  assert.ok(stopped.kind === "complete");
  assert.deepEqual(
    stopped.settlements.map(({ outcome }) => outcome),
    Array.from({ length: 3 }, () => ({ kind: "error", reason: { kind: "cancelled" } })),
  );
  assert.equal(policies, 0);
  const recorded = await turnWith(scripted([]).streamFn, [
    tool(async () => ({ content: [{ type: "text", text: "ran" }], details: {} })),
  ]).tools({ ...b.input(), assistant: askTool("stored") });
  assert.ok(recorded.kind === "complete");
  const host = new AbortController();
  host.abort();
  const read = await turn.tools({
    ...b.input({ signal: host.signal }),
    assistant: askTool("stored"),
  });
  assert.ok(read.kind === "complete");
  assert.deepEqual(read.settlements[0]?.outcome, { kind: "success" });
  assert.equal(policies, 0);
});

test("a nested call does not start when the stop arrives while its policy runs, and a stopped one skips the policy", async () => {
  const controller = new AbortController();
  let executions = 0;
  let policies = 0;
  const target = tool(async () => {
    executions += 1;
    return { content: [], details: {} };
  });
  const run = (beforeToolCall: () => void) =>
    runToolCall(call("c", "test", { value: "x" }), {
      context: { messages: [], tools: [target] },
      assistantMessage: askTool(),
      tools: [target],
      signal: controller.signal,
      beforeToolCall: async () => {
        policies += 1;
        beforeToolCall();
        return undefined;
      },
    });
  const during = await run(() => controller.abort(new ToolStop("cancelled")));
  assert.deepEqual(during.kind === "error" ? during.reason : during, { kind: "cancelled" });
  assert.equal(policies, 1);
  const before = await run(() => assert.fail("a stopped call asks no policy"));
  assert.deepEqual(before.kind === "error" ? before.reason : before, { kind: "cancelled" });
  assert.equal(policies, 1);
  assert.equal(executions, 0);
});

test("a safe replay runs the live tool, with the run context a fresh call would have", async () => {
  const b = await bench();
  await openEffect(b.session, {
    lease: b.lease,
    runId: b.run.id,
    callId: "call-1",
    tool: "test",
    args: { value: "recorded" },
    replay: "safe",
    environment: env.id,
  });
  const replayed = await turnWith(scripted([]).streamFn, [
    tool(
      async (input, call) => {
        assert.ok(call.run, "a replayed call runs inside its run");
        return { content: [{ type: "text", text: `${call.run.id}:${input.value}` }], details: {} };
      },
      { replay: "safe" },
    ),
  ]).tools({ ...b.input(), assistant: askTool() });
  assert.ok(replayed.kind === "complete");
  assert.deepEqual(replayed.settlements[0]?.outcome, { kind: "success" });
  assert.deepEqual(replayed.settlements[0]?.message.content, [
    { type: "text", text: "run_1:recorded" },
  ]);
});

test("a stored result without a settlement is reused through its isError bit", async () => {
  const b = await bench();
  const opened = await openEffect(b.session, {
    lease: b.lease,
    runId: "run_1",
    callId: "call-1",
    tool: "test",
    args: { value: "x" },
    replay: "never",
    environment: env.id,
  });
  assert.ok(opened.kind === "opened");
  const legacy = {
    kind: "effect",
    state: "result",
    intent: opened.view.oid,
    result: toolResult("call-1", "test", "old failure", { isError: true }),
    at: 2,
  } as const;
  const [oid] = await b.session.objects.put([legacy]);
  assert.ok(oid !== undefined);
  await b.session.refs.update([{ name: opened.view.ref, from: opened.view.oid, to: oid }], {
    reason: "effect",
    lease: b.lease,
  });
  const outcome = await turnWith(scripted([]).streamFn, [
    tool(async () => assert.fail("a stored result is never re-executed")),
  ]).tools({ ...b.input(), assistant: askTool("call-1", "x") });
  assert.ok(outcome.kind === "complete");
  assert.deepEqual(outcome.settlements[0]?.outcome, { kind: "error", reason: { kind: "error" } });
  assert.deepEqual(outcome.settlements[0]?.message.content, legacy.result.content);
});

test("a tool that waits parks its call, wakes with the reply, and settles exactly once", async () => {
  const b = await bench();
  let wakes = 0;
  const asking = turnWith(scripted([]).streamFn, [
    tool(
      async () => {
        throw new ToolWait(backgroundWait);
      },
      {
        wake: async (_call, context) => {
          wakes += 1;
          return {
            kind: "success",
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
  const answered = woken.kind === "complete" ? woken.settlements[0]?.message.content[0] : undefined;
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
            kind: "success",
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
    const content = completed.settlements[0]?.message.content[0];
    assert.equal(content?.type === "text" ? content.text : undefined, "done");
  }
  assert.deepEqual(wakes, [{ expired: true, reply: undefined }]);
});

test("an abort settles a parked call as an error so the run can end", async () => {
  const b = await bench();
  const asking = turnWith(scripted([]).streamFn, [
    tool(async () => {
      throw new ToolWait(backgroundWait);
    }),
  ]);
  await asking.tools({ ...b.input(), assistant: askTool() });
  const host = new AbortController();
  host.abort();
  assert.deepEqual(
    await asking.tools({ ...b.input({ signal: host.signal }), assistant: askTool() }),
    { kind: "waiting", calls: ["call-1"] },
  );
  assert.equal(await effectState(b.session), "waiting");
  const controller = new AbortController();
  controller.abort(new ToolStop("cancelled"));
  const outcome = await asking.tools({
    ...b.input({ signal: controller.signal, abort: true }),
    assistant: askTool(),
  });
  assert.equal(outcome.kind, "complete");
  if (outcome.kind === "complete") {
    assert.deepEqual(outcome.settlements[0]?.outcome, {
      kind: "error",
      reason: { kind: "cancelled" },
    });
  }
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
    notify: async () => "unused",
    diagnostic: async (cause) => {
      diagnostics.push(cause);
    },
  });
  const bash = bindTool({ ...createBashToolDefinition(), name: "bash" });
  const tools = builtinTools(directory).map((builtin) =>
    builtin.name !== "bash"
      ? builtin
      : bindEnv(
          jobs.wrap({
            ...bash,
            execute: async (input, call) => {
              executions += 1;
              const effect = await readEffect(b.session, { runId: b.run.id, callId: call.id });
              assert.ok(effect, "durable intent must precede the real command's side effect");
              assert.deepEqual(effect.intent.args, { command: "printf approved > command.txt" });
              assert.deepEqual(input, effect.intent.args);
              await assert.rejects(access(join(directory, "command.txt")));
              started.resolve();
              await release.promise;
              return bash.execute(input, call);
            },
          }),
          localEnv(directory),
        ),
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
    await expect.poll(async () => (await jobs.list())[0]?.phase.kind).toBe("completed");
    await jobs.recheck(b.run.id);
    for (let replay = 0; replay < 2; replay += 1) {
      const outcome = await turn.tools({ ...b.input(), assistant: requested });
      assert.ok(outcome.kind === "complete");
      assert.deepEqual(
        outcome.settlements.map(({ message: result }) => result.toolCallId),
        ["job", "write"],
      );
      assert.ok(outcome.settlements.every(({ message: result }) => !result.isError));
    }
    assert.equal(await readFile(join(directory, "command.txt"), "utf8"), "approved");
    assert.equal(executions, 1);
    assert.deepEqual(diagnostics, []);
  } finally {
    release.resolve();
    await jobs.close();
  }
});

test("nested failures retain structured output, reject waits and cancellation, and never open effects", async () => {
  const b = await bench();
  let saved: ToolCall | undefined;
  let cancellations = 0;
  const target = bindEnv(
    bindTool({
      name: "target",
      description: "target",
      parameters,
      execute: async (input, call) => {
        if (input.value === "wait") throw new ToolWait({ until: 10 });
        if (input.value === "cancel") {
          cancellations += 1;
          call.update({ content: [], details: {}, structuredContent: { partial: true } });
          call.signal.throwIfAborted();
          return { content: [], details: {} };
        }
        throw new ToolError({
          content: [{ type: "text", text: "failed" }],
          details: {},
          structuredContent: { error: "kept" },
        });
      },
    }),
    env,
  );
  const outer = tool(async (_input, call) => {
    saved = call;
    assert.ok(call.run);
    const context = call.run;
    const failure = await context.tools.execute("target", { value: "error" });
    assert.equal(failure.kind, "error");
    assert.deepEqual(failure.result.structuredContent, { error: "kept" });
    assert.deepEqual(failure.result.details, { reviewed: true });
    const waiting = await context.tools.execute("target", { value: "wait" });
    assert.equal(waiting.kind, "error");
    assert.match(JSON.stringify(waiting.result.content), /cannot wait during a nested invocation/u);
    const child = new AbortController();
    const cancelled = await context.tools.execute(
      "target",
      { value: "cancel" },
      {
        signal: child.signal,
        onUpdate: () => child.abort(new Error("sandbox cancelled")),
      },
    );
    assert.equal(cancelled.kind, "error");
    assert.deepEqual(cancelled.result.structuredContent, { partial: true });
    assert.match(JSON.stringify(cancelled.result.content), /sandbox cancelled/u);
    const aborted = new AbortController();
    aborted.abort();
    assert.equal(
      (await context.tools.execute("target", { value: "cancel" }, { signal: aborted.signal })).kind,
      "error",
    );
    assert.equal((await context.tools.execute("target", { value: 123 })).kind, "error");
    assert.equal((await context.tools.execute("target", [])).kind, "error");
    return { content: [], details: {}, structuredContent: { done: true } };
  });
  const turn = turnWith(scripted([]).streamFn, [outer, target], {
    loop: { afterToolCall: async () => ({ details: { reviewed: true } }) },
  });
  const outcome = await turn.tools({ ...b.input(), assistant: askTool() });
  assert.equal(outcome.kind, "complete");
  assert.equal(cancellations, 1);
  assert.ok(saved?.run);
  assert.equal((await saved.run.tools.execute("target", { value: "cancel" })).kind, "error");
  assert.equal(cancellations, 1);
  assert.deepEqual((await b.session.refs.list(effectPrefix("run_1"))).length, 1);
  assert.equal(await effectState(b.session), "result");
});

test("tool activation and full tool history follow durable branch ancestry across checkpoints and recovery", async () => {
  const b = await bench();
  const hidden: ExecutableTool = {
    ...tool(async () => ({ content: [], details: {} })),
    name: "hidden",
    exposure: "hidden",
  };
  const deferred: ExecutableTool = { ...hidden, name: "later", exposure: "deferred" };
  const codemode: ExecutableTool = { ...hidden, name: "scripted", exposure: "codemode" };
  const modelOnly: ExecutableTool = { ...hidden, name: "visible", exposure: "model-only" };
  const search: ExecutableTool = {
    name: "tool_search",
    description: "activate",
    parameters: Type.Object({}),
    execute: async (_input, call) => {
      assert.ok(call.run);
      call.run.tools.activate(["later", "hidden", "visible", "missing"]);
      return { content: [], details: {}, structuredContent: { loaded: true } };
    },
  };
  const definitions = [search, hidden, deferred, codemode, modelOnly];
  const searchMessage = assistant("", { calls: [call("search", "tool_search")] });
  let executions = 0;
  const activatedTurn = turnWith(scripted([]).streamFn, [
    {
      ...search,
      execute: async (input, call) => {
        executions += 1;
        return search.execute(input, call);
      },
    },
    ...definitions.slice(1),
  ]);
  let loaded;
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const outcome = await activatedTurn.tools({ ...b.input(), assistant: searchMessage });
    assert.ok(outcome.kind === "complete");
    loaded = outcome.settlements[0]?.message;
    assert.deepEqual(loaded?.addedToolNames, ["later"]);
    assert.deepEqual(loaded?.structuredContent, { loaded: true });
  }
  assert.equal(executions, 1);
  assert.ok(loaded);
  const oids = await seedHead(b.session, "main", [
    message(user("original")),
    message(searchMessage),
    message(loaded),
    { kind: "checkpoint", summary: "not the original", retainedTail: [loaded], tokensBefore: 10 },
    message(user("after checkpoint")),
  ]);
  const tip = oids.at(-1);
  assert.ok(tip);
  const commits = await contextCommits(b.session.objects, tip);
  const declarations: string[][] = [];
  const script = scripted([assistant("ok"), assistant("ok")]);
  const restarted = turnWith((model, context, options) => {
    declarations.push(getCurrentTools(context.messages).map((tool) => tool.name));
    return script.streamFn(model, context, options);
  }, definitions);
  await restarted.respond(await declared(restarted, { ...b.input(), commits }));
  assert.deepEqual(declarations[0], ["tool_search", "later", "visible"]);
  const observer = tool(async (_input, call) => {
    assert.ok(call.run);
    const history = await call.run.history();
    assert.deepEqual(
      history.map((message) => message.role),
      ["user", "assistant", "toolResult", "user"],
    );
    assert.equal(history[0]?.content, "original");
    assert.equal(history.filter((message) => message.role === "toolResult").length, 1);
    return { content: [], details: {} };
  });
  await turnWith(scripted([]).streamFn, [observer]).tools({
    ...b.input(),
    commits,
    assistant: askTool("history"),
  });
  const ancestor = oids[0];
  assert.ok(ancestor);
  const rewound = await contextCommits(b.session.objects, ancestor);
  await restarted.respond(await declared(restarted, { ...b.input(), commits: rewound }));
  assert.deepEqual(declarations[1], ["tool_search", "visible"]);
  const fabricated = await restarted.tools({
    ...b.input(),
    commits: rewound,
    assistant: assistant("", { calls: [call("fabricated", "later", { value: "input" })] }),
  });
  assert.ok(fabricated.kind === "complete");
  assert.equal(fabricated.settlements[0]?.message.isError, true);
  assert.equal(await effectState(b.session, "fabricated"), "result");
});

test("nested bash finishes inside the caller without parking a durable job", async () => {
  const b = await bench();
  const directory = dirname(storePath());
  const jobs = createJobs({
    session: b.session,
    notify: async () => "unused",
    diagnostic: async () => undefined,
  });
  const bash = builtinTools(directory).find((tool) => tool.name === "bash");
  assert.ok(bash);
  const caller = tool(async (_input, call) => {
    assert.ok(call.run);
    const nested = await call.run.tools.execute("bash", {
      command: "printf wrong > nested.txt",
      background: true,
    });
    assert.equal(nested.kind, "success");
    return nested.result;
  });
  try {
    const turn = turnWith(
      scripted([]).streamFn,
      [caller, bindEnv(jobs.wrap(bash), localEnv(directory))],
      {
        loop: {
          beforeToolCall: async ({ toolCall }) =>
            toolCall.name === "bash"
              ? { args: { command: "printf approved > nested.txt" } }
              : undefined,
        },
      },
    );
    const outcome = await turn.tools({ ...b.input(), assistant: askTool() });
    assert.ok(outcome.kind === "complete");
    assert.equal(outcome.settlements[0]?.message.isError, false);
    assert.equal(await readFile(join(directory, "nested.txt"), "utf8"), "approved");
    assert.deepEqual(await jobs.list(), []);
    assert.equal((await b.session.refs.list(effectPrefix("run_1"))).length, 1);
  } finally {
    await jobs.close();
  }
});
