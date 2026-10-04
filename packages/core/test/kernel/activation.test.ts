import { withPluginSource } from "../../src/plugins/source.ts";
/**
 * Activation: a plugin list becomes tools, a prompt, settings, and hooks, and
 * `turnFor` resolves each run's inputs before the turn runs.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { NOOP_TELEMETRY_CONTEXT } from "@nyte-ai/telemetry";
import { contentText, createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import type { AssistantMessage } from "@nyte-ai/schema";
import { getCurrentSystemPrompt } from "@nyte-ai/schema";
import { Type } from "typebox";
import { headRef } from "../../src/kernel/names.ts";
import {
  activate,
  turnFor,
  type Activation,
  type Notice,
} from "../../src/kernel/sdk/activation.ts";
import type { Run } from "../../src/kernel/model.ts";
import type { Session } from "../../src/kernel/store.ts";
import type { TurnInput } from "../../src/kernel/turn.ts";
import {
  definePlugin,
  type AgentTool,
  type Plugin,
  type PluginSession,
} from "../../src/plugins/index.ts";
import type { StreamFn } from "../../src/kernel/loop/types.ts";
import {
  assistant,
  call,
  commit,
  declared,
  lease,
  message,
  openSession,
  seedHead,
  user,
  within,
} from "./helpers.ts";

const model: Model<Api> = {
  id: "base-model",
  name: "Base",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};
const other: Model<Api> = { ...model, id: "other-model" };

const env = { cwd: "/tmp/nowhere" };

const parameters = Type.Object({ path: Type.String() });

function echoTool(seen: unknown[]): AgentTool<typeof parameters> {
  return {
    name: "echo",
    description: "echoes",
    parameters,
    execute: async (input) => {
      seen.push(input);
      return { content: [{ type: "text", text: `echo ${input.path}` }], details: {} };
    },
  };
}

/** The activation a healthy plugin set yields; a failed set fails the test. */
async function activated(input: Parameters<typeof activate>[0]): Promise<Activation> {
  const outcome = await activate(input);
  if (outcome.kind === "failed") throw new Error(outcome.error);
  return outcome.activation;
}

function plugin(id: string, session: Plugin["session"]): Plugin {
  return definePlugin({ id, session });
}

/** Answers every request with `text` and records the system prompt it was given. */
function scripted(text: string) {
  const prompts: string[] = [];
  const streamFn: StreamFn = (_model, context) => {
    prompts.push(getCurrentSystemPrompt(context.messages));
    const stream = createAssistantMessageEventStream();
    const answer: AssistantMessage = assistant(text);
    queueMicrotask(() => stream.push({ type: "done", reason: "stop", message: answer }));
    return stream;
  };
  return { streamFn, prompts };
}

async function inputFor(session: Session, run: Run): Promise<TurnInput> {
  const held = (await session.leases.read(headRef("main"))) ?? (await lease(session, "main"));
  return {
    session,
    telemetry: NOOP_TELEMETRY_CONTEXT,
    lease: held,
    run,
    now: 1,
    attempt: run.attempts + 1,
    commits: [{ oid: "opening", commit: commit(null, message(user("hello"))) }],
    emit: () => undefined,
    signal: new AbortController().signal,
  };
}

const runWith = (config: Run["config"] = {}, id = "run_1"): Run => ({
  kind: "run",
  id,
  head: "main",
  origin: { kind: "user" },
  root: id,
  phase: { kind: "respond" },
  startedAt: 1,
  attempts: 0,
  config,
});

