import { withPluginSource } from "../../src/plugins/source.ts";
/**
 * The branch declares the prompt and tools the model has. Every test reads the
 * branch back from the store and the request the provider was given; how the
 * kernel arrives there is not asserted.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { contentText, createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import {
  getCurrentSystemMessage,
  getCurrentSystemPrompt,
  getCurrentTools,
  toToolDeclaration,
  type Context,
  type Message,
  type SystemMessage,
  type Usage,
} from "@nyte-ai/schema";
import { Type } from "typebox";
import { branch } from "../../src/kernel/graph.ts";
import { headRef } from "../../src/kernel/names.ts";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import { type Nyte, type SessionId } from "../../src/kernel/sdk/types.ts";
import type { Commit } from "../../src/kernel/model.ts";
import type { Session, Store } from "../../src/kernel/store.ts";
import type { AgentTool, ExecutableTool, StreamFn } from "../../src/kernel/loop/types.ts";
import { definePlugin, type Plugin } from "../../src/plugins/index.ts";
import { drive, step } from "../../src/kernel/step.ts";
import { submit } from "../../src/kernel/queue.ts";
import { bindTurn, type Turn } from "../../src/kernel/turn.ts";
import {
  assistant,
  call,
  drain,
  localEnv,
  localOptions,
  message,
  openStore,
  seedHead,
  setHead,
  storePath,
  usage,
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

const models = {
  getModels: () => [model],
  getModel: () => model,
  getAvailable: async () => [model],
};

function tool(name: string, description = name): ExecutableTool {
  return {
    name,
    description,
    parameters: Type.Object({ path: Type.Optional(Type.String()) }),
    execute: async () => ({ content: [{ type: "text", text: `${name} ran` }], details: {} }),
  };
}

function catalog(
  options: {
    readonly tools?: readonly AgentTool[];
    readonly sections?: Readonly<Record<string, { text: string; order?: number }>>;
    readonly version?: string;
    readonly session?: Parameters<typeof definePlugin>[0]["session"];
  } = {},
): Plugin {
  return withPluginSource(
    definePlugin({
      id: "catalog",
      session(api) {
        api.tools.add((draft) => {
          for (const item of options.tools ?? []) draft.set(item.name, item);
        });
        api.prompt.add((draft) => {
          for (const [id, section] of Object.entries(options.sections ?? {})) {
            draft.set(id, section);
          }
        });
        return options.session?.(api);
      },
    }),
    { source: "inline", version: options.version ?? "v1" },
  );
}

interface Script {
  readonly streamFn: StreamFn;
  /** Every request the provider saw, in order. */
  readonly requests: Context[];
}

/** Answers `call <tool>` with that tool call, everything else with text; records each request. */
function script(onRequest?: (context: Context, session: Session) => Promise<void>): Script {
  const requests: Context[] = [];
  const streamFn: StreamFn = async (_model, context) => {
    requests.push(context);
    const tail = context.messages.findLast((item) => item.role !== "system");
    const text = tail?.role === "user" ? contentText(tail.content) : "";
    const wanted = /^call (\S+)$/u.exec(text)?.[1];
    const answer =
      wanted === undefined || tail?.role !== "user"
        ? assistant("ok")
        : assistant("", { calls: [call(`${wanted}-${String(requests.length)}`, wanted)] });
    const stream = createAssistantMessageEventStream();
    stream.push({
      type: "done",
      reason: answer.stopReason === "toolUse" ? "toolUse" : "stop",
      message: answer,
    });
    return stream;
  };
  return {
    requests,
    streamFn:
      onRequest === undefined
        ? streamFn
        : async (requested, context, options) => {
            const session = sessions.get(requests.length);
            if (session !== undefined) await onRequest(context, session);
            return streamFn(requested, context, options);
          },
  };
}

const sessions = new Map<number, Session>();

async function host(store: Store, streamFn: StreamFn, plugins: readonly Plugin[]): Promise<Nyte> {
  return createNyte({ store, model, models, streamFn, ...localOptions("/tmp/nowhere", plugins) });
}

async function mainBranch(session: Session): Promise<Commit[]> {
  return (await branch(session.objects, await session.refs.read(headRef("main")))).map(
    (entry) => entry.commit,
  );
}

function branchMessages(commits: readonly Commit[]): Message[] {
  return commits.flatMap((commit) => (commit.body.kind === "message" ? [commit.body.message] : []));
}

function systemMessages(commits: readonly Commit[]): SystemMessage[] {
  return branchMessages(commits).flatMap((message) => (message.role === "system" ? [message] : []));
}

async function ask(nyte: Nyte, id: SessionId, content: string): Promise<void> {
  await nyte.messages.send({ sessionId: id, content });
  assert.deepEqual(await within(nyte.runs.wait({ sessionId: id })), { kind: "idle" });
}

