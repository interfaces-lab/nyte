import { asId } from "@nyte-ai/schema";
import type { CallId, SessionId, SnapshotId } from "@nyte-ai/schema";
import { describe, expect, it } from "vitest";
import { memoryStore } from "../src/store.ts";
import type { SnapshotsApi, ToolDefinition } from "../src/index.ts";
import { main, recording, setup } from "../src/harness.ts";
import { requireSession } from "../src/store/session.ts";
import { collect } from "./fake-env.ts";
import { echo, toolPlugin, liveRun, call, readRun, scripted, toolPart } from "./tool-support.ts";

function treeSnapshots(tree: Map<string, string>): SnapshotsApi {
  const trees = new Map<SnapshotId, ReadonlyMap<string, string>>();

  const take = async (): Promise<SnapshotId> => {
    const id = asId<"snapshot">(`t${String(trees.size)}`);
    trees.set(id, new Map(tree));

    return id;
  };

  return {
    before: take,
    after: take,
    diff: async (from, to) => {
      const before = trees.get(from) ?? new Map<string, string>();
      const after = trees.get(to) ?? new Map<string, string>();

      return {
        revision: to,
        files: [...new Set([...before.keys(), ...after.keys()])].flatMap((path) =>
          before.get(path) === after.get(path)
            ? []
            : [
                {
                  path,
                  status: "modified" as const,
                  stat: { kind: "text" as const, added: 1, removed: 1 },
                },
              ],
        ),
      };
    },
    patches: async (_from, _to, paths) =>
      paths.map((path) => ({
        path,
        status: "modified" as const,
        digest: "",
        kind: "binary" as const,
      })),
  };
}

async function sharedFolder(subagent = false) {
  const tree = new Map<string, string>();
  const gates = new Map<
    string,
    { readonly entered: () => void; readonly release: Promise<void> }
  >();

  const pass = async (key: string): Promise<void> => {
    const gate = gates.get(key);
    gate?.entered();
    await gate?.release;
  };

  const done = (text: string) => ({ content: [{ kind: "text" as const, text }] });

  const edit = {
    ...echo,
    name: "edit",
    class: (args) => ({ kind: "edit", path: args.text }),
    execute: async (args, invocation) => {
      tree.set(args.text.replace("/tmp/project/", ""), invocation.call);
      await pass(args.text);

      return done(args.text);
    },
  } satisfies ToolDefinition<{ text: string }>;

  const remove = {
    ...edit,
    name: "remove",
    execute: async (args) => {
      tree.delete(args.text);

      return done(args.text);
    },
  } satisfies ToolDefinition<{ text: string }>;

  const shell = {
    ...echo,
    name: "shell",
    class: (args) => ({ kind: "shell", command: args.text }),
    execute: async (args) => {
      await pass(args.text);

      return done(args.text);
    },
  } satisfies ToolDefinition<{ text: string }>;

  const { kernel, host, script } = await setup({
    plugins: [toolPlugin([edit, remove, shell])],
    snapshots: treeSnapshots(tree),
  });

  const start = async (turns: number, parent?: SessionId) => {
    const { session } = await host.sessions.start({ content: "Hi.", parent });
    const running = host.execution.advance({ session: session.id, head: main });
    const turn = await script.started(turns);

    return { session, running, turn, run: turn.input.run.id };
  };

  const a = await start(1);
  const b = await start(2, subagent ? a.session.id : undefined);
  const { workspace } = (await requireSession(kernel.store, a.session.id)).record;

  return {
    a,
    b,
    workspace: host.workspace(workspace),
    act: (chat: typeof a, id: string, name: string, text: string) =>
      call(kernel, { session: chat.session.id, run: chat.run, call: id, name, args: { text } }),
    paths: async (chat: typeof a) => (await chat.session.view()).changes.map((file) => file.path),
    hold: (key: string) => {
      const entered = Promise.withResolvers<void>();
      const release = Promise.withResolvers<void>();
      gates.set(key, { entered: entered.resolve, release: release.promise });

      return { entered: entered.promise, release: release.resolve };
    },
    finish: async () => {
      a.turn.finish();
      b.turn.finish();
      await Promise.all([a.running, b.running]);
    },
  };
}

