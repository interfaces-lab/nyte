import assert from "node:assert/strict";
import { test } from "vitest";
import { createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import { schemas } from "@nyte-ai/protocol";
import { Value } from "typebox/value";
import type { AssistantMessage } from "@nyte-ai/schema";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import {
  sessionId,
  type Nyte,
  type NyteOptions,
  type SummaryDiagnostic,
  type SessionEvent,
} from "../../src/kernel/sdk/types.ts";
import { definePlugin, type Plugin } from "../../src/plugins/index.ts";
import type { StreamFn } from "../../src/kernel/loop/types.ts";
import {
  assistant,
  localOptions,
  localWorkspace,
  message,
  openStore,
  seedHead,
  storePath,
  usage,
  user,
  within,
} from "./helpers.ts";

const model: Model<Api> = {
  id: "activation-model",
  name: "Activation",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 10_000,
  maxTokens: 1_000,
};

function responseStream(onRequest?: () => void): StreamFn {
  return () => {
    onRequest?.();
    const stream = createAssistantMessageEventStream();
    const answer: AssistantMessage = assistant("active", { usage });
    stream.push({ type: "start", partial: { ...answer, content: [] } });
    stream.push({ type: "done", reason: "stop", message: answer });
    return stream;
  };
}

function openHost(input: {
  readonly trust: NonNullable<NyteOptions["trust"]>;
  readonly plugins?: readonly Plugin[];
  readonly store?: ReturnType<typeof openStore>;
  readonly streamFn?: StreamFn;
  readonly onDiagnostic?: NyteOptions["onDiagnostic"];
}): Promise<Nyte> {
  return createNyte({
    store: input.store ?? openStore(),
    streamFn: input.streamFn ?? responseStream(),
    models: { getModels: () => [model], getModel: () => model, getAvailable: async () => [model] },
    model,
    ...localOptions("/workspace", input.plugins),
    trust: input.trust,
    onDiagnostic: input.onDiagnostic,
  });
}

function countingPlugin(onSession: () => void): Plugin {
  return definePlugin({
    id: "activation-plugin",
    session() {
      onSession();
    },
  });
}

async function nextActivation(
  iterator: AsyncIterator<SessionEvent>,
): Promise<Extract<SessionEvent, { readonly kind: "activation_changed" }>> {
  for (;;) {
    const result = await within(iterator.next());
    if (result.done) assert.fail("watch ended before activation changed");
    if (result.value.kind === "activation_changed") return result.value;
  }
}

test("session reads expose requires without instantiating plugins", async () => {
  let pluginSessions = 0;
  const plugin = countingPlugin(() => {
    pluginSessions += 1;
  });
  const nyte = await openHost({
    trust: () => ({
      kind: "requires",
      requirement: { kind: "workspace_trust", cwd: "/workspace" },
    }),
  });
  try {
    await nyte.setPlugins([plugin]);
    nyte.attach();
    const created = await nyte.sessions.create();
    assert.deepEqual(created.activation, {
      kind: "requires",
      requirement: { kind: "workspace_trust", cwd: "/workspace" },
    });
    assert.equal(
      (await nyte.sessions.get({ sessionId: created.sessionId }))?.activation.kind,
      "requires",
    );
    assert.equal((await nyte.sessions.list()).items[0]?.activation.kind, "requires");
    assert.equal(
      (await nyte.sessions.snapshot({ sessionId: created.sessionId }))?.session.activation.kind,
      "requires",
    );
    assert.equal(pluginSessions, 0);
  } finally {
    await nyte.close();
  }
});

test("active session reads do not instantiate plugins", async () => {
  let pluginSessions = 0;
  const plugin = countingPlugin(() => {
    pluginSessions += 1;
  });
  const nyte = await openHost({ trust: () => ({ kind: "trusted" }), plugins: [plugin] });
  try {
    const created = await nyte.sessions.create();
    await nyte.sessions.get({ sessionId: created.sessionId });
    await nyte.sessions.list();
    await nyte.sessions.snapshot({ sessionId: created.sessionId });
    assert.equal(pluginSessions, 0);
    await nyte.plugins.list({ sessionId: created.sessionId });
    assert.equal(pluginSessions, 1);
  } finally {
    await nyte.close();
  }
});

test("a child of a refused root announces its activation once, however often it is read", async () => {
  const nyte = await openHost({
    trust: () => ({
      kind: "requires",
      requirement: { kind: "workspace_trust", cwd: "/workspace" },
    }),
  });
  const controller = new AbortController();
  try {
    const root = await nyte.sessions.create();
    const { sessionId } = await nyte.sessions.create({
      parent: { sessionId: root.sessionId, runId: "run_1", callId: "call_1", depth: 1 },
    });
    const watching = nyte
      .watch({ sessionId, live: true, signal: controller.signal })
      [Symbol.asyncIterator]();
    assert.equal((await nextActivation(watching)).activation.kind, "requires");
    await nyte.sessions.get({ sessionId });
    assert.deepEqual(await nyte.plugins.commands.list({ sessionId }), []);
    await nyte.sessions.setPinned({ sessionId, pinned: true });
    const activations: SessionEvent[] = [];
    for (;;) {
      const result = await within(watching.next());
      if (result.done) assert.fail("watch ended before the pin");
      if (result.value.kind === "fact" && result.value.key === "pinned") break;
      if (result.value.kind === "activation_changed") activations.push(result.value);
    }
    assert.deepEqual(activations, []);
  } finally {
    controller.abort();
    await nyte.close();
  }
});

test("watch replays current activation and observes requires to active", async () => {
  let active = false;
  const nyte = await openHost({
    trust: () =>
      active
        ? { kind: "trusted" }
        : {
            kind: "requires",
            requirement: { kind: "workspace_trust", cwd: "/workspace" },
          },
  });
  const controller = new AbortController();
  try {
    const session = await nyte.sessions.create();
    const watching = nyte
      .watch({ sessionId: session.sessionId, live: true, signal: controller.signal })
      [Symbol.asyncIterator]();
    assert.equal((await nextActivation(watching)).activation.kind, "requires");
    active = true;
    await nyte.reactivate();
    assert.equal((await nextActivation(watching)).activation.kind, "active");
  } finally {
    controller.abort();
    await nyte.close();
  }
});

test("send queues under requires and reactivate starts the attached runner", async () => {
  let active = false;
  let pluginSessions = 0;
  const plugin = countingPlugin(() => {
    pluginSessions += 1;
  });
  const nyte = await openHost({
    trust: () =>
      active
        ? { kind: "trusted" }
        : {
            kind: "requires",
            requirement: { kind: "workspace_trust", cwd: "/workspace" },
          },
    plugins: [plugin],
  });
  try {
    const session = await nyte.sessions.create();
    nyte.attach({ sessions: [session.sessionId] });
    const receipt = await nyte.messages.send({ sessionId: session.sessionId, content: "hello" });
    assert.equal(receipt.kind, "queued");
    assert.equal((await nyte.messages.pending({ sessionId: session.sessionId })).length, 1);
    assert.equal(pluginSessions, 0);

    active = true;
    await nyte.reactivate();
    assert.deepEqual(await nyte.runs.wait({ sessionId: session.sessionId }), { kind: "idle" });
    assert.equal((await nyte.messages.pending({ sessionId: session.sessionId })).length, 0);
    assert.equal(pluginSessions, 1);
  } finally {
    await nyte.close();
  }
});

test("reactivate refreshes every blocked session and the prospective catalog", async () => {
  let active = false;
  const plugin = definePlugin({
    id: "next",
    session(api) {
      api.commands.add((draft) => draft.set("hello", { description: "Hi", run: () => "hi" }));
    },
  });
  const nyte = await openHost({
    trust(workspace) {
      if (active) return { kind: "trusted" };
      return workspace.cwd === "/inactive"
        ? { kind: "inactive" }
        : {
            kind: "requires",
            requirement: { kind: "workspace_trust", cwd: "/workspace" },
          };
    },
    plugins: [plugin],
  });
  try {
    assert.deepEqual((await nyte.plugins.catalog()).commands, []);
    const required = await nyte.sessions.create({ sessionId: sessionId("required") });
    const inactive = await nyte.sessions.create({
      sessionId: sessionId("inactive"),
      workspace: localWorkspace("/inactive"),
    });
    assert.equal(required.activation.kind, "requires");
    assert.equal(inactive.activation.kind, "inactive");
    assert.deepEqual(await nyte.plugins.commands.list({ sessionId: inactive.sessionId }), []);

    active = true;
    await nyte.reactivate();
    for (const { sessionId: id } of [required, inactive]) {
      assert.equal((await nyte.sessions.get({ sessionId: id }))?.activation.kind, "active");
      assert.deepEqual(
        (await nyte.plugins.commands.list({ sessionId: id })).map((command) => command.name),
        ["hello"],
      );
    }
    assert.deepEqual(
      (await nyte.plugins.catalog()).commands.map((command) => command.name),
      ["hello"],
    );
  } finally {
    await nyte.close();
  }
});

test("inactive plugin reads are empty and mutations are not_found", async () => {
  const nyte = await openHost({ trust: () => ({ kind: "inactive" }) });
  try {
    const session = await nyte.sessions.create();
    assert.deepEqual(await nyte.plugins.catalog(), {
      plugins: [],
      commands: [],
      skills: [],
      settings: [],
    });
    assert.deepEqual(await nyte.plugins.list({ sessionId: session.sessionId }), []);
    assert.deepEqual(await nyte.plugins.commands.list({ sessionId: session.sessionId }), []);
    assert.deepEqual(await nyte.plugins.settings.list({ sessionId: session.sessionId }), []);
    assert.deepEqual(await nyte.plugins.resources.list({ sessionId: session.sessionId }), []);
    assert.deepEqual(await nyte.plugins.status.list({ sessionId: session.sessionId }), []);
    assert.deepEqual(
      await nyte.plugins.commands.run({ sessionId: session.sessionId, name: "missing" }),
      { kind: "not_found" },
    );
    assert.deepEqual(
      await nyte.plugins.settings.apply({
        sessionId: session.sessionId,
        id: "missing",
        choiceId: "missing",
      }),
      { kind: "not_found" },
    );
    assert.deepEqual(
      await nyte.sessions.configure({ sessionId: session.sessionId, agent: "missing" }),
      { kind: "unknown_agent" },
    );
  } finally {
    await nyte.close();
  }
});

test("inactive compaction and summary fail without writes", async () => {
  const store = openStore();
  const stored = await store.create({ id: "inactive-work" });
  const oids = await seedHead(stored, "main", [
    message(user("first")),
    message(assistant("answer")),
    message(user("second")),
  ]);
  const target = oids[0];
  const tip = oids.at(-1);
  assert.ok(target !== undefined && tip !== undefined);
  const diagnostics: SummaryDiagnostic[] = [];
  let modelCalls = 0;
  const nyte = await openHost({
    store,
    streamFn: responseStream(() => {
      modelCalls += 1;
    }),
    trust: () => ({ kind: "inactive" }),
    onDiagnostic: (diagnostic) => {
      diagnostics.push(diagnostic);
    },
  });
  try {
    const id = sessionId("inactive-work");
    const seq = await stored.events.last();
    const refs = await stored.refs.list("");
    const objects = await stored.objects.list();
    const compacted = await nyte.runs.compact({ sessionId: id });
    assert.deepEqual(compacted, {
      kind: "failed",
      code: "inactive",
      message: "Session is not active in this host",
    });
    assert.ok(Value.Check(schemas.CheckpointFailure, compacted));
    assert.deepEqual(await stored.refs.list(""), refs);
    assert.deepEqual(await stored.objects.list(), objects);
    assert.equal(await stored.events.last(), seq);
    assert.deepEqual(diagnostics, []);
    const moved = await nyte.heads.move({ sessionId: id, to: target, summary: {} });
    assert.deepEqual(moved, {
      kind: "failed",
      code: "inactive",
      message: "Session is not active in this host",
    });
    assert.ok(Value.Check(schemas.MoveOutcome, moved));
    assert.deepEqual(await stored.refs.list(""), refs);
    assert.deepEqual(await stored.objects.list(), objects);
    assert.deepEqual(diagnostics, []);
    assert.equal((await nyte.heads.list({ sessionId: id }))[0]?.tip, tip);
    assert.equal(await stored.events.last(), seq);
    assert.equal(modelCalls, 0);
  } finally {
    await nyte.close();
  }
});

test("trust faults reject, are not cached, and never become requires", async () => {
  let calls = 0;
  const nyte = await openHost({
    trust: () => {
      calls += 1;
      if (calls < 3) throw new Error(`trust fault ${String(calls)}`);
      return { kind: "trusted" };
    },
  });
  try {
    await assert.rejects(nyte.sessions.create({ sessionId: sessionId("fault") }), /trust fault 1/);
    await assert.rejects(nyte.sessions.get({ sessionId: sessionId("fault") }), /trust fault 2/);
    const session = await nyte.sessions.get({ sessionId: sessionId("fault") });
    assert.equal(session?.activation.kind, "active");
    assert.equal(calls, 3);
  } finally {
    await nyte.close();
  }
});

for (const operation of ["runs.compact", "heads.move"] satisfies SummaryDiagnostic["operation"][]) {
  test(`${operation} reports trust faults as unexpected without writes`, async () => {
    const store = openStore();
    const stored = await store.create();
    await seedHead(stored, "main", [message(user("first")), message(user("second"))]);
    const cause = new Error("Session is not active in this host");
    const diagnostics: SummaryDiagnostic[] = [];
    const nyte = await openHost({
      store,
      trust: () => {
        throw cause;
      },
      onDiagnostic: (diagnostic) => {
        diagnostics.push(diagnostic);
      },
      streamFn: () => assert.fail("A trust failure must prevent provider work"),
    });
    try {
      const id = sessionId(stored.id);
      const seq = await stored.events.last();
      const refs = await stored.refs.list("");
      const objects = await stored.objects.list();
      const outcome =
        operation === "runs.compact"
          ? await nyte.runs.compact({ sessionId: id })
          : await nyte.heads.move({ sessionId: id, to: null, summary: {} });
      assert.ok(outcome.kind === "failed" && outcome.code === "internal");
      assert.ok(Value.Check(schemas.SummaryFailure, outcome));
      assert.deepEqual(diagnostics, [{ ...outcome, operation, cause }]);
      assert.equal(diagnostics[0]?.cause, cause);
      assert.deepEqual(await stored.refs.list(""), refs);
      assert.deepEqual(await stored.objects.list(), objects);
      assert.equal(await stored.events.last(), seq);
      await assert.rejects(nyte.sessions.get({ sessionId: id }), (error) => error === cause);
    } finally {
      await nyte.close();
    }
  });
}

test("a new plugin set recovers a child read before its failed root", async () => {
  const path = storePath();
  let broken = false;
  const trust: NonNullable<NyteOptions["trust"]> = () => ({
    kind: "trusted",
    plugins: async () => {
      if (broken) throw new Error("project plugins failed");
      return [];
    },
  });
  const first = await openHost({ trust, store: openStore(path) });
  const root = (await first.sessions.create()).sessionId;
  const parent = { sessionId: root, runId: "run_1", callId: "call_1", depth: 1 };
  const child = (await first.sessions.create({ parent })).sessionId;
  await first.close();
  broken = true;
  const nyte = await openHost({ trust, store: openStore(path) });
  try {
    assert.equal((await nyte.sessions.get({ sessionId: child }))?.activation.kind, "failed");
    assert.equal((await nyte.sessions.list({ parent: root })).items[0]?.activation.kind, "failed");
    broken = false;
    await nyte.setPlugins([]);
    assert.equal((await nyte.sessions.list({ parent: root })).items[0]?.activation.kind, "active");
  } finally {
    await nyte.close();
  }
});
