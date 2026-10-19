import { asId } from "@nyte-ai/schema";
import type { CallId, SnapshotId } from "@nyte-ai/schema";
import { describe, expect, it } from "vitest";
import { memoryStore } from "../src/store.ts";
import type { ToolDefinition } from "../src/index.ts";
import { recording, setup } from "../src/harness.ts";
import { echo, toolPlugin, liveRun, call, readRun, scripted, toolPart } from "./tool-support.ts";

describe("tool changes", () => {
  it("lands a write's snapshot changes on its part and the session's changes", async () => {
    const recorded = recording(await memoryStore().open());

    const edit = {
      ...echo,
      name: "edit",
      class: () => ({ kind: "edit", path: "a.ts" }),
    } satisfies ToolDefinition<{ text: string }>;

    const taken: string[] = [];

    const { kernel, host } = await setup({
      store: recorded.store,
      plugins: [toolPlugin([edit])],
      snapshots: scripted(taken),
    });

    const { session } = await host.sessions.start({ content: "Hi." });
    const run = await liveRun(kernel, session.id);

    await call(kernel, { session: session.id, run, call: "e1", name: "edit", args: { text: "x" } });

    expect(taken).toEqual(["before", "after"]);
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

    expect(taken).toEqual(["before", "after", "after"]);
    expect((await toolPart(session, "e2")).state).toMatchObject({
      changes: { added: 0, removed: 0, paths: [] },
    });
    expect((await session.view()).changes).toHaveLength(1);
    expect((await readRun(kernel, session.id, run)).record).toMatchObject({
      snapshot: asId("s0"),
      lastSnapshot: asId("s1"),
    });

    const retaken: string[] = [];

    const restarted = await setup({
      store: recorded.store,
      plugins: [toolPlugin([edit])],
      snapshots: scripted(retaken),
    });

    await call(restarted.kernel, {
      session: session.id,
      run,
      call: "e3",
      name: "edit",
      args: { text: "z" },
    });

    expect(retaken).toEqual(["after"]);
    expect((await toolPart(restarted.host.session(session.id), "e3")).state).toMatchObject({
      changes: { added: 0, removed: 0, paths: [] },
    });
  });

  it("counts the session's changes from its first snapshot, across instances sharing the tree", async () => {
    const store = await memoryStore().open();
    const tree = new Map<string, string>();
    const trees = new Map<string, ReadonlyMap<string, string>>();

    const take = async (): Promise<SnapshotId> => {
      const id = asId<"snapshot">(`t${String(trees.size)}`);
      trees.set(id, new Map(tree));

      return id;
    };

    const snapshots: NonNullable<Parameters<typeof setup>[0]>["snapshots"] = {
      before: take,
      after: take,
      diff: async (from, to) => {
        const before = trees.get(from) ?? new Map<string, string>();
        const after = trees.get(to) ?? new Map<string, string>();

        return {
          revision: to,
          files: [...new Set([...before.keys(), ...after.keys()])]
            .filter((path) => before.get(path) !== after.get(path))
            .map((path) => ({
              path,
              status: "modified" as const,
              stat: { kind: "text" as const, added: 1, removed: 1 },
            })),
        };
      },
      patches: async () => [],
    };

    const edit = {
      ...echo,
      name: "edit",
      class: () => ({ kind: "edit", path: "a.ts" }),
    } satisfies ToolDefinition<{ text: string }>;

    const a = await setup({ store, plugins: [toolPlugin([edit])], snapshots });
    const b = await setup({ store, plugins: [toolPlugin([edit])], snapshots });
    const { session } = await a.host.sessions.start({ content: "Hi." });
    const run = await liveRun(a.kernel, session.id);
    const args = { text: "x" };

    await call(a.kernel, { session: session.id, run, call: "e0", name: "edit", args });
    tree.set("a.ts", "edited");
    await call(a.kernel, { session: session.id, run, call: "e1", name: "edit", args });
    tree.set("b.ts", "edited");
    await call(b.kernel, { session: session.id, run, call: "e2", name: "edit", args });

    expect((await session.view()).changes.map((file) => file.path)).toEqual(["a.ts", "b.ts"]);

    tree.delete("a.ts");
    await call(a.kernel, { session: session.id, run, call: "e3", name: "edit", args });

    expect((await session.view()).changes.map((file) => file.path)).toEqual(["b.ts"]);
  });
});
