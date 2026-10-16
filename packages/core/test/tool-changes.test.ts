import { asId } from "@nyte-ai/schema";
import type { CallId } from "@nyte-ai/schema";
import { describe, expect, it } from "vitest";
import { executeCall } from "../src/agent/tool-runner.ts";
import { memoryStore } from "../src/store.ts";
import type { ToolDefinition } from "../src/index.ts";
import { configuration, recording, setup, startRun } from "../src/harness.ts";
import {
  caller,
  echo,
  toolPlugin,
  liveRun,
  call,
  readRun,
  scripted,
  toolPart,
} from "./tool-support.ts";

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

  it("B-2 N4: another instance's changed file stays in the session's changes", async () => {
    const store = await memoryStore().open();

    const touching = (path: string): NonNullable<Parameters<typeof setup>[0]>["snapshots"] => ({
      before: async () => asId("s0"),
      after: async () => asId(`after-${path}`),
      diff: async (_from, to) => ({
        revision: to,
        files: [{ path, status: "modified", stat: { kind: "text", added: 1, removed: 0 } }],
      }),
      patches: async () => [],
    });

    const edit = {
      ...echo,
      name: "edit",
      class: () => ({ kind: "edit", path: "a.ts" }),
    } satisfies ToolDefinition<{ text: string }>;

    const a = await setup({ store, plugins: [toolPlugin([edit])], snapshots: touching("a.ts") });
    const b = await setup({ store, plugins: [toolPlugin([edit])], snapshots: touching("b.ts") });
    const { session } = await a.host.sessions.start({ content: "Hi." });
    const run = await liveRun(a.kernel, session.id);
    const args = { text: "x" };

    await call(a.kernel, { session: session.id, run, call: "e1", name: "edit", args });
    await call(b.kernel, { session: session.id, run, call: "e2", name: "edit", args });
    await call(a.kernel, { session: session.id, run, call: "e3", name: "edit", args });

    expect((await session.view()).changes.map((file) => file.path)).toEqual(["a.ts", "b.ts"]);
  });

  it("keeps both files when two runs' settlements merge the session's changes at once: the merge expects its record and retries", async () => {
    const store = await memoryStore().open();
    const both = Promise.withResolvers<void>();
    let diffing = 0;

    const touching = (path: string): NonNullable<Parameters<typeof setup>[0]>["snapshots"] => ({
      before: async () => asId("s0"),
      after: async () => asId(`after-${path}`),
      diff: async (_from, to) => {
        diffing += 1;

        if (diffing === 2) both.resolve();
        await both.promise;

        return {
          revision: to,
          files: [{ path, status: "modified", stat: { kind: "text", added: 1, removed: 0 } }],
        };
      },
      patches: async () => [],
    });

    const edit = {
      ...echo,
      name: "edit",
      class: () => ({ kind: "edit", path: "a.ts" }),
    } satisfies ToolDefinition<{ text: string }>;

    const a = await setup({ store, plugins: [toolPlugin([edit])], snapshots: touching("a.ts") });
    const b = await setup({ store, plugins: [toolPlugin([edit])], snapshots: touching("b.ts") });
    const { session } = await a.host.sessions.start({ content: "Hi." });
    const side = asId<"head">("side");
    await session.heads.create(side);
    const first = await liveRun(a.kernel, session.id);

    const second = await startRun(
      b.kernel,
      session.id,
      side,
      { kind: "continuation", from: "wake" },
      configuration,
    );

    await b.kernel.plugins.runtime(session.id).ready;

    await Promise.all([
      call(a.kernel, {
        session: session.id,
        run: first,
        call: "e1",
        name: "edit",
        args: { text: "x" },
      }),
      executeCall(b.kernel, {
        session: session.id,
        runtime: b.kernel.plugins.runtime(session.id),
        head: side,
        run: second.id,
        call: asId("e2"),
        name: "edit",
        args: { text: "y" },
        context: caller,
        signal: new AbortController().signal,
      }),
    ]);

    expect((await session.view()).changes.map((file) => file.path).toSorted()).toEqual([
      "a.ts",
      "b.ts",
    ]);
  });
});