test("plugins contribute tools, prompt sections, and settings that live in the session's facts", async () => {
  const session = await openSession();
  const seen: unknown[] = [];
  const activation = await activated({
    target: { kind: "session", session },
    env,
    plugins: [
      plugin("base", (api) => {
        api.tools.add((draft) => draft.set("echo", echoTool(seen)));
        api.prompt.add((draft) => draft.set("intro", { text: "You are terse.", order: 1 }));
        api.settings.add((draft) =>
          draft.set("verbosity", {
            label: "Verbosity",
            key: "verbosity",
            default: "low",
            choices: [
              { id: "low", label: "Low" },
              { id: "high", label: "High" },
            ],
          }),
        );
      }),
      plugin("extra", (api) => {
        api.prompt.add((draft) => draft.set("more", { text: "Cite sources.", order: 2 }));
      }),
    ],
  });

  assert.deepEqual(
    activation.tools().map((tool) => tool.name),
    ["echo"],
  );
  assert.equal(activation.systemPrompt(), "You are terse.\n\nCite sources.");
  assert.deepEqual(
    (await activation.listSettings()).map((setting) => [setting.id, setting.current]),
    [["verbosity", "low"]],
  );

  assert.deepEqual(await activation.applySetting("verbosity", "high"), { kind: "applied" });
  assert.equal((await activation.listSettings())[0]?.current, "high");
  assert.ok((await session.refs.list("refs/facts/")).length >= 1, "the choice is a session fact");
  const reopened = await activated({
    target: { kind: "session", session },
    env,
    plugins: [],
  });
  assert.deepEqual(await reopened.listSettings(), []);
  assert.deepEqual(await activation.applySetting("verbosity", "nope"), { kind: "invalid_choice" });
  assert.deepEqual(await activation.applySetting("missing", "x"), { kind: "not_found" });

  const notices: Notice[] = [];
  activation.subscribe((notice) => notices.push(notice));
  await activation.setPlugins([
    plugin("only", (api) => {
      api.prompt.add((draft) => draft.set("p", { text: "Replaced." }));
    }),
  ]);
  assert.equal(activation.systemPrompt(), "Replaced.");
  assert.deepEqual(activation.tools(), []);
  assert.deepEqual(
    notices.map((notice) => notice.kind),
    ["plugins_changed"],
  );
  await activation.close();
  await reopened.close();
});

test("plugin session messages start at the newest checkpoint", async () => {
  const session = await openSession();
  await seedHead(session, "main", [
    message(user("old request")),
    message(assistant("old answer")),
    {
      kind: "checkpoint",
      summary: "condensed history",
      retainedTail: [assistant("kept answer")],
      tokensBefore: 10,
    },
    message(user("new request")),
  ]);
  let exposed: PluginSession | undefined;
  const activation = await activated({
    target: { kind: "session", session },
    env,
    plugins: [
      plugin("session-reader", (api) => {
        exposed = api.session;
      }),
    ],
  });

  assert.ok(exposed);
  const { messages } = await exposed.context();
  assert.deepEqual(
    messages.map((item) => item.role),
    ["user", "assistant", "user"],
  );
  assert.match(contentText(messages[0]?.content ?? ""), /condensed history/u);
  assert.equal(
    messages.some((item) => contentText(item.content).includes("old request")),
    false,
  );
  assert.equal(contentText(messages.at(-1)?.content ?? ""), "new request");
  await activation.close();
});

test("hooks bend the turn: a policy can rewrite a tool's arguments and the context can be transformed", async () => {
  const session = await openSession();
  const seen: unknown[] = [];
  const activation = await activated({
    target: { kind: "session", session },
    env,
    plugins: [
      plugin("policy", (api) => {
        api.tools.add((draft) => draft.set("echo", echoTool(seen)));
        api.prompt.add((draft) => draft.set("p", { text: "base prompt" }));
        api.hook("before_tool", (event) =>
          event.toolName === "echo" && event.args.path === "/secret"
            ? { action: "modify", args: { path: "/redacted" } }
            : { action: "continue" },
        );
        api.hook("transform_context", (event) => ({
          systemPrompt: `${event.systemPrompt} + transformed for ${event.runId}`,
        }));
      }),
    ],
  });
  const script = scripted("ok");
  const bound = turnFor(activation, { streamFn: script.streamFn, model });

  const run = runWith();
  await bound.turn.respond(await declared(bound.turn, await inputFor(session, run)));
  assert.deepEqual(script.prompts, ["base prompt + transformed for run_1"]);

  const batch = await bound.turn.tools({
    ...(await inputFor(session, run)),
    assistant: assistant("", { calls: [call("c1", "echo", { path: "/secret" })] }),
  });
  assert.equal(batch.kind, "complete");
  assert.deepEqual(seen, [{ path: "/redacted" }]);
  assert.equal(bound.policyFailure("run_1"), undefined);
  await activation.close();
});

