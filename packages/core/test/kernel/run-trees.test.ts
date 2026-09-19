/**
 * Run provenance from the workspace tree: a run's first commit and each of its
 * tool-result commits carry the tree the host's VCS backend answered, and
 * `runs.diff` and `runs.revert` read that pair back. The backend is a fake
 * that hands out sequential ids; the real one is proven in `@nyte-ai/host`.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import { treeId, type RunInfo } from "@nyte-ai/protocol";
import type { TreeId, TreeOutcome } from "@nyte-ai/protocol";
import { Type } from "typebox";
import { branch } from "../../src/kernel/graph.ts";
import { headRef } from "../../src/kernel/names.ts";
import { createNyte } from "../../src/kernel/sdk/nyte.ts";
import type { VcsBackend, WorkspaceBackend } from "../../src/kernel/sdk/types.ts";
import { definePlugin, inlinePlugin, type AgentTool } from "../../src/plugins/index.ts";
import type { StreamFn } from "../../src/kernel/loop/types.ts";
import { assistant, call, openStore, usage, within } from "./helpers.ts";

const model: Model<Api> = {
  id: "tree-model",
  name: "Tree",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};

const patch = "--- /dev/null\n+++ b/made.txt\n@@ -0,0 +1 @@\n+hello\n";

/** A tool whose settled class is a file patch, without touching a disk. */
function writeTool(gate: { readonly release: Promise<void> }): AgentTool {
  return {
    name: "write",
    description: "write",
    parameters: Type.Object({ path: Type.String() }),
    execute: async () => {
      await gate.release;
      return { content: [{ type: "text", text: "ok" }], details: {} };
    },
    present: ({ path }, result) =>
      result === undefined
        ? { kind: "file_write", path }
        : { kind: "file_patch", op: "write", path, added: 1, removed: 0, patch },
  };
}

function toolsPlugin(tools: readonly AgentTool[]) {
  return inlinePlugin(
    definePlugin({
      id: "tools",
      session(api) {
        api.tools.add((draft) => {
          for (const item of tools) draft.set(item.name, item);
        });
      },
    }),
  );
}

/** One write call, then a plain answer. */
function script(): StreamFn {
  let requests = 0;
  return () => {
    requests += 1;
    const answer =
      requests === 1
        ? assistant("", { calls: [call("write-1", "write", { path: "made.txt" })] })
        : assistant("done", { usage });
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "start", partial: { ...answer, content: [] } });
    stream.push({ type: "done", reason: requests === 1 ? "toolUse" : "stop", message: answer });
    return stream;
  };
}

function fakeVcs(): VcsBackend & {
  readonly trees: TreeId[];
  readonly restored: { tree: TreeId; paths: readonly string[] }[];
} {
  const trees: TreeId[] = [];
  const restored: { tree: TreeId; paths: readonly string[] }[] = [];
  return {
    trees,
    restored,
    status: async () => ({ files: [] }),
    diff: async () => [],
    async tree(): Promise<TreeOutcome> {
      const id = treeId(String(trees.length + 1).padStart(40, "0"));
      trees.push(id);
      return { kind: "tree", id };
    },
    diffTrees: async ({ from, to }) => [
      { path: `${from.slice(-1)}-${to.slice(-1)}.txt`, kind: "added", added: 1, removed: 0, patch },
    ],
    async restoreTree(input) {
      restored.push({ tree: input.tree, paths: input.paths });
      return { kind: "restored", files: [...input.paths] };
    },
  };
}

function workspaceWith(vcs: VcsBackend | undefined): WorkspaceBackend {
  return {
    list: async () => [],
    touch: async () => undefined,
    forget: async () => undefined,
    files: async () => [],
    ...(vcs === undefined ? {} : { vcs }),
  };
}

