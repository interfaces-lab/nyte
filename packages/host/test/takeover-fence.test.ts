import type { Store, StoreConnection } from "@nyte-ai/core";
import { envelope, leaseRef } from "@nyte-ai/core/store";
import { composeServer, main } from "@nyte-ai/core/testing";
import { SdkError } from "@nyte-ai/schema";
import type { RefUpdate, SetOutcome } from "@nyte-ai/schema";
import { afterEach, assert, expect, it, vi } from "vitest";
import { sqliteStore } from "../src/sqlite.ts";
import { chatOnly, fakeModels } from "./fixtures/fake-models.ts";

const steps = [
  "write",
  "write SQL",
  "write reply",
  "beat",
  "beat SQL",
  "beat reply",
  "takeover",
] as const;

type Step = (typeof steps)[number];

const prerequisites: Record<Step, readonly Step[]> = {
  write: [],
  "write SQL": ["write"],
  "write reply": ["write SQL"],
  beat: [],
  "beat SQL": ["beat"],
  "beat reply": ["beat SQL"],
  takeover: [],
};

function schedules(prefix: readonly Step[] = []): (readonly Step[])[] {
  if (prefix.length === steps.length) return [prefix];

  const synchronous =
    prefix.includes("write") && !prefix.includes("write SQL")
      ? "write SQL"
      : prefix.includes("beat") && !prefix.includes("beat SQL")
        ? "beat SQL"
        : null;

  return steps
    .filter((step) => !prefix.includes(step))
    .filter((step) => prerequisites[step].every((before) => prefix.includes(before)))
    .filter((step) => synchronous === null || step === synchronous || step === "takeover")
    .flatMap((step) => schedules([...prefix, step]));
}

function transactionGate() {
  const entered = Promise.withResolvers<void>();
  const sql = Promise.withResolvers<void>();
  const committed = Promise.withResolvers<SetOutcome>();
  const response = Promise.withResolvers<void>();
  const returned = Promise.withResolvers<void>();
  let called = false;

  return {
    entered: entered.promise,
    get called() {
      return called;
    },
    async run(raw: StoreConnection, updates: readonly RefUpdate[]) {
      called = true;
      entered.resolve();
      await sql.promise;
      const outcome = await raw.refs.set(updates);
      committed.resolve(outcome);
      await response.promise;
      returned.resolve();

      return outcome;
    },
    async commit() {
      sql.resolve();

      return committed.promise;
    },
    async reply() {
      if (!called) return;
      response.resolve();
      await returned.promise;
      await Promise.resolve();
    },
    open() {
      sql.resolve();
      response.resolve();
    },
  };
}

