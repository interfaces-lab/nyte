import { asId } from "@nyte-ai/schema";
import { LOCAL, headRef, memoryStore, pollStore } from "@nyte-ai/core";
import { describe, expect, it } from "vitest";
import { main, setup } from "../../core/test/harness.ts";
import { createHandler, createTransport } from "../src/index.ts";

describe("head revisions across instances", () => {
  it("shows the store's head revision on the view and the wire after another instance's run is stopped, and an edit expecting it lands (ADV A P2)", async () => {
    const store = await memoryStore().open();
    const a = await setup({ store, poll: 10, execution: { kind: "admit-only" } });
    const b = await setup({ store, poll: 10, execution: { kind: "admit-only" } });
    const session = await a.host.sessions.create();
    const hold = a.kernel.folds.acquire(session.id, LOCAL);
    await hold.ready();
    const sent = await session.send("From A.");
    const first = a.host.execution.advance({ session: session.id, head: main });
    (await a.script.started(1)).finish();
    await first;
    await b.host.session(session.id).send("From B.");
    const second = b.host.execution.advance({ session: session.id, head: main });
    const driven = await b.script.started(1);
    await session.run(driven.input.run.id).stop();
    const stopA = pollStore(a.kernel);
    const stopB = pollStore(b.kernel);
    await new Promise((resolve) => setTimeout(resolve, 100));
    await second;

    const view = await session.view();
    const stored = await store.refs.get(headRef(session.id, main));
    const authority = new Set(["participant", "owner", "maintenance"] as const);

    const handler = createHandler({
      kernel: a.kernel,
      connection: async () => ({ connection: a.host, authority }),
    });

    const transport = createTransport({
      url: "http://probe.test",
      headers: async () => ({}),
      fetch: async (input, init) => handler(new Request(input, init)),
    });

    const frames = transport
      .frames("head.watch", { session: session.id, head: main })
      [Symbol.asyncIterator]();

    const frame = await frames.next();
    const edited = await session.send("From A, edited.", {
      replace: sent.message,
      expect: view.revision ?? undefined,
    });

    expect(view.revision).toBe(stored?.revision);
    expect(frame.done !== true && frame.value).toMatchObject({
      kind: "view",
      view: {
        revision: stored?.revision,
        heads: [{ name: main, tip: { kind: "commit", id: stored?.target } }],
      },
    });
    expect(edited.message).not.toBe(asId(""));
    await frames.return?.();
    stopA();
    stopB();
    hold.release();
  });
});
