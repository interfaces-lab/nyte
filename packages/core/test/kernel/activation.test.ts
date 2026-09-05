/**
 * Activation: a plugin list becomes tools, a prompt, settings, and hooks, and
 * `turnFor` resolves each run's inputs before the turn runs.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { contentText, createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import type { AssistantMessage } from "@nyte-ai/schema";
import { Type } from "typebox";
import { headRef } from "../../src/kernel/names.ts";
import { activate, turnFor, type Notice } from "../../src/kernel/sdk/activation.ts";
import type { Run } from "../../src/kernel/model.ts";
import type { Session } from "../../src/kernel/store.ts";
import type { TurnInput } from "../../src/kernel/turn.ts";
import {
  definePlugin,
  inlinePlugin,
  type AgentTool,
  type Plugin,
  type PluginSession,
} from "../../src/plugins/index.ts";
import type { StreamFn } from "../../src/types.ts";
import { assistant, call, commit, lease, message, openSession, seedHead, user } from "./helpers.ts";

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
    execute: async (_id, params) => {
      seen.push(params);
      return { content: [{ type: "text", text: `echo ${params.path}` }], details: {} };
    },
  };
}

function plugin(id: string, session: Plugin["session"]): Plugin {
  return definePlugin({ id, session });
}

/** Answers every request with `text` and records the system prompt it was given. */
function scripted(text: string) {
  const prompts: string[] = [];
  const streamFn: StreamFn = (_model, context) => {
    prompts.push(context.systemPrompt ?? "");
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
    lease: held,
    run,
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
  phase: { kind: "respond" },
  startedAt: 1,
  attempts: 0,
  config,
});

test("plugins contribute tools, prompt sections, and settings that live in the session's facts", async () => {
  const session = await openSession();
  const seen: unknown[] = [];
  const activation = await activate({
    target: { kind: "session", session },
    env,
    plugins: [
      inlinePlugin(
        plugin("base", (api) => {
          api.tools.add((draft) => draft.set("echo", echoTool(seen)));
          api.prompt.add((draft) => draft.set("intro", { text: "You are terse.", order: 1 }));
          api.settings.add((draft) =>
            draft.set("verbosity", {
              label: "Verbosity",
              key: "verbosity",
              choices: [
                { id: "low", label: "Low" },
                { id: "high", label: "High" },
              ],
            }),
          );
        }),
      ),
      inlinePlugin(
        plugin("extra", (api) => {
          api.prompt.add((draft) => draft.set("more", { text: "Cite sources.", order: 2 }));
        }),
      ),
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
  const reopened = await activate({
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
    inlinePlugin(
      plugin("only", (api) => {
        api.prompt.add((draft) => draft.set("p", { text: "Replaced." }));
      }),
    ),
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
  const activation = await activate({
    target: { kind: "session", session },
    env,
    plugins: [
      inlinePlugin(
        plugin("session-reader", (api) => {
          exposed = api.session;
        }),
      ),
    ],
  });

  assert.ok(exposed);
  assert.deepEqual(Object.keys(exposed).sort(), ["context", "info", "rename"]);
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
  const activation = await activate({
    target: { kind: "session", session },
    env,
    plugins: [
      inlinePlugin(
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
      ),
    ],
  });
  const script = scripted("ok");
  const bound = turnFor(activation, { streamFn: script.streamFn, model });

  const run = runWith();
  await bound.turn.respond(await inputFor(session, run));
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

test("a run's declared agent brings its own model, persona, and step ceiling; an unknown agent falls back", async () => {
  const session = await openSession();
  const activation = await activate({
    target: { kind: "session", session },
    env,
    plugins: [
      inlinePlugin(
        plugin("agents", (api) => {
          api.prompt.add((draft) => draft.set("p", { text: "base" }));
          api.agents.add((draft) =>
            draft.set("reviewer", {
              id: "reviewer",
              model: "openai/other-model",
              system: "You review.",
              steps: 3,
            }),
          );
        }),
      ),
    ],
  });
  const resolved: string[] = [];
  const script = scripted("ok");
  const requested: string[] = [];
  const streamFn: StreamFn = (used, context, options) => {
    requested.push(used.id);
    return script.streamFn(used, context, options);
  };
  const bound = turnFor(activation, {
    streamFn,
    model,
    resolveModel: (ref) => {
      resolved.push(`${ref.provider ?? "?"}/${ref.id}`);
      return ref.id === "other-model" ? other : undefined;
    },
  });

  const reviewer = runWith({ agent: "reviewer" }, "run_r");
  await bound.turn.respond(await inputFor(session, reviewer));
  assert.deepEqual(requested, ["other-model"]);
  assert.deepEqual(resolved, ["openai/other-model"]);
  assert.equal(script.prompts[0], "base\n\nYou review.");
  assert.equal(bound.stepsFor(reviewer), 3);

  const stranger = runWith({ agent: "nobody", model: { id: "missing" } }, "run_s");
  await bound.turn.respond(await inputFor(session, stranger));
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
