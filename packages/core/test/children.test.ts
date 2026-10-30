import { asId, standard } from "@nyte-ai/schema";
import type { BackgroundItem, HeadName, Json, RunId, SessionId } from "@nyte-ai/schema";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { runStep } from "../src/engine/durable.ts";
import { pollStore } from "../src/fold/watch.ts";
import { main, setup, until } from "../src/harness.ts";
import { definePart } from "../src/index.ts";
import { memoryStore } from "../src/store.ts";
import type { Kernel, StepOutcome } from "../src/contract/kernel.ts";
import type { Host, Session } from "../src/index.ts";
import type { Script } from "../src/harness.ts";

const side: HeadName = asId("side");

const question = definePart({
  kind: "test/question",
  state: standard(Type.Object({})),
  actions: { answer: { input: standard(Type.Object({ choice: Type.String() })) } },
  fallback: (_state, { id }) => `Ask ${id}`,
});

function childState(
  parent: Session,
  child: SessionId,
  state: BackgroundItem["state"],
): Promise<BackgroundItem["state"]> {
  return until(async () => {
    const item = (await parent.view()).background.find((entry) => entry.id === child);

    return item?.state === state ? item.state : undefined;
  });
}

async function askUser(
  kernel: Kernel,
  host: Omit<Host, "listen">,
  turns: Script,
  session: Session,
  count: number,
): Promise<StepOutcome<Json>> {
  void host.execution.advance({ session: session.id, head: main });
  const run: RunId = (await turns.started(count)).input.run.id;
  const part = await session.parts.create(question, { state: {}, placement: { kind: "modal" } });

  return runStep<Json>(kernel, {
    session: session.id,
    head: main,
    run,
    call: asId("ask"),
    kind: "hook",
    replay: "safe",
    intent: { test: true },
    part: null,
    signal: new AbortController().signal,
    body: async (durable) => (await durable.wait({ kind: "part", part: part.id })).kind,
    settle: async (ended) => ({ result: ended.kind, updates: [] }),
    decode: (result) => result,
  });
}

describe("child background items", () => {
  it("follows the child's main head, not a run on another of its heads", async () => {
    const { host, script: turns } = await setup();
    const { session: parent } = await host.sessions.start({ content: "Delegate." });
    const { session: child } = await host.sessions.start({ parent: parent.id, content: "Go." });
    const working = host.execution.advance({ session: child.id, head: main });
    const own = await turns.started(1);

    await childState(parent, child.id, "working");
    await child.heads.create(side);
    await child.head(side).send("Try another way.");
    const elsewhere = host.execution.advance({ session: child.id, head: side });
    (await turns.started(2)).finish();
    await elsewhere;

    expect((await parent.view()).background).toMatchObject([{ id: child.id, state: "working" }]);

    own.finish();
    await working;

    expect(await childState(parent, child.id, "done")).toBe("done");
  });

  it("drops a deleted child from its parent's open view and stops following it", async () => {
    const { kernel, host, script: turns } = await setup();
    const { session: parent } = await host.sessions.start({ content: "Delegate." });
    const { session: child } = await host.sessions.start({ parent: parent.id, content: "Go." });
    const step = host.execution.advance({ session: child.id, head: main });
    (await turns.started(1)).finish();
    await step;

    expect(await childState(parent, child.id, "done")).toBe("done");
    expect(await child.remove()).toEqual({ kind: "removed" });
    expect((await parent.view()).background).toEqual([]);
    expect(kernel.children.background(parent.id)).toEqual([]);
  });

  it("shows a grandchild's question to the root as its child waiting", async () => {
    const { kernel, host, script: turns } = await setup();
    const { session: root } = await host.sessions.start({ content: "Delegate." });
    const { session: child } = await host.sessions.start({ parent: root.id, content: "Split it." });

    const { session: grandchild } = await host.sessions.start({
      parent: child.id,
      content: "Ask.",
    });

    void host.execution.advance({ session: child.id, head: main });
    await turns.started(1);

    expect(await childState(root, child.id, "working")).toBe("working");
    expect(await askUser(kernel, host, turns, grandchild, 2)).toEqual({ kind: "parked" });
    expect(await childState(child, grandchild.id, "waiting")).toBe("waiting");
    expect(await childState(root, child.id, "waiting")).toBe("waiting");
    expect((await root.view()).heads[0]?.background).toEqual({ working: 0, waiting: 1 });
  });

  it("links a child from the store after a restart, so its parked question reaches the parent", async () => {
    const connection = await memoryStore().open();
    const before = await setup({ store: connection });
    const { session: parent } = await before.host.sessions.start({ content: "Delegate." });

    const { session: child } = await before.host.sessions.start({
      parent: parent.id,
      content: "Ask.",
    });

    expect(await askUser(before.kernel, before.host, before.script, child, 1)).toEqual({
      kind: "parked",
    });

    const after = await setup({ store: connection });
    const view = await after.host.session(parent.id).view();

    expect(view.background).toMatchObject([{ kind: "child", id: child.id, state: "waiting" }]);
    expect(view.heads[0]?.background).toEqual({ working: 0, waiting: 1 });
  });

  it("shows a done child's question from another host to its watched parent", async () => {
    const connection = await memoryStore().open();
    const here = await setup({ store: connection, poll: 5 });
    const there = await setup({ store: connection });
    const unpoll = pollStore(here.kernel);
    const { session: started } = await there.host.sessions.start({ content: "Delegate." });
    const { session: child } = await there.host.sessions.start({
      parent: started.id,
      content: "Go.",
    });
    const step = there.host.execution.advance({ session: child.id, head: main });
    (await there.script.started(1)).finish();
    await step;
    const parent = here.host.session(started.id);
    const views = parent.watch()[Symbol.asyncIterator]();

    try {
      await views.next();

      expect(await childState(parent, child.id, "done")).toBe("done");
      await child.send("Ask me.");

      expect(await askUser(there.kernel, there.host, there.script, child, 2)).toEqual({
        kind: "parked",
      });
      expect(await childState(parent, child.id, "waiting")).toBe("waiting");
    } finally {
      unpoll();
      await views.return?.();
    }
  });
});
