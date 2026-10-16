import { asId, asSeq, standard } from "@nyte-ai/schema";
import type { Json, ToolOutcome } from "@nyte-ai/schema";
import { Type } from "typebox";
import { assert, describe, expect, it } from "vitest";
import { LOCAL, definePart, text, tool } from "../src/index.ts";
import { callRef, memoryStore, partRef } from "../src/store.ts";
import type { Kernel } from "../src/contract/kernel.ts";
import type { Session, StoreConnection, ToolDefinition } from "../src/index.ts";
import { expireLease, main, recording, setup, until } from "../src/harness.ts";
import {
  echoes,
  echo,
  toolPlugin,
  slowTool,
  liveRun,
  call,
  readCall,
  toolPart,
} from "./tool-support.ts";

describe("tool calls", () => {
  it("records the intent before execute and the result after, through calling, running and settled", async () => {
    const recorded = recording(await memoryStore().open());
    const seen: { readonly phase: string; readonly result: Json }[] = [];
    let kernel: Kernel | undefined;
    let session: Session | undefined;

    const watched = {
      ...echo,
      name: "watched",
      execute: async (args: { readonly text: string }) => {
        assert(kernel !== undefined && session !== undefined);
        const part = await toolPart(session, "c1");
        seen.push({
          phase: part.state.phase,
          result: (await readCall(kernel, session.id, "c1")).result,
        });

        return { content: [{ kind: "text", text: args.text }] };
      },
    } satisfies ToolDefinition<{ text: string }>;

    const built = await setup({ store: recorded.store, plugins: [toolPlugin([watched])] });
    kernel = built.kernel;
    session = await built.host.sessions.create();
    const run = await liveRun(kernel, session.id);
    const hold = kernel.folds.acquire(session.id, LOCAL);
    await hold.ready();

    const outcome = await call(kernel, {
      session: session.id,
      run,
      call: "c1",
      name: "watched",
      args: { text: "hi" },
    });

    const ok: ToolOutcome = {
      kind: "ok",
      content: [{ kind: "text", text: "hi" }],
      output: null,
      parts: [],
    };

    expect(outcome).toEqual(ok);
    expect(seen).toEqual([{ phase: "running", result: null }]);
    expect(await readCall(kernel, session.id, "c1")).toMatchObject({
      kind: "tool",
      run,
      head: main,
      intent: { name: "watched", args: { text: "hi" }, principal: LOCAL },
      result: ok,
      replay: "safe",
    });
    expect(recorded.sets.filter((set) => set.length > 0).slice(-2)).toEqual([
      ["part:created", "call:intent"],
      ["call:settled", "part:settled", "commit"],
    ]);

    const created = (await kernel.store.refs.log(session.id, asSeq(0), 100)).find(
      (event) => event.kind === "part" && event.change === "created",
    );

    expect(created).toMatchObject({ state: { phase: "calling", name: "watched" }, run });

    const part = await toolPart(session, "c1");
    const tip = (await session.info()).heads[0]?.tip;

    expect(part.state).toMatchObject({ phase: "settled", outcome: ok, changes: null });
    expect(part.status).toEqual({
      kind: "settled",
      commit: tip?.kind === "commit" ? tip.id : null,
      endedAt: expect.any(Number),
    });
    expect(
      await call(kernel, { session: session.id, run, call: "c1", name: "watched", args: {} }),
    ).toEqual(ok);
    expect(seen).toHaveLength(1);
    hold.release();
  });

  it("fails an unknown tool and invalid arguments, and rejects at before_tool without running", async () => {
    const { kernel, host } = await setup({
      plugins: [
        {
          ...toolPlugin([echo]),
          hooks: {
            before_tool: (proposed) =>
              JSON.stringify(proposed.args) === JSON.stringify({ text: "forbidden" })
                ? { action: "reject", reason: "Not that." }
                : { action: "continue" },
          },
        },
      ],
    });

    const session = await host.sessions.create();
    const run = await liveRun(kernel, session.id);
    const ran = echoes.length;

    expect(
      await call(kernel, { session: session.id, run, call: "u1", name: "nope", args: {} }),
    ).toEqual({ kind: "failed", message: "No tool is named nope." });
    expect(
      await call(kernel, { session: session.id, run, call: "i1", name: "echo", args: { text: 1 } }),
    ).toMatchObject({ kind: "failed", message: expect.stringContaining("Invalid arguments") });
    expect(
      await call(kernel, {
        session: session.id,
        run,
        call: "t1",
        name: "echo",
        args: {},
        argumentsError:
          'The response ended before this tool call finished\n\nReceived arguments:\n{"te',
      }),
    ).toEqual({
      kind: "failed",
      message:
        'Invalid arguments for echo: The response ended before this tool call finished\n\nReceived arguments:\n{"te',
    });
    expect(
      await call(kernel, {
        session: session.id,
        run,
        call: "r1",
        name: "echo",
        args: { text: "forbidden" },
      }),
    ).toEqual({ kind: "rejected", reason: "Not that." });
    expect(echoes.length).toBe(ran);
    expect((await toolPart(session, "r1")).state).toMatchObject({
      phase: "settled",
      outcome: { kind: "rejected", reason: "Not that." },
    });
  });

  it("rewrites the outcome through after_tool before it is recorded", async () => {
    const { kernel, host } = await setup({
      plugins: [
        {
          ...toolPlugin([echo]),
          hooks: {
            after_tool: (outcome) =>
              outcome.kind === "ok"
                ? { ...outcome, content: [{ kind: "text", text: "[redacted]" }] }
                : outcome,
          },
        },
      ],
    });

    const session = await host.sessions.create();
    const run = await liveRun(kernel, session.id);

    const rewritten = {
      kind: "ok",
      content: [{ kind: "text", text: "[redacted]" }],
      output: null,
      parts: [],
    };

    expect(
      await call(kernel, {
        session: session.id,
        run,
        call: "a1",
        name: "echo",
        args: { text: "secret" },
      }),
    ).toEqual(rewritten);
    expect((await readCall(kernel, session.id, "a1")).result).toEqual(rewritten);
    expect((await toolPart(session, "a1")).state).toMatchObject({ outcome: rewritten });
  });

  it("keys nested tools.execute calls and replays them when the step re-runs", async () => {
    let runs = 0;

    const parent = {
      name: "parent",
      description: "Call echo twice, then wait.",
      parameters: standard(Type.Object({ until: Type.Number() })),
      class: () => ({ kind: "custom", label: "Delegating" }),
      replay: "safe",
      execute: async (args, invocation) => {
        runs += 1;
        const first = await invocation.tools.execute("echo", { text: "a" });
        const second = await invocation.tools.execute("echo", { text: "b" }, { key: "second" });
        const woke = await invocation.wait({ kind: "timer", until: args.until });

        return {
          content: [{ kind: "text", text: `${first.kind} ${second.kind} ${woke.kind}` }],
        };
      },
    } satisfies ToolDefinition<{ until: number }>;

    const { kernel, host } = await setup({ plugins: [toolPlugin([echo, parent])] });
    const session = await host.sessions.create();
    const run = await liveRun(kernel, session.id);
    const at = Date.now() + 60_000;
    const ran = echoes.length;
    const input = { session: session.id, run, call: "p1", name: "parent", args: { until: at } };

    expect(await call(kernel, input)).toEqual({ kind: "parked" });
    expect(echoes.slice(ran)).toEqual(["a", "b"]);
    expect((await session.view()).execution).toMatchObject({ kind: "waiting" });
    await kernel.waits.tick(at);
    expect(await call(kernel, input)).toMatchObject({
      kind: "ok",
      content: [{ kind: "text", text: "ok ok timer" }],
    });
    expect(runs).toBe(2);
    expect(echoes.slice(ran)).toEqual(["a", "b"]);
    expect((await readCall(kernel, session.id, "p1:0")).result).toEqual({
      kind: "ok",
      content: [{ kind: "text", text: "a" }],
      output: null,
      parts: [],
    });
    expect((await readCall(kernel, session.id, "p1:second")).result).toEqual({
      kind: "ok",
      content: [{ kind: "text", text: "b" }],
      output: null,
      parts: [],
    });
    expect((await readCall(kernel, session.id, "p1:second")).intent).toMatchObject({
      name: "echo",
      args: { text: "b" },
    });
    expect((await toolPart(session, "p1:0")).status.kind).toBe("settled");
  });

  it("returns the sessions and parts a step acquired when it re-runs", async () => {
    const acquired: string[] = [];

    const spawn = {
      name: "spawn",
      description: "Create a child and a panel, then wait.",
      parameters: standard(Type.Object({ until: Type.Number() })),
      class: () => ({ kind: "delegate", child: null, role: "create", title: null }),
      replay: "safe",
      execute: async (args, invocation) => {
        const child = await invocation.sdk.sessions.create({ parent: invocation.session.id });

        const panel = await invocation.session.parts.create(text, {
          state: { markdown: "Working.", signature: null },
          placement: { kind: "panel" },
        });

        acquired.push(`${child.id} ${panel.id}`);
        await invocation.wait({ kind: "timer", until: args.until });

        return { content: [{ kind: "text", text: child.id }] };
      },
    } satisfies ToolDefinition<{ until: number }>;

    const { kernel, host } = await setup({ plugins: [toolPlugin([spawn])] });
    const session = await host.sessions.create();
    const run = await liveRun(kernel, session.id);
    const at = Date.now() + 60_000;
    const input = { session: session.id, run, call: "k1", name: "spawn", args: { until: at } };

    expect(await call(kernel, input)).toEqual({ kind: "parked" });
    await kernel.waits.tick(at);
    expect(await call(kernel, input)).toMatchObject({ kind: "ok" });

    const [first, second] = acquired;
    const [child, panel] = (first ?? "").split(" ");

    expect(second).toBe(first);
    expect((await readCall(kernel, session.id, "k1")).acquisitions).toEqual({
      "acq:0": child,
      "acq:1": panel,
    });

    const children = await host.sessions.list({
      parents: { kind: "children", session: session.id },
    });

    expect(children.items.map((info) => info.id)).toEqual([child]);
    expect((await session.view()).parts.map((view) => view.id)).toEqual([panel]);
  });

  it("re-runs a safe call once and settles a never call interrupted after a crash", async () => {
    const store = await memoryStore().open();
    const executions = { safe: 0, never: 0 };
    const hang = new Promise<never>(() => undefined);

    const safe = {
      ...echo,
      name: "safe",
      execute: async () => {
        executions.safe += 1;

        return executions.safe === 1 ? hang : { content: [{ kind: "text", text: "again" }] };
      },
    } satisfies ToolDefinition<{ text: string }>;

    const never = {
      ...echo,
      name: "never",
      replay: "never",
      execute: async () => {
        executions.never += 1;

        return hang;
      },
    } satisfies ToolDefinition<{ text: string }>;

    const plugins = [toolPlugin([safe, never])];
    const first = await setup({ store, plugins });
    const session = await first.host.sessions.create();
    await session.send("Go.");
    void first.host.execution.advance({ session: session.id, head: main });
    const run = (await first.script.started(1)).input.run.id;

    for (const name of ["safe", "never"])
      void call(first.kernel, { session: session.id, run, call: name, name, args: { text: "x" } });

    await until(() => (executions.safe === 1 && executions.never === 1 ? true : undefined));

    await expireLease(store, session.id, main);
    const second = await setup({ store, plugins });
    const step = second.host.execution.advance({ session: session.id, head: main });
    const resumed = await second.script.started(1);

    expect(resumed.input.run.id).toBe(run);
    expect(executions).toEqual({ safe: 2, never: 1 });
    expect((await readCall(second.kernel, session.id, "safe")).result).toMatchObject({
      kind: "ok",
      content: [{ kind: "text", text: "again" }],
    });
    expect((await readCall(second.kernel, session.id, "never")).result).toEqual({
      kind: "interrupted",
    });

    const resumedSession = second.host.session(session.id);

    expect((await toolPart(resumedSession, "never")).state).toMatchObject({
      phase: "settled",
      outcome: { kind: "interrupted" },
    });

    resumed.finish();
    await step;
  });

  it("settles stopped when the run's signal aborts or the part's stop action runs", async () => {
    const started: string[] = [];
    const slow = slowTool(started);
    const { kernel, host } = await setup({ plugins: [toolPlugin([slow])] });
    const session = await host.sessions.create();
    const run = await liveRun(kernel, session.id);
    const controller = new AbortController();

    const aborted = call(kernel, {
      session: session.id,
      run,
      call: "s1",
      name: "slow",
      args: { text: "x" },
      signal: controller.signal,
    });

    await until(() => (started.includes("s1") ? true : undefined));
    controller.abort();

    expect(await aborted).toEqual({ kind: "stopped" });

    const stopped = call(kernel, {
      session: session.id,
      run,
      call: "s2",
      name: "slow",
      args: { text: "x" },
    });

    await until(() => (started.includes("s2") ? true : undefined));

    expect(await session.part(asId("s2")).act("stop", {})).toEqual({
      kind: "ok",
      output: undefined,
    });
    expect(await stopped).toEqual({ kind: "stopped" });
    expect((await toolPart(session, "s2")).state).toMatchObject({ outcome: { kind: "stopped" } });
  });

  it("keeps the stop-wired tool built-in whatever else registers its kind", async () => {
    const started: string[] = [];
    const { kernel, host } = await setup({ plugins: [toolPlugin([slowTool(started)])] });
    const wired = kernel.partDefinitions.get(tool.kind);

    expect(wired?.owner).toBeNull();
    expect(wired?.definition).not.toBe(tool);
    expect(wired?.definition).toHaveProperty("onAction");

    for (const definition of [definePart({ ...tool }), tool])
      kernel.partDefinitions.register(definition, "parts")();

    expect(kernel.partDefinitions.get(tool.kind)).toBe(wired);

    const session = await host.sessions.create();
    const run = await liveRun(kernel, session.id);

    const running = call(kernel, {
      session: session.id,
      run,
      call: "t1",
      name: "slow",
      args: { text: "x" },
    });

    await until(() => (started.includes("t1") ? true : undefined));

    expect(await session.part(asId("t1")).act("stop", {})).toEqual({
      kind: "ok",
      output: undefined,
    });
    expect(await running).toEqual({ kind: "stopped" });
    expect((await readCall(kernel, session.id, "t1")).result).toEqual({ kind: "stopped" });
  });

  it("opens a tool part only with its step record, so a crash between them leaves no part a re-run cannot find (bench durable-tool-replay)", async () => {
    const inner = await memoryStore().open();
    let crash: string | null = null;

    const store: StoreConnection = {
      ...inner,
      refs: {
        ...inner.refs,
        set(updates) {
          if (crash !== null && updates.some((update) => update.name === crash)) {
            crash = null;

            return Promise.reject(new Error("The host died."));
          }

          return inner.refs.set(updates);
        },
      },
    };

    const { kernel, host } = await setup({ store, plugins: [toolPlugin([echo])] });
    const session = await host.sessions.create();
    const run = await liveRun(kernel, session.id);
    crash = callRef(session.id, asId("w1"));

    await expect(
      call(kernel, { session: session.id, run, call: "w1", name: "echo", args: { text: "a" } }),
    ).rejects.toThrow("The host died.");
    expect(await kernel.store.refs.get(partRef(session.id, asId("w1")))).toBeNull();
    expect(await kernel.store.refs.get(callRef(session.id, asId("w1")))).toBeNull();
  });
});