test("the first response declares the prompt and tools on the branch before the request, and a reopened store replays them", async () => {
  const path = storePath();
  let tipAtRequest: Message | undefined;
  const scripted = script(async (_context, session) => {
    const commits = await mainBranch(session);
    tipAtRequest = branchMessages(commits).at(-1);
  });
  const store = openStore(path);
  const nyte = await host(store, scripted.streamFn, [
    catalog({
      tools: [tool("grep"), tool("edit")],
      sections: { intro: { text: "You are terse.", order: 0 }, rules: { text: "Cite sources." } },
    }),
  ]);
  const { sessionId: id } = await nyte.sessions.create();
  sessions.set(0, await store.open(id));
  try {
    nyte.attach();
    await ask(nyte, id, "hello");
    await ask(nyte, id, "again");
  } finally {
    await nyte.close();
  }

  // The provider read the prompt and tools from the branch, where they already were.
  assert.equal(tipAtRequest?.role, "system");
  assert.equal(scripted.requests.length, 2);
  for (const request of scripted.requests) {
    assert.equal(request.systemPrompt, undefined);
    assert.equal(request.tools, undefined);
    assert.equal(getCurrentSystemPrompt(request.messages), "You are terse.\n\nCite sources.");
    assert.deepEqual(
      getCurrentTools(request.messages)
        .map((item) => item.name)
        .filter((name) => name === "grep" || name === "edit"),
      ["grep", "edit"],
    );
  }

  // The declaration is durable and made once: nothing changed for the second response.
  const reopened = await openStore(path).open(id);
  const commits = await mainBranch(reopened);
  const declared = systemMessages(commits);
  assert.equal(declared.length, 1);
  assert.deepEqual(declared[0]?.sections, {
    "0000-intro": "You are terse.",
    "0100-rules": "Cite sources.",
  });
  // Declarations are stored stripped of everything executable or display-only.
  for (const item of declared[0]?.toolsAdded ?? []) {
    assert.deepEqual(Object.keys(item).sort(), ["description", "name", "parameters"]);
  }
  assert.deepEqual(
    branchMessages(commits).map((item) => item.role),
    ["user", "system", "assistant", "user", "assistant"],
  );
});

test("a changed catalog declares the delta: removed tools, redefined tools, replaced and dropped sections", async () => {
  const path = storePath();
  const scripted = script();
  const store = openStore(path);
  const before = catalog({
    tools: [tool("grep"), tool("edit", "edits files")],
    sections: { intro: { text: "one", order: 0 }, extra: { text: "gone" } },
  });
  const after = catalog({
    tools: [tool("edit", "edits files carefully"), tool("ls")],
    sections: { intro: { text: "two", order: 0 } },
    version: "v2",
  });
  const nyte = await host(store, scripted.streamFn, [before]);
  const { sessionId: id } = await nyte.sessions.create();
  try {
    nyte.attach();
    await ask(nyte, id, "hello");
    assert.deepEqual(await nyte.setPlugins([after]), { kind: "applied" });
    await ask(nyte, id, "call grep");
  } finally {
    await nyte.close();
  }

  const commits = await mainBranch(await openStore(path).open(id));
  const [, delta] = systemMessages(commits);
  assert.ok(delta);
  assert.deepEqual(delta.sections, { "0000-intro": "two", "0100-extra": null });
  assert.deepEqual(
    delta.toolsRemoved?.map((item) => item.name),
    ["grep", "edit"],
  );
  assert.deepEqual(
    delta.toolsAdded?.map((item) => [item.name, item.description]),
    [
      ["edit", "edits files carefully"],
      ["ls", "ls"],
    ],
  );
  const own = (messages: readonly Message[]) =>
    getCurrentTools(messages)
      .map((item) => item.name)
      .filter((name) => name === "grep" || name === "edit" || name === "ls");
  const replayed = getCurrentSystemMessage(branchMessages(commits));
  assert.equal(replayed && getCurrentSystemPrompt([replayed]), "two");
  assert.deepEqual(own(branchMessages(commits)), ["edit", "ls"]);
  const second = scripted.requests[1];
  assert.ok(second);
  assert.deepEqual(own(second.messages), ["edit", "ls"]);

  // The old declaration cannot resurrect the removed tool: the call errors and runs nothing.
  const result = branchMessages(commits).findLast((item) => item.role === "toolResult");
  assert.ok(result?.role === "toolResult");
  assert.equal(result.isError, true);
  assert.match(JSON.stringify(result.content), /Tool grep not found/u);
});

