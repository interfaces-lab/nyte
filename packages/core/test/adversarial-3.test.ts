import { asId, asSeq, standard } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import { Type } from "typebox";
import { describe, expect, it } from "vitest";
import { executeCall } from "../src/agent/tool-runner.ts";
import { landing } from "../src/engine/admission.ts";
import { stopRun } from "../src/engine/fence.ts";
import { move } from "../src/engine/move.ts";
import { ALL_AUTHORITY, LOCAL } from "../src/index.ts";
import { callRef, headRef, memoryStore, partRef } from "../src/store.ts";
import type { Kernel } from "../src/contract/kernel.ts";
import type {
  ConnectionContext,
  Plugin,
  Session,
  Store,
  StoreConnection,
  ToolDefinition,
} from "../src/index.ts";
import { readInbox } from "../src/store/session.ts";
import { fakeModels, open, testModel } from "./fake-models.ts";
import { configuration, main, setup, startRun, until, usage } from "../src/harness.ts";
import { toolPlugin } from "./tool-support.ts";

const caller: ConnectionContext = {
  principal: LOCAL,
  authority: ALL_AUTHORITY,
  credential: { kind: "token", token: "x" },
  origin: null,
};

function writer(ran: string[]): ToolDefinition<{ readonly text: string }> {
  return {
    name: "write_file",
    description: "Writes.",
    parameters: standard(Type.Object({ text: Type.String() })),
    class: () => ({ kind: "custom", label: "Writing" }),
    replay: "never",
    execute: async (args) => {
      ran.push(args.text);

      return { content: [{ kind: "text", text: "wrote" }] };
    },
  };
}

