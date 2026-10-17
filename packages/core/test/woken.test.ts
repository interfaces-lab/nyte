import { asId } from "@nyte-ai/schema";
import type { Json, SessionId } from "@nyte-ai/schema";
import { describe, expect, it, vi } from "vitest";
import type { Kernel } from "../src/contract/kernel.ts";
import type { Durable } from "../src/contract/tools.ts";
import { runStep } from "../src/engine/durable.ts";
import { readIndexed, WAITS, WOKEN, wokenIndex } from "../src/store/wait-index.ts";
import { main, setup } from "../src/harness.ts";

function waitStep(
  kernel: Kernel,
  session: SessionId,
  call: string,
  body: (durable: Durable) => Promise<Json>,
) {
  return runStep<Json>(kernel, {
    session,
    head: main,
    run: null,
    call: asId(call),
    kind: "hook",
    replay: "safe",
    intent: { test: true },
    part: null,
    signal: new AbortController().signal,
    body,
    settle: async (ended) => ({
      result: ended.kind === "done" ? ended.value : ended.kind,
      updates: [],
    }),
    decode: (result) => result,
  });
}

async function wokenNames(kernel: Kernel): Promise<readonly string[]> {
  return (await kernel.store.refs.list(WOKEN)).map((ref) => ref.name);
}

describe("woken calls", () => {
  it("steps on refresh only the calls another process woke, reading none of the parked ones", async () => {
    const holder = await setup();
    const other = await setup({ store: holder.kernel.store });
    const { session } = await holder.host.sessions.start({ content: "Hi." });
    const soon = Date.now() + 1;

    await waitStep(holder.kernel, session.id, "c0", async (durable) =>
      durable.wait({ kind: "timer", until: soon }),
    );

    for (let index = 1; index < 50; index += 1)
      await waitStep(holder.kernel, session.id, `c${index}`, async (durable) =>
        durable.wait({ kind: "timer", until: Date.now() + 60_000 }),
      );

    await other.kernel.waits.tick(soon + 1);
    expect(await wokenNames(holder.kernel)).toEqual([wokenIndex(session.id, asId("c0"))]);

    const notified: string[] = [];
    holder.kernel.wakes.subscribe((woken, head) => notified.push(`${woken}/${head}`));
    const reads = vi.spyOn(holder.kernel.store.objects, "get");

    await holder.kernel.waits.refresh();

    expect(notified).toEqual([`${session.id}/${main}`]);
    expect(reads).toHaveBeenCalledTimes(1);
    reads.mockRestore();

    expect(
      await waitStep(holder.kernel, session.id, "c0", async (durable) => {
        const woke = await durable.wait({ kind: "timer", until: soon });

        return woke.kind;
      }),
    ).toEqual({ kind: "done", value: "timer" });
    expect(await wokenNames(holder.kernel)).toEqual([]);

    notified.length = 0;
    await holder.kernel.waits.refresh();
    expect(notified).toEqual([]);
  });

  it("drops a woken call's index when it parks on its next wait", async () => {
    const { kernel, host } = await setup();
    const { session } = await host.sessions.start({ content: "Hi." });
    const soon = Date.now() + 1;

    const twice = async (durable: Durable): Promise<Json> => {
      await durable.wait({ kind: "timer", until: soon });

      return (await durable.wait({ kind: "timer", until: Date.now() + 60_000 })).kind;
    };

    expect(await waitStep(kernel, session.id, "c1", twice)).toEqual({ kind: "parked" });
    await kernel.waits.tick(soon + 1);
    expect(await wokenNames(kernel)).toEqual([wokenIndex(session.id, asId("c1"))]);

    expect(await waitStep(kernel, session.id, "c1", twice)).toEqual({ kind: "parked" });
    expect(await wokenNames(kernel)).toEqual([]);
  });

  it("drops a session's wait index, woken calls' included, with the session", async () => {
    const { kernel, host } = await setup();
    const { session } = await host.sessions.start({ content: "Hi." });
    const { session: kept } = await host.sessions.start({ content: "Hi." });
    const soon = Date.now() + 1;

    await waitStep(kernel, session.id, "c1", async (durable) =>
      durable.wait({ kind: "timer", until: soon }),
    );
    await kernel.waits.tick(soon + 1);
    expect(await wokenNames(kernel)).toEqual([wokenIndex(session.id, asId("c1"))]);

    for (const parked of [session.id, kept.id])
      await waitStep(kernel, parked, "c2", async (durable) =>
        durable.wait({ kind: "timer", until: Date.now() + 60_000 }),
      );

    expect(await host.session(session.id).remove()).toEqual({ kind: "removed" });
    expect(
      (await kernel.store.refs.list(WAITS)).map((ref) => readIndexed(ref.name)?.session),
    ).toEqual([kept.id]);
  });
});