test("a rewound head redeclares against the replayed older tip, and a forked head inherits its declarations", async () => {
  const path = storePath();
  const scripted = script();
  const store = openStore(path);
  const nyte = await host(store, scripted.streamFn, [
    catalog({ tools: [tool("grep")], sections: { intro: { text: "one", order: 0 } } }),
  ]);
  const { sessionId: id } = await nyte.sessions.create();
  try {
    nyte.attach();
    await ask(nyte, id, "first");
    const session = await store.open(id);
    const [opening] = await branch(session.objects, await session.refs.read(headRef("main")));
    assert.ok(opening);
    assert.deepEqual(
      await nyte.setPlugins([
        catalog({
          tools: [tool("grep")],
          sections: { intro: { text: "two", order: 0 } },
          version: "v2",
        }),
      ]),
      { kind: "applied" },
    );

    // A fork from the declared tip carries the declaration; its next response patches only the prompt.
    assert.equal(
      (await nyte.heads.create({ sessionId: id, head: "fork", from: { head: "main" } })).kind,
      "created",
    );
    await nyte.messages.send({ sessionId: id, head: "fork", content: "forked" });
    assert.deepEqual(await within(nyte.runs.wait({ sessionId: id, head: "fork" })), {
      kind: "idle",
    });
    const fork = (await branch(session.objects, await session.refs.read(headRef("fork")))).map(
      (entry) => entry.commit,
    );
    const forkDeltas = systemMessages(fork);
    assert.equal(forkDeltas.length, 2);
    assert.deepEqual(forkDeltas[1], { ...forkDeltas[1], sections: { "0000-intro": "two" } });
    assert.equal(forkDeltas[1]?.toolsAdded, undefined);
    assert.equal(forkDeltas[1]?.toolsRemoved, undefined);

    // Rewinding main to its opening message leaves nothing declared; the next response declares everything.
    assert.equal((await nyte.heads.move({ sessionId: id, to: opening.oid })).kind, "moved");
    await ask(nyte, id, "after rewind");
    const main = await mainBranch(session);
    const redeclared = systemMessages(main);
    assert.equal(redeclared.length, 1);
    assert.deepEqual(redeclared[0]?.sections, { "0000-intro": "two" });
    assert.ok(redeclared[0]?.toolsAdded?.some((item) => item.name === "grep"));
    const last = scripted.requests.at(-1);
    assert.ok(last);
    assert.equal(getCurrentSystemPrompt(last.messages), "two");
  } finally {
    await nyte.close();
  }
});

test("a declaration is not a response attempt: a one-step agent still answers", async () => {
  const scripted = script();
  const nyte = await host(openStore(storePath()), scripted.streamFn, [
    catalog({
      tools: [tool("grep")],
      sections: { intro: { text: "base", order: 0 } },
      session(api) {
        api.agents.add((draft) =>
          draft.set("brief", { id: "brief", system: "Be brief.", steps: 1 }),
        );
      },
    }),
  ]);
  const { sessionId: id } = await nyte.sessions.create();
  try {
    nyte.attach();
    await nyte.messages.send({ sessionId: id, content: "hello", agent: "brief" });
    assert.deepEqual(await within(nyte.runs.wait({ sessionId: id })), { kind: "idle" });
    const run = await nyte.runs.current({ sessionId: id });
    assert.equal(run?.phase.kind, "done");
    assert.equal(scripted.requests.length, 1);
    assert.equal(getCurrentSystemPrompt(scripted.requests[0]?.messages ?? []), "base\n\nBe brief.");
  } finally {
    await nyte.close();
  }
});

test("a declaration that loses the head to a participant is not forced; the next step declares on the moved head", async () => {
  const session = await openStore().create();
  const [opening] = await seedHead(session, "main", [message(user("first"))]);
  assert.ok(opening);
  const scripted = script();
  const inner = bindTurn({
    streamFn: scripted.streamFn,
    model,
    sections: { "0000-intro": "base" },
    tools: [tool("grep")],
    env: localEnv("/tmp/nowhere"),
  });
  let moves = 0;
  const racing: Turn = {
    ...inner,
    prepare: async (input) => {
      assert.ok(inner.prepare);
      const outcome = await inner.prepare(input);
      if (outcome.kind === "system" && moves === 0) {
        moves += 1;
        await setHead(session, "main", opening);
      }
      return outcome;
    },
  };
  await submit(session, {
    preparation: { kind: "none" },
    head: "main",
    delivery: "steer",
    kind: "user",
    body: message(user("second")),
  });
  assert.equal((await step(session, racing, { head: "main", drain })).kind, "continue");
  assert.equal((await step(session, racing, { head: "main", drain })).kind, "continue");
  assert.equal(await session.refs.read(headRef("main")), opening);
  assert.equal(scripted.requests.length, 0);

  // The run goes on from where the participant put the head and declares there.
  const outcome = await drive(session, racing, { head: "main", drain });
  assert.equal(outcome.kind, "finished");
  const commits = await mainBranch(session);
  assert.deepEqual(
    branchMessages(commits).map((item) => item.role),
    ["user", "system", "assistant"],
  );
  assert.equal(commits[1]?.parent, opening);
  assert.equal(getCurrentSystemPrompt(scripted.requests[0]?.messages ?? []), "base");
});