describe("ADV A-3", () => {
  it("answers a tool step stopped, recording nothing and running nothing, once another instance fenced its run, and aborts the run here (A-3 S1, probe a3e)", async () => {
    const ran: string[] = [];
    const store = await memoryStore().open();

    const a = await setup({
      store,
      plugins: [toolPlugin([writer(ran)])],
      execution: { kind: "admit-only" },
    });

    const b = await setup({ store, execution: { kind: "admit-only" } });
    const { session } = await a.host.sessions.start({ content: "Hi." });

    const run = await startRun(
      a.kernel,
      session.id,
      main,
      { kind: "continuation", from: "wake" },
      configuration,
    );

    expect((await stopRun(b.kernel, session.id, run.id)).kind).toBe("requested");

    const outcome = await executeCall(a.kernel, {
      session: session.id,
      runtime: a.kernel.plugins.runtime(session.id),
      head: main,
      run: run.id,
      call: asId("c1"),
      name: "write_file",
      args: { text: "side effect" } satisfies Json,
      context: caller,
      signal: new AbortController().signal,
    });

    expect({ ran, outcome }).toEqual({ ran: [], outcome: { kind: "stopped" } });
    expect(await store.refs.get(callRef(session.id, asId("c1")))).toBeNull();
    expect(await store.refs.get(partRef(session.id, asId("c1")))).toBeNull();
    expect(a.kernel.runs.signal(run.id)?.aborted).toBe(true);
  });

  it("ends a fenced run whose response calls a write tool stopped, the tool unrun and unrecorded, one request sent (A-3 S1, probe a3f)", async () => {
    const ran: string[] = [];
    const plugin: Plugin<"core"> = { id: "writer", contribute: { tools: [writer(ran)] } };
    const connection = await memoryStore().open();

    const shared: Store = {
      open: async () => connection,
      close: async () => undefined,
    };

    const fake = fakeModels({ models: [testModel("model")] });
    const gate = Promise.withResolvers<void>();

    fake.reply(
      {
        content: [
          { type: "text", text: "Working." },
          {
            type: "toolCall",
            id: "c1",
            name: "write_file",
            arguments: { text: "side effect" },
          },
        ],
        stopReason: "toolUse",
        until: gate.promise,
      },
      { content: [{ type: "text", text: "Done." }] },
    );

    await using host = await open(fake, { store: shared, plugins: [plugin] });
    const b = await setup({ store: connection, execution: { kind: "admit-only" } });
    const { session, receipt } = await host.sessions.start({ content: "Go." });

    const run = await until(async () => {
      const view = await session.view();

      return view.execution.kind === "live" ? view.execution.run.id : undefined;
    });

    await until(async () =>
      (await session.view()).messages.some((message) => message.kind === "part") ? true : undefined,
    );
    expect((await stopRun(b.kernel, session.id, run)).kind).toBe("requested");
    gate.resolve();
    const settled = await receipt.settled();
    const view = await session.view();

    const parts = view.messages.flatMap((message) =>
      message.kind === "part" ? [`${message.partKind}:${message.status.kind}`] : [],
    );

    expect({ ran, settled, requests: fake.requests.length, parts }).toEqual({
      ran: [],
      settled: { kind: "stopped" },
      requests: 1,
      parts: ["text:failed"],
    });

    const text = view.messages.find((message) => message.kind === "part");
    expect(text?.kind === "part" ? text.state : null).toMatchObject({ markdown: "Working." });
  });

  it("keeps the text a part streamed before a local stop: the part fails with its markdown as streamed (A-3 note, §66)", async () => {
    const fake = fakeModels({ models: [testModel("model")] });
    fake.reply({ content: [{ type: "text", text: "A partial answer" }], hold: true });
    await using host = await open(fake);
    const { session, receipt } = await host.sessions.start({ content: "Go." });
    const views = session.watch()[Symbol.asyncIterator]();

    for (;;) {
      const next = await views.next();

      if (next.done === true) throw new Error("The watch ended.");

      if (
        next.value.messages.some(
          (message) => message.kind === "part" && JSON.stringify(message.state).includes("partia"),
        )
      )
        break;
    }

    await views.return?.();
    const landed = await receipt.landed();

    if (landed.kind !== "landed" || landed.run === null) throw new Error("No run landed.");

    expect((await session.run(landed.run).stop()).kind).toBe("requested");
    expect(await receipt.settled()).toEqual({ kind: "stopped" });

    const parts = (await session.view()).messages.flatMap((message) =>
      message.kind === "part" ? [{ status: message.status.kind, state: message.state }] : [],
    );

    expect(parts).toEqual([{ status: "failed", state: { markdown: "A partia", signature: null } }]);
  });

  for (const reloadAt of ["none", "claim"] as const)
    it(`re-runs a woken call on a runtime it holds once ready, though the session reloads at the lease claim (D-3 N1, probe P5 ${reloadAt})`, async () => {
      const fake = fakeModels();
      const at = Date.now() + 60_000;
      const gate = Promise.withResolvers<void>();
      let activations = 0;
      let armed = false;
      let reload = (): void => undefined;

      const napper: ToolDefinition<object> = {
        name: "napper",
        description: "Naps.",
        parameters: standard(Type.Object({})),
        class: () => ({ kind: "custom", label: "nap" }),
        replay: "safe",
        execute: async (_args, invocation) => {
          const woke = await invocation.wait({ kind: "timer", until: at });

          return { content: [{ kind: "text", text: `napper ran ${woke.kind}` }] };
        },
      };

      const slow: Plugin<"core"> = {
        id: "slow",
        async activate() {
          activations += 1;

          if (activations === 2) await gate.promise;
        },
      };

      const provider: Plugin<"core"> = { id: "provider", contribute: { tools: [napper] } };
      const base = memoryStore();

      const store: Store = {
        ...base,
        async open() {
          const opened = await base.open();

          return {
            ...opened,
            refs: {
              ...opened.refs,
              async set(updates) {
                if (armed && updates.some((update) => update.name.includes("/leases/"))) {
                  armed = false;
                  reload();
                }

                return opened.refs.set(updates);
              },
            },
          };
        },
      };

      fake.reply(
        { content: [{ type: "toolCall", id: "c1", name: "napper", arguments: {} }] },
        { content: [{ type: "text", text: "Done." }] },
      );

      await using host = await open(fake, { plugins: [slow, provider], store });
      const { session, receipt } = await host.sessions.start({ content: "Go." });

      reload = () => {
        void host.kernel.plugins.reload(session.id);
        setTimeout(() => gate.resolve(), 200);
      };

      await until(async () =>
        (await session.view()).heads[0]?.execution.kind === "waiting" ? true : undefined,
      );

      await new Promise((resolve) => setTimeout(resolve, 50));
      armed = reloadAt === "claim";
      await host.kernel.waits.tick(at);

      if (reloadAt === "none") gate.resolve();

      expect(await receipt.settled()).toMatchObject({ kind: "completed" });

      const result = fake.requests[1]?.context.messages.find(
        (message) => message.role === "toolResult",
      );

      expect(result?.role === "toolResult" ? result.content : null).toEqual([
        { type: "text", text: "napper ran timer" },
      ]);
    });
});

async function crashingAfterMove() {
  const memory = await memoryStore().open();
  let crashed = false;

  const store: StoreConnection = {
    ...memory,
    refs: {
      ...memory.refs,
      async set(updates) {
        if (crashed) throw new Error("The host crashed.");
        const outcome = await memory.refs.set(updates);

        crashed = updates
          .flatMap((update) => update.events ?? [])
          .some((event) => event.kind === "head" && event.reason === "moved");

        return outcome;
      },
    },
  };

  return { memory, store };
}

async function land(kernel: Kernel, session: Session, text: string): Promise<void> {
  const sent = await session.send(text);
  await landing(kernel, session.id, main, [sent.message], null);
}