test("a policy objection settles the call as denied; a policy that cannot decide settles it as a plain error", async () => {
  const session = await openSession();
  const seen: unknown[] = [];
  const activation = await activated({
    target: { kind: "session", session },
    env,
    plugins: [
      plugin("policy", (api) => {
        api.tools.add((draft) => draft.set("echo", echoTool(seen)));
        api.prompt.add((draft) => draft.set("p", { text: "base prompt" }));
        api.hook("before_tool", (event) => {
          if (event.args.path === "/blocked") return { action: "reject", message: "not allowed" };
          if (event.args.path === "/broken") return { action: "error", message: "policy down" };

          return { action: "continue" };
        });
      }),
    ],
  });
  const bound = turnFor(activation, { streamFn: scripted("ok").streamFn, model });

  const denied = await bound.turn.tools({
    ...(await inputFor(session, runWith())),
    assistant: assistant("", { calls: [call("c1", "echo", { path: "/blocked" })] }),
  });
  assert.ok(denied.kind === "complete");
  assert.deepEqual(denied.settlements[0]?.outcome, {
    kind: "error",
    reason: { kind: "denied" },
  });
  assert.equal(
    contentText(denied.settlements[0]?.message.content ?? ""),
    "Tool call denied: not allowed",
  );
  assert.equal(bound.policyFailure("run_1"), undefined);

  const undecided = await bound.turn.tools({
    ...(await inputFor(session, runWith({}, "run_2"))),
    assistant: assistant("", { calls: [call("c2", "echo", { path: "/broken" })] }),
  });
  assert.ok(undecided.kind === "complete");
  assert.deepEqual(undecided.settlements[0]?.outcome, {
    kind: "error",
    reason: { kind: "error" },
  });
  assert.equal(contentText(undecided.settlements[0]?.message.content ?? ""), "policy down");
  assert.equal(bound.policyFailure("run_2"), "policy down");
  assert.deepEqual(seen, []);
  await activation.close();
});

test("a run's declared agent brings its own model, persona, and step ceiling; an unknown agent falls back", async () => {
  const session = await openSession();
  const activation = await activated({
    target: { kind: "session", session },
    env,
    plugins: [
      plugin("agents", (api) => {
        api.prompt.add((draft) => draft.set("p", { text: "base" }));
        api.agents.add((draft) =>
          draft.set("reviewer", {
            id: "reviewer",
            model: { provider: "openai", id: "other-model" },
            system: "You review.",
            steps: 3,
          }),
        );
      }),
    ],
  });
  const script = scripted("ok");
  const requested: string[] = [];
  const streamFn: StreamFn = (used, context, options) => {
    requested.push(used.id);
    return script.streamFn(used, context, options);
  };
  const bound = turnFor(activation, {
    streamFn,
    model,
    resolveModel: (ref) => (ref.id === "other-model" ? other : undefined),
  });

  const reviewer = runWith({ agent: "reviewer" }, "run_r");
  await bound.turn.respond(await declared(bound.turn, await inputFor(session, reviewer)));
  assert.deepEqual(requested, ["other-model"]);
  assert.equal(script.prompts[0], "base\n\nYou review.");
  assert.equal(bound.stepsFor(reviewer), 3);

  const stranger = runWith({ agent: "nobody", model: { id: "missing" } }, "run_s");
  await bound.turn.respond(await declared(bound.turn, await inputFor(session, stranger)));
  assert.equal(requested[1], "base-model");
  assert.equal(script.prompts[1], "base");
  assert.equal(bound.stepsFor(stranger), undefined);
  assert.deepEqual(bound.resolveConfig({ agent: "reviewer" }), {
    agent: "reviewer",
    model: { provider: other.provider, id: other.id },
    thinkingLevel: "off",
  });
  await activation.close();
});