describe("tool changes", () => {
  it("lands a write's snapshot changes on its part and the session's changes", async () => {
    const recorded = recording(await memoryStore().open());

    const edit = {
      ...echo,
      name: "edit",
      class: () => ({ kind: "edit", path: "a.ts" }),
    } satisfies ToolDefinition<{ text: string }>;

    const taken: string[] = [];
    const snapshots = scripted(taken);

    const { kernel, host } = await setup({
      store: recorded.store,
      plugins: [toolPlugin([edit])],
      snapshots,
    });

    const { session } = await host.sessions.start({ content: "Hi." });
    const run = await liveRun(kernel, session.id);

    await call(kernel, { session: session.id, run, call: "e1", name: "edit", args: { text: "x" } });

    expect(taken).toEqual(["after", "after"]);
    expect((await toolPart(session, "e1")).state).toMatchObject({
      changes: { added: 3, removed: 1, paths: ["a.ts"] },
    });
    expect((await session.view()).changes).toEqual([
      { path: "a.ts", status: "modified", added: 3, removed: 1 },
    ]);
    expect(recorded.sets.at(-1)).toEqual(["call:settled", "changes", "part:settled", "commit"]);

    const call2: CallId = asId("e2");

    await call(kernel, {
      session: session.id,
      run,
      call: call2,
      name: "edit",
      args: { text: "y" },
    });

    expect(taken).toEqual(["after", "after", "after", "after"]);
    expect((await toolPart(session, "e2")).state).toMatchObject({
      changes: { added: 0, removed: 0, paths: [] },
    });
    expect((await session.view()).changes).toHaveLength(1);
    expect((await readRun(kernel, session.id, run)).record).toMatchObject({
      snapshot: asId("s0"),
      lastSnapshot: asId("s1"),
    });

    const restarted = await setup({
      store: recorded.store,
      plugins: [toolPlugin([edit])],
      snapshots,
    });

    await call(restarted.kernel, {
      session: session.id,
      run,
      call: "e3",
      name: "edit",
      args: { text: "z" },
    });

    expect((await toolPart(restarted.host.session(session.id), "e3")).state).toMatchObject({
      changes: { added: 0, removed: 0, paths: [] },
    });
  });

  it("counts the session's changes from its first snapshot, across instances sharing the tree", async () => {
    const store = await memoryStore().open();
    const tree = new Map<string, string>();
    const snapshots = treeSnapshots(tree);

    const edit = {
      ...echo,
      name: "edit",
      class: (args) => ({ kind: "edit", path: args.text }),
      execute: async (args) => {
        if (tree.has(args.text)) tree.delete(args.text);
        else tree.set(args.text, "edited");

        return { content: [{ kind: "text", text: args.text }] };
      },
    } satisfies ToolDefinition<{ text: string }>;

    const a = await setup({ store, plugins: [toolPlugin([edit])], snapshots });
    const b = await setup({ store, plugins: [toolPlugin([edit])], snapshots });
    const { session } = await a.host.sessions.start({ content: "Hi." });
    const running = a.host.execution.advance({ session: session.id, head: main });
    const turn = await a.script.started(1);
    const run = turn.input.run.id;
    await call(a.kernel, {
      session: session.id,
      run,
      call: "e1",
      name: "edit",
      args: { text: "a.ts" },
    });
    await call(b.kernel, {
      session: session.id,
      run,
      call: "e2",
      name: "edit",
      args: { text: "b.ts" },
    });

    const view = await session.view();
    expect(view.turns.at(-1)?.summary).toMatchObject({ added: 2, removed: 2 });
    expect((await toolPart(session, "e2")).state).toMatchObject({
      changes: { added: 1, removed: 1, paths: ["b.ts"] },
    });
    expect(view.changes.map((file) => file.path)).toEqual(["a.ts", "b.ts"]);

    await call(a.kernel, {
      session: session.id,
      run,
      call: "e3",
      name: "edit",
      args: { text: "a.ts" },
    });

    expect((await session.view()).changes.map((file) => file.path)).toEqual(["b.ts"]);
    turn.finish();
    await running;
  });

  it("does not charge another thread's edits to the next command in a shared folder", async () => {
    const tree = new Map<string, string>();

    const edit = {
      ...echo,
      name: "edit",
      class: (args) => ({ kind: "edit", path: args.text }),
      execute: async (args) => {
        tree.set(args.text, "edited");

        return { content: [{ kind: "text", text: args.text }] };
      },
    } satisfies ToolDefinition<{ text: string }>;

    const { kernel, host, script } = await setup({
      plugins: [toolPlugin([edit, echo])],
      snapshots: treeSnapshots(tree),
    });

    const { session } = await host.sessions.start({ content: "Hi." });
    const running = host.execution.advance({ session: session.id, head: main });
    const turn = await script.started(1);
    const run = turn.input.run.id;

    await call(kernel, {
      session: session.id,
      run,
      call: "e1",
      name: "edit",
      args: { text: "a.ts" },
    });
    const { session: other } = await host.sessions.start({ content: "Another task." });
    const otherRunning = host.execution.advance({ session: other.id, head: main });
    const otherTurn = await script.started(2);
    await call(kernel, {
      session: other.id,
      run: otherTurn.input.run.id,
      call: "other-edit",
      name: "edit",
      args: { text: "other-thread.ts" },
    });
    await call(kernel, { session: session.id, run, call: "e2", name: "echo", args: { text: "x" } });

    expect((await session.view()).turns.at(-1)?.summary).toMatchObject({ added: 1, removed: 1 });
    expect((await other.view()).turns.at(-1)?.summary).toMatchObject({ added: 1, removed: 1 });
    expect((await toolPart(session, "e2")).state).toMatchObject({
      changes: { added: 0, removed: 0, paths: [] },
    });
    turn.finish();
    otherTurn.finish();
    await Promise.all([running, otherRunning]);
  });

  it("keeps a parked call's edits without counting a settled sibling's edits again", async () => {
    const tree = new Map<string, string>();
    const at = Date.now() + 60_000;

    const edit = {
      ...echo,
      name: "edit",
      class: () => ({ kind: "edit", path: "a.ts" }),
      execute: async (args, invocation) => {
        tree.set("a.ts", args.text);
        await invocation.wait({ kind: "timer", until: at });

        return { content: [{ kind: "text", text: args.text }] };
      },
    } satisfies ToolDefinition<{ text: string }>;

    const sibling = {
      ...echo,
      name: "sibling",
      class: () => ({ kind: "edit", path: "b.ts" }),
      execute: async (args) => {
        tree.set("b.ts", args.text);

        return { content: [{ kind: "text", text: args.text }] };
      },
    } satisfies ToolDefinition<{ text: string }>;

    const { kernel, host, script } = await setup({
      plugins: [toolPlugin([edit, sibling])],
      snapshots: treeSnapshots(tree),
    });

    const { session } = await host.sessions.start({ content: "Hi." });
    const running = host.execution.advance({ session: session.id, head: main });
    const turn = await script.started(1);
    const run = turn.input.run.id;
    const input = { session: session.id, run, call: "e1", name: "edit", args: { text: "x" } };

    expect(await call(kernel, input)).toEqual({ kind: "parked" });
    await call(kernel, {
      session: session.id,
      run,
      call: "e2",
      name: "sibling",
      args: { text: "y" },
    });
    await kernel.waits.tick(at);
    expect(await call(kernel, input)).toMatchObject({ kind: "ok" });
    expect((await toolPart(session, "e1")).state).toMatchObject({
      changes: { added: 1, removed: 1, paths: ["a.ts"] },
    });
    expect((await session.view()).turns.at(-1)?.summary).toMatchObject({ added: 2, removed: 2 });
    turn.finish();
    await running;
  });
  it("keeps an edit's changes to its file while another chat edits the shared folder", async () => {
    const { a, b, act, paths, hold, finish } = await sharedFolder();
    const gate = hold("a.ts");
    const editing = act(a, "a1", "edit", "a.ts");
    await gate.entered;
    await act(b, "b1", "edit", "other.ts");
    gate.release();
    await editing;

    expect((await toolPart(a.session, "a1")).state).toMatchObject({
      changes: { paths: ["a.ts"] },
    });
    expect((await a.session.view()).turns.at(-1)?.summary.byClass.edit.paths).toEqual(["a.ts"]);
    expect(await paths(a)).toEqual(["a.ts"]);
    expect(await paths(b)).toEqual(["other.ts"]);
    await finish();
  });

  it.each([
    {
      subagent: false,
      changes: { added: 0, removed: 0, paths: [], unattributed: true },
      owned: [],
    },
    { subagent: true, changes: { added: 1, removed: 1, paths: ["other.ts"] }, owned: ["other.ts"] },
  ])(
    "charges a command nothing while another chat changes the shared folder, but its subagent's edits (subagent: $subagent)",
    async ({ subagent, changes, owned }) => {
      const { a, b, act, paths, hold, finish } = await sharedFolder(subagent);
      const gate = hold("build");
      const building = act(a, "a1", "shell", "build");
      await gate.entered;
      await act(b, "b1", "edit", "other.ts");
      gate.release();
      await building;

      expect((await toolPart(a.session, "a1")).state).toHaveProperty("changes", changes);
      expect(await paths(a)).toEqual(owned);
      await finish();
    },
  );

  it("lists, reviews and patches only the files a chat's own calls changed", async () => {
    const { a, b, workspace, act, paths, finish } = await sharedFolder();
    await act(a, "a1", "edit", "a.ts");
    await act(b, "b1", "edit", "other.ts");
    await act(a, "a2", "edit", "/tmp/project/a2.ts");
    const source = { kind: "session", session: a.session.id } as const;
    const reviewed = await workspace.changes(source);
    const patched = await collect(workspace.patches(source, ["a.ts", "other.ts"]));

    expect(await paths(a)).toEqual(["a.ts", "a2.ts"]);
    expect(reviewed.files.map((file) => file.path)).toEqual(["a.ts", "a2.ts"]);
    expect(patched.flatMap((set) => [...set.entries.keys()])).toEqual(["a.ts"]);
    expect(await paths(b)).toEqual(["other.ts"]);

    await act(a, "a3", "remove", "a.ts");
    await act(a, "a4", "remove", "a2.ts");

    expect(await paths(a)).toEqual([]);

    await act(a, "a5", "edit", "x.ts");
    await act(b, "b2", "edit", "x.ts");

    expect(await paths(a)).toEqual(["x.ts"]);
    expect(await paths(b)).toEqual(["other.ts", "x.ts"]);
    await finish();
  });
});