async function open(vcs: VcsBackend | undefined, gate: PromiseWithResolvers<void>) {
  const store = openStore();
  const nyte = await createNyte({
    store,
    streamFn: script(),
    models: {
      getModels: () => [model],
      getModel: (_provider, id) => (id === model.id ? model : undefined),
      getAvailable: async () => [model],
    },
    model,
    plugins: [toolsPlugin([writeTool({ release: gate.promise })])],
    env: { cwd: "/tmp/nowhere" },
    workspace: workspaceWith(vcs),
  });
  const { sessionId } = await nyte.sessions.create();
  return { nyte, sessionId, session: await store.open(sessionId) };
}

test("a run's first commit and its tool results carry trees, and runs.diff/revert read the pair", async () => {
  const gate = Promise.withResolvers<void>();
  const vcs = fakeVcs();
  const { nyte, sessionId, session } = await open(vcs, gate);
  try {
    nyte.attach();
    await nyte.messages.send({ sessionId, content: "go" });
    // The write call is parked in the tool: the run is live with one tree recorded.
    // The tree is read before the run ref is published, so wait for the run.
    const run = await within(
      new Promise<RunInfo>((resolve) => {
        const poll = async () => {
          const current = await nyte.runs.current({ sessionId });
          if (current !== undefined) resolve(current);
          else setTimeout(() => void poll(), 5);
        };
        void poll();
      }),
    );
    const liveDiff = await nyte.runs.diff({ sessionId, runId: run.runId });
    assert.equal(liveDiff.kind, "tree");
    if (liveDiff.kind !== "tree") return;
    assert.equal(liveDiff.from, vcs.trees[0]);
    assert.equal(liveDiff.to, vcs.trees[1]);
    assert.deepEqual(await nyte.runs.revert({ sessionId, runId: run.runId }), {
      kind: "busy",
      run,
    });

    gate.resolve();
    assert.deepEqual(await nyte.runs.wait({ sessionId }), { kind: "idle" });
    const commits = (await branch(session.objects, await session.refs.read(headRef("main")))).map(
      (item) => item.commit,
    );
    const [request, ask, result, answer] = commits;
    assert.equal(request?.tree, vcs.trees[0]);
    assert.equal(ask?.tree, undefined);
    assert.ok(result?.body.kind === "message" && result.body.message.role === "toolResult");
    assert.equal(result.tree, vcs.trees[2]);
    assert.equal(answer?.tree, undefined);

    const diff = await nyte.runs.diff({ sessionId, runId: run.runId });
    assert.deepEqual(diff, {
      kind: "tree",
      from: vcs.trees[0],
      to: vcs.trees[2],
      files: [{ path: "1-3.txt", kind: "added", added: 1, removed: 0, patch }],
    });
    assert.deepEqual(await nyte.runs.revert({ sessionId, runId: run.runId }), {
      kind: "reverted",
      files: ["1-3.txt"],
    });
    assert.deepEqual(vcs.restored, [{ tree: vcs.trees[0], paths: ["1-3.txt"] }]);
    assert.deepEqual(await nyte.runs.diff({ sessionId, runId: "nope" }), { kind: "not_found" });
  } finally {
    gate.resolve();
    await nyte.close();
  }
});

test("without a backend runs.diff answers recorded from file_patch facts and revert has no tree", async () => {
  const gate = Promise.withResolvers<void>();
  gate.resolve();
  const { nyte, sessionId, session } = await open(undefined, gate);
  try {
    nyte.attach();
    await nyte.messages.send({ sessionId, content: "go" });
    assert.deepEqual(await nyte.runs.wait({ sessionId }), { kind: "idle" });
    const commits = await branch(session.objects, await session.refs.read(headRef("main")));
    assert.ok(commits.every((item) => item.commit.tree === undefined));
    const runId = commits[0]?.commit.run;
    assert.ok(runId !== undefined);
    assert.deepEqual(await nyte.runs.diff({ sessionId, runId }), {
      kind: "recorded",
      files: [{ path: "made.txt", kind: "added", added: 1, removed: 0, patch }],
    });
    assert.deepEqual(await nyte.runs.diff({ sessionId, runId, paths: ["other.txt"] }), {
      kind: "recorded",
      files: [],
    });
    assert.deepEqual(await nyte.runs.revert({ sessionId, runId }), { kind: "no_tree" });
  } finally {
    await nyte.close();
  }
});