test("a replacement waits for an active command without disposing the command's resources", async () => {
  const session = await openSession();
  const running = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const disposed = Promise.withResolvers<void>();
  const activation = await activated({
    target: { kind: "session", session },
    env,
    plugins: [
      withPluginSource(
        plugin("command", (api) => {
          api.signal.addEventListener("abort", () => disposed.resolve());
          api.commands.add((draft) =>
            draft.set("work", {
              description: "Old command",
              run: async () => {
                running.resolve();
                await finish.promise;
                assert.equal(api.signal.aborted, false);
                return "old result";
              },
            }),
          );
        }),
        { source: "inline", version: "old" },
      ),
    ],
  });
  try {
    const command = activation.runCommand("work");
    await running.promise;
    assert.deepEqual(
      await activation.setPlugins([
        withPluginSource(
          plugin("command", (api) => {
            api.commands.add((draft) =>
              draft.set("work", { description: "New command", run: () => "new result" }),
            );
          }),
          { source: "inline", version: "new" },
        ),
      ]),
      { kind: "queued" },
    );
    assert.equal(activation.plugins.list()[0]?.version, "old");
    finish.resolve();
    assert.equal(await command, "old result");
    await disposed.promise;
    assert.equal(await activation.runCommand("work"), "new result");
  } finally {
    finish.resolve();
    await activation.close();
    await session.close();
  }
});

test("nested calls share the agent catalog and SDK policy with a sandbox signal", async () => {
  const session = await openSession();
  const seen: unknown[] = [];
  const hooks: string[] = [];
  const activation = await activated({
    target: { kind: "session", session },
    env,
    plugins: [
      plugin("nested", (api) => {
        api.tools.add((draft) => {
          draft.set("echo", {
            ...echoTool(seen),
            exposure: "codemode",
            namespace: { name: "files" },
            outputSchema: parameters,
            prepareArguments: (args) =>
              args.path === "/invalid" || args.path === "/blocked" ? args : { path: "/secret" },
            execute: async (input, call) => {
              assert.equal(call.run?.parentToolCallId, "outer");
              assert.equal(call.run.id, "run_1");
              assert.equal(call.run.head, "main");
              const result = await echoTool(seen).execute(input, call);
              return { ...result, structuredContent: { path: input.path } };
            },
          });
          for (const name of ["hidden", "model", "disallowed"]) {
            draft.set(name, {
              ...echoTool(seen),
              name,
              exposure: name === "hidden" ? "hidden" : name === "model" ? "model-only" : "direct",
            });
          }
          draft.set("tool_search", { ...echoTool(seen), name: "tool_search" });
          draft.set("codemode", {
            name: "codemode",
            description: "runs code",
            parameters: Type.Object({}),
            execute: async (_input, call) => {
              assert.ok(call.run);
              const context = call.run;
              assert.deepEqual(
                context.tools.list().map((tool) => tool.name),
                ["echo"],
              );
              const sandbox = new AbortController();
              const outcome = await context.tools.execute("echo", {}, { signal: sandbox.signal });
              assert.equal(outcome.kind, "success");
              assert.deepEqual(outcome.result.structuredContent, { path: "/redacted" });
              assert.deepEqual(outcome.result.details, { reviewed: true });
              assert.equal(
                (
                  await context.tools.execute(
                    "echo",
                    { path: "/invalid" },
                    { signal: sandbox.signal },
                  )
                ).kind,
                "error",
              );
              assert.equal(
                (
                  await context.tools.execute(
                    "echo",
                    { path: "/blocked" },
                    { signal: sandbox.signal },
                  )
                ).kind,
                "error",
              );
              for (const name of ["hidden", "model", "disallowed", "codemode", "tool_search"]) {
                assert.equal((await context.tools.execute(name, { path: "bad" })).kind, "error");
              }
              return outcome.result;
            },
          });
        });
        api.agents.add((draft) =>
          draft.set("limited", {
            id: "limited",
            tools: ["echo", "hidden", "model", "codemode", "tool_search"],
          }),
        );
        api.hook("before_tool", (event) => {
          hooks.push(`before:${event.toolCallId}`);
          if (event.toolName === "echo" && event.args.path === "/blocked")
            return { action: "reject", message: "blocked" };
          return event.toolName === "echo"
            ? {
                action: "modify",
                args: { path: event.args.path === "/invalid" ? {} : "/redacted" },
              }
            : { action: "continue" };
        });
        api.hook("after_tool", (event) => {
          hooks.push(`after:${event.toolCallId}`);
          if (event.toolName !== "echo") return undefined;
          assert.deepEqual(event.structuredContent, { path: "/redacted" });
          return { details: { reviewed: true } };
        });
      }),
    ],
  });
  try {
    const run = runWith({ agent: "limited" });
    const bound = turnFor(activation, { streamFn: scripted("ok").streamFn, model });
    const outcome = await bound.turn.tools({
      ...(await inputFor(session, run)),
      assistant: assistant("", { calls: [call("outer", "codemode")] }),
    });
    assert.equal(outcome.kind, "complete");
    if (outcome.kind !== "complete") return;
    assert.equal(outcome.settlements[0]?.message.isError, false);
    assert.deepEqual(outcome.settlements[0]?.message.structuredContent, { path: "/redacted" });
    assert.deepEqual(seen, [{ path: "/redacted" }]);
    assert.deepEqual(hooks, [
      "before:outer",
      "before:outer/1",
      "after:outer/1",
      "before:outer/2",
      "before:outer/3",
      "after:outer",
    ]);
    assert.equal((await session.refs.list("refs/effects/")).length, 1);
  } finally {
    await activation.close();
  }
});