test("a transformed context never changes what the branch declares, and a forced prompt heads only that request", async () => {
  const path = storePath();
  const scripted = script();
  const seen: { visible: string[]; prompt: string; transcript: string[] }[] = [];
  const nyte = await host(openStore(path), scripted.streamFn, [
    catalog({
      tools: [tool("grep")],
      sections: { intro: { text: "base", order: 0 } },
      session(api) {
        api.hook("transform_context", (event) => {
          seen.push({
            visible: event.messages.map((item) => item.role),
            prompt: event.systemPrompt,
            transcript: [],
          });
          return { systemPrompt: `${event.systemPrompt} + forced` };
        });
        api.hook("transform_transcript", (event) => {
          const last = seen.at(-1);
          if (last !== undefined) last.transcript = event.messages.map((item) => item.role);
          return undefined;
        });
      },
    }),
  ]);
  const { sessionId: id } = await nyte.sessions.create();
  try {
    nyte.attach();
    await ask(nyte, id, "hello");
    await ask(nyte, id, "again");
  } finally {
    await nyte.close();
  }
  assert.deepEqual(seen[0], { visible: ["user"], prompt: "base", transcript: ["user", "system"] });
  assert.deepEqual(seen[1]?.visible, ["user", "assistant", "user"]);
  assert.equal(seen[1]?.prompt, "base");
  for (const request of scripted.requests) {
    assert.equal(getCurrentSystemPrompt(request.messages), "base + forced");
    assert.equal(request.messages[0]?.role, "system");
    assert.ok(getCurrentTools(request.messages).some((item) => item.name === "grep"));
  }
  const commits = await mainBranch(await openStore(path).open(id));
  const declared = systemMessages(commits);
  assert.equal(declared.length, 1);
  assert.equal(getCurrentSystemPrompt(declared), "base");
});

test("a checkpoint carries the prompt and tools the model had, and the response after it reads them from the checkpoint", async () => {
  const path = storePath();
  const session = await openStore(path).create();
  const heavy: Usage = { ...usage, input: 900, output: 50, totalTokens: 950 };
  const declaration: SystemMessage = {
    role: "system",
    content: "",
    sections: { "0000-intro": "base" },
    toolsAdded: [toToolDeclaration(tool("grep"))],
    timestamp: 1_000,
  };
  await seedHead(session, "main", [
    message(user("first question, with quite a lot of words in it to take up room")),
    message(declaration),
    message(assistant("first answer, also with a good number of words to take up room")),
    message(user("second question")),
    message(assistant("second answer", { usage: heavy })),
  ]);
  const scripted = script();
  const turn = bindTurn({
    streamFn: scripted.streamFn,
    compactionStreamFn: async () => {
      const stream = createAssistantMessageEventStream();
      stream.push({ type: "done", reason: "stop", message: assistant("SHORTER") });
      return stream;
    },
    model: { ...model, contextWindow: 1_000, maxTokens: 100 },
    sections: { "0000-intro": "base" },
    tools: [tool("grep")],
    env: localEnv("/tmp/nowhere"),
    compaction: { enabled: true, reserveTokens: 100, keepRecentTokens: 40 },
  });
  await submit(session, {
    preparation: { kind: "none" },
    head: "main",
    delivery: "steer",
    kind: "user",
    body: message(user("third question")),
  });
  assert.equal((await drive(session, turn, { head: "main", drain })).kind, "finished");

  const commits = await mainBranch(await openStore(path).open(session.id));
  const checkpoint = commits.find((commit) => commit.body.kind === "checkpoint");
  assert.ok(checkpoint?.body.kind === "checkpoint");
  assert.equal(
    checkpoint.body.systemMessage && getCurrentSystemPrompt([checkpoint.body.systemMessage]),
    "base",
  );
  assert.deepEqual(
    checkpoint.body.systemMessage?.toolsAdded?.map((item) => item.name),
    ["grep"],
  );
  assert.ok(checkpoint.body.retainedTail.every((item) => item.role !== "system"));
  assert.match(checkpoint.body.summary, /SHORTER/u);

  // Nothing was declared again after the checkpoint; the request replays its state.
  assert.ok(
    commits
      .slice(commits.indexOf(checkpoint) + 1)
      .every((commit) => commit.body.kind !== "message" || commit.body.message.role !== "system"),
  );
  const request = scripted.requests.at(-1);
  assert.ok(request);
  assert.equal(getCurrentSystemPrompt(request.messages), "base");
  assert.deepEqual(
    getCurrentTools(request.messages).map((item) => item.name),
    ["grep"],
  );
  assert.match(JSON.stringify(request.messages), /SHORTER/u);
});