describe("ADV F-3", () => {
  it("settles a reacquired move receipt after a restart and repair, its set landed before the crash (F-3 R1, F-2 N1)", async () => {
    const { memory, store } = await crashingAfterMove();
    const a = await setup({ store, execution: { kind: "admit-only" } });
    const { session, receipt: first } = await a.host.sessions.start({ content: "Base." });
    await landing(a.kernel, session.id, main, [first.message], null);
    const id = asId<"receipt">("crash");

    await expect(move(a.kernel, session.id, main, { kind: "start" }, { id })).rejects.toThrow(
      "The host crashed.",
    );

    const b = await setup({ store: memory, execution: { kind: "admit-only" } });
    const receipt = b.host.session(session.id).receipt(id);

    expect(await receipt.status()).toEqual({ kind: "pending" });

    const settled = receipt.settled({ signal: AbortSignal.timeout(1000) });
    await b.host.execution.repair({ limit: 10 });

    const moved = {
      kind: "moved",
      revision: "",
      position: { kind: "start" },
      summary: null,
      handback: null,
    };

    expect(await receipt.status()).toEqual({ kind: "settled", outcome: moved });
    expect(await settled).toEqual(moved);
  });

  it("answers moved when a crashed move is replayed after a later write, keeping that write (F-3 R4, F-2 N1)", async () => {
    const { memory, store } = await crashingAfterMove();
    const a = await setup({ store, execution: { kind: "admit-only" } });
    const { session, receipt: first } = await a.host.sessions.start({ content: "Base." });
    await landing(a.kernel, session.id, main, [first.message], null);
    const id = asId<"receipt">("crash");

    await expect(move(a.kernel, session.id, main, { kind: "start" }, { id })).rejects.toThrow(
      "The host crashed.",
    );

    const b = await setup({ store: memory, execution: { kind: "admit-only" } });
    await land(b.kernel, b.host.session(session.id), "Later.");
    const later = await memory.refs.get(headRef(session.id, main));
    const replay = await move(b.kernel, session.id, main, { kind: "start" }, { id });
    const log = await memory.refs.log(session.id, asSeq(0), 1000);

    expect(await replay.settled()).toEqual({
      kind: "moved",
      revision: later?.revision,
      position: { kind: "start" },
      summary: null,
      handback: null,
    });
    expect(log.filter((event) => event.kind === "head" && event.reason === "moved")).toHaveLength(
      1,
    );
    expect(await memory.refs.get(headRef(session.id, main))).toEqual(later);
  });

  it("refuses a summary edit once user input is queued while it summarises, moving nothing (F-3 R2, F-2 N2/N4)", async () => {
    const entered = Promise.withResolvers<void>();
    const release = Promise.withResolvers<void>();

    const { kernel, host } = await setup({
      execution: { kind: "admit-only" },
      summarize: async () => {
        entered.resolve();
        await release.promise;

        return { kind: "ok", markdown: "Summary.", usage };
      },
    });

    const { session, receipt: original } = await host.sessions.start({
      content: "Original.",
    });
    await landing(kernel, session.id, main, [original.message], null);
    const old = await kernel.store.refs.get(headRef(session.id, main));

    const edit = await session.send("Edited.", {
      replace: original.message,
      expect: old?.revision,
      abandoned: { summarize: {} },
    });

    await entered.promise;
    const queued = await session.send("Queued.", { delivery: "queue" });
    release.resolve();

    expect(await edit.settled()).toEqual({ kind: "pending-input", messages: [queued.message] });

    const inbox = await readInbox(kernel.store, session.id, main);

    expect(inbox.messages).toEqual([queued.message]);
    expect(await kernel.store.refs.get(headRef(session.id, main))).toEqual(old);
  });

  it("answers a view's revision null, never the absent head's, when no revision is paired with its tip (F-3 R3, §54a)", async () => {
    const raw = await memoryStore().open();
    let between: (() => Promise<void>) | null = null;

    const store: StoreConnection = {
      ...raw,
      refs: {
        ...raw.refs,
        async log(session, after, limit) {
          const events = await raw.refs.log(session, after, limit);
          const run = between;

          if (run !== null && events.some((event) => event.kind === "commit")) {
            between = null;
            await run();
          }

          return events;
        },
      },
    };

    const a = await setup({ store, execution: { kind: "admit-only" } });
    const b = await setup({ store: raw, execution: { kind: "admit-only" } });
    const { session, receipt: first } = await a.host.sessions.start({ content: "A." });
    await landing(a.kernel, session.id, main, [first.message], null);
    const hold = a.kernel.folds.acquire(session.id, LOCAL);
    await hold.ready();
    await land(b.kernel, b.host.session(session.id), "B.");
    between = () => land(b.kernel, b.host.session(session.id), "C.");

    const view = await session.view();
    hold.release();

    expect(await raw.refs.get(headRef(session.id, main))).not.toBeNull();
    expect(view.revision).toBeNull();
  });
});
