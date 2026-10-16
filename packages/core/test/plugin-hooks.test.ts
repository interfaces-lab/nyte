import { asId, asSeq } from "@nyte-ai/schema";
import type { Json, PartId, ToolOutcome } from "@nyte-ai/schema";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { executeCall } from "../src/agent/tool-runner.ts";
import { LOCAL } from "../src/index.ts";
import { completed, configuration, main, startRun, until } from "../src/harness.ts";
import { caller, ok, echo, approve, approvals, loaded, readCall } from "./plugin-support.ts";

afterEach(() => {
  vi.useRealTimers();
});

describe("hooks", () => {
  it("orders handlers by order then registration, chains transforms, observes, and short-circuits a decide on reject", async () => {
    const calls: string[] = [];

    const appended = (outcome: ToolOutcome, label: string): ToolOutcome =>
      outcome.kind === "ok"
        ? { ...outcome, content: [...outcome.content, { kind: "text", text: label }] }
        : outcome;

    const { kernel, session, runtime } = await loaded([
      {
        id: "first",
        hooks: {
          after_tool: { order: 10, run: (outcome) => appended(outcome, "first") },
          before_tool: (call) => {
            calls.push("first");

            return { action: "modify", value: { ...call, args: { text: "changed" } } };
          },
          run_ended: (end) => {
            calls.push(`ended:${end.kind}`);
          },
        },
      },
      {
        id: "second",
        hooks: {
          after_tool: { order: -1, run: (outcome) => appended(outcome, "second") },
          before_tool: {
            order: 5,
            run: (call) => {
              calls.push(`second:${JSON.stringify(call.args)}`);

              return { action: "reject", reason: "Not today." };
            },
          },
        },
      },
      {
        id: "third",
        hooks: {
          before_tool: {
            order: 9,
            run: () => {
              calls.push("third");

              return { action: "continue" };
            },
          },
        },
      },
    ]);

    const context = { session: session.id, head: main, run: null, principal: LOCAL };

    expect(await runtime.hooks.transform("after_tool", ok, context)).toEqual({
      ...ok,
      content: [...ok.content, { kind: "text", text: "second" }, { kind: "text", text: "first" }],
    });

    const decided = await runtime.hooks.decide(
      "before_tool",
      {
        call: asId("c1"),
        name: "echo",
        args: { text: "hi" },
        class: { kind: "custom", label: "Echoing" },
      },
      context,
      {
        call: asId("hook:before_tool:c1"),
        run: null,
        head: null,
        part: null,
        signal: new AbortController().signal,
      },
    );

    expect(decided).toEqual({ kind: "done", value: { action: "reject", reason: "Not today." } });
    expect(calls).toEqual(["first", 'second:{"text":"changed"}']);
    expect(await readCall(kernel, session.id, "hook:before_tool:c1")).toMatchObject({
      kind: "hook",
      intent: { name: "echo", args: { text: "hi" }, principal: LOCAL },
      result: { action: "reject", reason: "Not today." },
    });

    await runtime.hooks.observe("run_ended", completed, context);

    expect(calls.at(-1)).toBe("ended:completed");
  });

  it("parks a decide hook on a wait and replays the wait when the step runs again", async () => {
    let runs = 0;
    const due = Date.now() + 60_000;

    const { kernel, session, runtime } = await loaded([
      {
        id: "gate",
        hooks: {
          before_tool: async (_call, context) => {
            runs += 1;
            const outcome = await context.wait({ kind: "timer", until: due });

            return outcome.kind === "timer"
              ? { action: "reject", reason: "Timed out." }
              : { action: "continue" };
          },
        },
      },
    ]);

    const step = {
      call: asId<"call">("hook:before_tool:p1"),
      run: null,
      head: null,
      part: null,
      signal: new AbortController().signal,
    };

    const decide = () =>
      runtime.hooks.decide(
        "before_tool",
        { call: asId("p1"), name: "echo", args: {}, class: { kind: "custom", label: "Echoing" } },
        { session: session.id, head: main, run: null, principal: LOCAL },
        step,
      );

    expect(await decide()).toEqual({ kind: "parked" });

    await kernel.waits.tick(due);

    expect(await decide()).toEqual({
      kind: "done",
      value: { action: "reject", reason: "Timed out." },
    });
    expect(await decide()).toEqual({
      kind: "done",
      value: { action: "reject", reason: "Timed out." },
    });
    expect(runs).toBe(2);
  });

  it("creates a consent modal once across a before_tool hook's park and re-run (§35i)", async () => {
    const created: PartId[] = [];

    const { kernel, session } = await loaded([
      {
        id: "consent",
        contribute: { tools: [echo] },
        hooks: {
          before_tool: async (call, context) => {
            const part = await context.api.session.parts.create(approve, {
              state: { tool: call.name },
              placement: { kind: "modal" },
            });

            created.push(part.id);
            const outcome = await context.wait({ kind: "part", part: part.id });

            return outcome.kind === "part" && outcome.answer?.action === "allow"
              ? { action: "continue" }
              : { action: "reject", reason: "The user declined." };
          },
        },
      },
    ]);

    const run = (
      await startRun(
        kernel,
        session.id,
        main,
        { kind: "continuation", from: "wake" },
        configuration,
      )
    ).id;

    const call = () =>
      executeCall(kernel, {
        session: session.id,
        runtime: kernel.plugins.runtime(session.id),
        head: main,
        run,
        call: asId("g1"),
        name: "echo",
        args: { text: "hi" },
        context: caller,
        signal: new AbortController().signal,
      });

    expect(await call()).toEqual({ kind: "parked" });
    const [part] = created;
    assert(part !== undefined);

    expect(await session.part(part).act("allow", {})).toEqual({ kind: "ok", output: undefined });
    expect(await call()).toEqual(ok);
    expect(created).toEqual([part, part]);
    expect(await approvals(kernel, session.id)).toEqual([part]);
    expect(
      (await session.view()).parts
        .filter((view) => view.partKind === approve.kind)
        .map((view) => view.id),
    ).toEqual([part]);
    expect(await readCall(kernel, session.id, "hook:before_tool:g1")).toMatchObject({
      acquisitions: { "acq:0": part },
      result: { action: "continue" },
    });
  });

  it("creates a consent modal once across a before_send hook's park and re-run, then admits the send (§35i)", async () => {
    const created: PartId[] = [];

    const { kernel, session } = await loaded([
      {
        id: "consent",
        hooks: {
          before_send: async (_submission, context) => {
            const part = await context.api.session.parts.create(approve, {
              state: { tool: "send" },
              placement: { kind: "modal" },
            });

            created.push(part.id);
            const outcome = await context.wait({ kind: "part", part: part.id });

            return outcome.kind === "part" && outcome.answer?.action === "allow"
              ? { action: "continue" }
              : { action: "reject", reason: "The user declined." };
          },
        },
      },
    ]);

    const sending = session.send("hello");
    const part = await until(() => created[0]);

    expect(await session.part(part).act("allow", {})).toEqual({ kind: "ok", output: undefined });

    const receipt = await sending;

    const admitted = (await kernel.store.refs.log(session.id, asSeq(0), 100)).find(
      (event) =>
        event.kind === "input" && event.change === "admitted" && event.message === asId(receipt.id),
    );

    expect(admitted).toMatchObject({ content: "hello" });
    expect(created).toEqual([part, part]);
    expect(await approvals(kernel, session.id)).toEqual([part]);
    expect(
      (await session.view()).parts
        .filter((view) => view.partKind === approve.kind)
        .map((view) => view.id),
    ).toEqual([part]);
    expect(await readCall(kernel, session.id, `hook:before_send:${receipt.id}`)).toMatchObject({
      run: null,
      head: null,
      acquisitions: { "acq:0": part },
      result: { action: "continue" },
    });
  });

  it("aborts a handler past its budget: an observe is reported, a transform fails the operation", async () => {
    let budget: AbortSignal | undefined;

    const { kernel, session, runtime } = await loaded([
      {
        id: "slow",
        hooks: {
          run_ended: (_end, { signal }) => {
            budget = signal;

            return new Promise<void>(() => undefined);
          },
          after_tool: () => new Promise<ToolOutcome>(() => undefined),
        },
      },
    ]);

    const context = { session: session.id, head: main, run: null, principal: LOCAL };
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    const observed = runtime.hooks.observe("run_ended", completed, context);
    const transformed = runtime.hooks.transform("after_tool", ok, context);

    const failed = expect(transformed).rejects.toMatchObject({
      code: "internal",
      message: "Plugin slow's after_tool handler failed: exceeded its 5 s budget",
    });

    await vi.advanceTimersByTimeAsync(5_000);
    await observed;
    await failed;

    expect(budget?.aborted).toBe(true);
    expect(kernel.host.current().plugins.find((row) => row.id === "slow")?.issues).toEqual([
      {
        severity: "error",
        path: ["hooks", "run_ended"],
        message: "Plugin slow's run_ended handler failed: exceeded its 5 s budget",
        source: { plugin: "slow" },
      },
    ]);
  });

  it("rejects a tool call through a plugin's before_tool hook in executeCall, and runs the arguments another rewrites", async () => {
    const { kernel, session } = await loaded([
      {
        id: "gate",
        contribute: { tools: [echo] },
        hooks: {
          before_tool: (call) => {
            if (JSON.stringify(call.args) === JSON.stringify({ text: "forbidden" }))
              return { action: "reject", reason: "Not that." };

            return call.args === null
              ? { action: "modify", value: { ...call, args: { text: "filled" } } }
              : { action: "continue" };
          },
        },
      },
    ]);

    const run = (
      await startRun(
        kernel,
        session.id,
        main,
        { kind: "continuation", from: "wake" },
        configuration,
      )
    ).id;

    const call = (id: string, args: Json) =>
      executeCall(kernel, {
        session: session.id,
        runtime: kernel.plugins.runtime(session.id),
        head: main,
        run,
        call: asId(id),
        name: "echo",
        args,
        context: caller,
        signal: new AbortController().signal,
      });

    expect(await call("r1", { text: "forbidden" })).toEqual({
      kind: "rejected",
      reason: "Not that.",
    });
    expect(await readCall(kernel, session.id, "hook:before_tool:r1")).toMatchObject({
      kind: "hook",
      run,
      head: main,
      result: { action: "reject", reason: "Not that." },
    });
    expect(await call("r2", null)).toEqual({
      kind: "ok",
      content: [{ kind: "text", text: "filled" }],
      output: null,
      parts: [],
    });
  });

  it("rejects or rewrites a send through a plugin's before_send hook", async () => {
    const { kernel, session } = await loaded([
      {
        id: "guard",
        hooks: {
          before_send: (submission) => {
            const { content } = submission;

            if (typeof content !== "string") return { action: "continue" };

            return content.includes("secret")
              ? { action: "reject", reason: "No secrets." }
              : { action: "modify", value: { ...submission, content: `${content}!` } };
          },
        },
      },
    ]);

    await expect(session.send("my secret")).rejects.toMatchObject({
      code: "invalid",
      message: "No secrets.",
    });

    const receipt = await session.send("hello");

    const admitted = (await kernel.store.refs.log(session.id, asSeq(0), 100)).find(
      (event) =>
        event.kind === "input" && event.change === "admitted" && event.message === asId(receipt.id),
    );

    expect(admitted).toMatchObject({ content: "hello!" });
    expect(await readCall(kernel, session.id, `hook:before_send:${receipt.id}`)).toMatchObject({
      kind: "hook",
      run: null,
      head: null,
      result: { action: "modify", value: { content: "hello!" } },
    });
  });
});