function controlledStore(
  raw: StoreConnection,
  select: (updates: readonly RefUpdate[]) => ReturnType<typeof transactionGate> | undefined,
): Store {
  return {
    open: async () => ({
      ...raw,
      refs: {
        ...raw.refs,
        set: (updates) => select(updates)?.run(raw, updates) ?? raw.refs.set(updates),
      },
    }),
    close: async () => undefined,
  };
}

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each(schedules().map((schedule) => ({ order: schedule.join(" -> "), schedule })))(
  "never publishes after takeover: $order",
  async ({ schedule }) => {
    vi.useFakeTimers({
      toFake: ["Date", "performance", "setInterval", "clearInterval", "setTimeout", "clearTimeout"],
    });
    vi.setSystemTime(0);
    const intervals = vi.spyOn(globalThis, "setInterval");
    await using resources = new AsyncDisposableStack();
    const store = resources.adopt(sqliteStore({ memory: true }), (owned) => owned.close());
    const raw = await store.open();
    const write = transactionGate();
    const beat = transactionGate();
    const claim = transactionGate();
    const publication = "kv/takeover-fence";
    let processName = "";
    let lease = "";

    const compose = (label: string, controlled: Store) =>
      composeServer({
        store: controlled,
        models: fakeModels().models,
        plugins: [chatOnly],
        workspace: { kind: "chat-only", locator: null },
        execution: { kind: "admit-only" },
        member: { label, pid: null, capabilities: [] },
        home: null,
        description: { name: label, platform: "darwin", version: "0.1.0" },
      });

    const a = await compose(
      "A",
      controlledStore(raw, (updates) => {
        if (updates.some((update) => update.name === publication)) return write;

        if (updates.some((update) => update.name === processName && update.target !== null))
          return beat;

        return undefined;
      }),
    );

    resources.use(a.host);
    const heartbeatIndex = intervals.mock.calls.findIndex(([, every]) => every === 5_000);
    const tickA = intervals.mock.calls[heartbeatIndex]?.[0];
    const timerA = intervals.mock.results[heartbeatIndex];
    assert(tickA !== undefined && timerA?.type === "return");
    clearInterval(timerA.value);

    const b = await compose(
      "B",
      controlledStore(raw, (updates) =>
        updates.some((update) => update.name === lease && update.target !== null)
          ? claim
          : undefined,
      ),
    );

    resources.use(b.host);
    const presenceA = a.kernel.presence;
    const presenceB = b.kernel.presence;
    assert(presenceA !== null && presenceB !== null);
    const { session } = await a.host.sessions.start({ content: "Base." });
    processName = `processes/${a.kernel.instance}`;
    lease = leaseRef(session.id, main);
    const initial = await raw.objects.put("Initial publication");
    const stale = await raw.objects.put("A publication");
    const fresh = await raw.objects.put("B publication");
    await raw.refs.set([
      { name: publication, target: initial },
      {
        name: lease,
        target: await raw.objects.put(
          envelope(
            "lease",
            {
              holder: a.kernel.hostId,
              instance: a.kernel.instance,
              expiresAt: 60_000,
            },
            0,
          ),
        ),
      },
    ]);
    expect(await presenceB.holder(a.kernel.instance)).toMatchObject({ kind: "alive" });
    await vi.advanceTimersByTimeAsync(20_000);
    expect(await presenceB.holder(a.kernel.instance)).toMatchObject({ kind: "dead" });
    let pendingWrite: Promise<string> | undefined;
    const takeover = b.host.execution.advance({ session: session.id, head: main });
    resources.defer(async () => {
      write.open();
      beat.open();
      claim.open();
      await pendingWrite;
      await takeover;
    });
    await claim.entered;
    let takenOver = false;
    let published = false;

    for (const step of schedule) {
      switch (step) {
        case "write":
          pendingWrite = a.kernel.store.refs.set([{ name: publication, target: stale }]).then(
            (outcome) => outcome.kind,
            (cause: unknown) => {
              assert(cause instanceof SdkError);

              return cause.code;
            },
          );

          if (!presenceA.revoked.aborted) await write.entered;
          break;
        case "write SQL":
          if (write.called) published = (await write.commit()).kind === "set";
          break;
        case "write reply":
          await write.reply();
          expect(await pendingWrite).toBe(published ? "set" : "unavailable");
          break;
        case "beat":
          tickA();

          if (!presenceA.revoked.aborted) await beat.entered;
          break;
        case "beat SQL":
          if (beat.called) await beat.commit();
          break;
        case "beat reply":
          await beat.reply();
          break;
        case "takeover": {
          const outcome = await claim.commit();
          takenOver = outcome.kind === "set";
          const held = await raw.refs.get(lease);
          assert(held !== null && held.target !== null);
          expect(await raw.objects.get(held.target)).toMatchObject({
            body: { instance: takenOver ? b.kernel.instance : a.kernel.instance },
          });

          if (takenOver) {
            expect(
              await b.kernel.store.refs.set([{ name: publication, target: fresh }]),
            ).toMatchObject({ kind: "set" });
          }

          break;
        }
      }

      const ref = await raw.refs.get(publication);
      assert(ref !== null && ref.target !== null);
      expect(await raw.objects.get(ref.target)).toBe(
        takenOver ? "B publication" : published ? "A publication" : "Initial publication",
      );
    }

    await claim.reply();
    expect(await takeover).toMatchObject({ kind: takenOver ? "idle" : "fenced" });
  },
);