test("final close aborts every plugin before draining commands waiting on plugin lifetime signals", async () => {
  const session = await openSession();
  const running = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const activation = await activated({
    target: { kind: "session", session },
    env,
    plugins: [
      plugin("command", (api) => {
        api.commands.add((draft) =>
          draft.set("wait", {
            description: "Wait until close",
            run: async () => {
              running.resolve();
              await finish.promise;
              assert.equal(api.signal.aborted, true);
              return "stopped";
            },
          }),
        );
      }),
      plugin("cancellation", (api) => {
        api.signal.addEventListener("abort", () => finish.resolve(), { once: true });
      }),
    ],
  });
  const command = activation.runCommand("wait");
  try {
    await within(running.promise);
    await within(activation.close());
    assert.equal(await command, "stopped");
  } finally {
    finish.resolve();
    await activation.close();
    await session.close();
  }
});

test("final close cancels and drains an event listener waiting on api.signal", async () => {
  const session = await openSession();
  const running = Promise.withResolvers<void>();
  const finish = Promise.withResolvers<void>();
  const completed = Promise.withResolvers<void>();
  const activation = await activated({
    target: { kind: "session", session },
    env,
    plugins: [
      plugin("listener", (api) => {
        api.signal.addEventListener("abort", () => finish.resolve(), { once: true });
        api.settings.add((draft) =>
          draft.set("start", {
            label: "Start",
            key: "start",
            default: "off",
            choices: [
              { id: "off", label: "Off" },
              { id: "on", label: "On" },
            ],
          }),
        );
        api.events.subscribe(async () => {
          running.resolve();
          await finish.promise;
          assert.equal(api.signal.aborted, true);
          completed.resolve();
        });
      }),
    ],
  });
  try {
    await activation.applySetting("start", "on");
    await within(running.promise);
    await within(activation.close());
    await completed.promise;
  } finally {
    finish.resolve();
    await activation.close();
    await session.close();
  }
});

test("final close drains a direct tool invocation after cancelling plugin resources", async () => {
  const session = await openSession();
  const running = Promise.withResolvers<void>();
  const aborted = Promise.withResolvers<void>();
  const cleanup = Promise.withResolvers<void>();
  const activation = await activated({
    target: { kind: "session", session },
    env,
    plugins: [
      plugin("tool", (api) => {
        api.signal.addEventListener("abort", () => aborted.resolve(), { once: true });
        api.tools.add((draft) =>
          draft.set("close", {
            name: "close",
            description: "Wait until close",
            parameters: Type.Object({}),
            execute: async () => {
              running.resolve();
              await aborted.promise;
              await cleanup.promise;
              return { content: [{ type: "text", text: "stopped" }], details: {} };
            },
          }),
        );
      }),
    ],
  });
  const bound = turnFor(activation, { streamFn: scripted("unused").streamFn, model });
  const batch = bound.turn.tools({
    ...(await inputFor(session, runWith())),
    assistant: assistant("", { calls: [call("close-1", "close")] }),
  });
  try {
    await within(running.promise);
    let closed = false;
    const closing = activation.close().then(() => {
      closed = true;
    });
    await within(aborted.promise);
    assert.equal(closed, false);
    cleanup.resolve();
    assert.equal((await within(batch)).kind, "complete");
    await within(closing);
    assert.equal(closed, true);
  } finally {
    cleanup.resolve();
    await activation.close();
    await session.close();
  }
});
