import type { Machine, OsProcess, Store, StoreConnection } from "@nyte-ai/core";
import { envelope, leaseRef } from "@nyte-ai/core/store";
import { composeServer, main } from "@nyte-ai/core/testing";
import { SdkError } from "@nyte-ai/schema";
import type { RefUpdate, SetOutcome } from "@nyte-ai/schema";
import { afterEach, assert, expect, it, vi } from "vitest";
import { sqliteStore } from "../src/store/sqlite.ts";
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

const processA: OsProcess = { boot: "boot", pid: 101, group: 101, started: "test:1" };

/** A machine that says A's process is `answer`, and that this one is `self`. */
function machine(self: OsProcess | null, answer: "running" | "gone" | "unknown"): Machine {
  return {
    self: async () => self,
    state: async (process) => (process.pid === processA.pid ? answer : "running"),
    end: async () => "unknown",
  };
}

const verdicts = {
  lapsed: { a: undefined, b: undefined },
  exited: { a: machine(processA, "running"), b: machine({ ...processA, pid: 202 }, "gone") },
} as const;

afterEach(() => {
  vi.restoreAllMocks();
  vi.useRealTimers();
});

it.each(
  (["lapsed", "exited"] as const).flatMap((verdict) =>
    schedules().map((schedule) => ({ verdict, order: schedule.join(" -> "), schedule })),
  ),
)("never publishes after a takeover A $verdict: $order", async ({ verdict, schedule }) => {
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

  const compose = (label: string, controlled: Store, chosen: Machine | undefined) =>
    composeServer({
      store: controlled,
      models: fakeModels().models,
      plugins: [chatOnly],
      workspace: { kind: "chat-only", locator: null },
      execution: { kind: "admit-only" },
      member: {
        label,
        pid: null,
        capabilities: [],
        ...(chosen === undefined ? {} : { machine: chosen }),
      },
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
    verdicts[verdict].a,
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
      updates.some((update) => update.name === lease && update.target !== null) ? claim : undefined,
    ),
    verdicts[verdict].b,
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
  if (verdict === "lapsed") {
    expect(await presenceB.holder(a.kernel.instance)).toMatchObject({ kind: "alive" });
    await vi.advanceTimersByTimeAsync(20_000);
  }

  expect(await presenceB.holder(a.kernel.instance)).toMatchObject({ kind: "dead", why: verdict });
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
});

it.each([
  { name: "A's process runs", a: processA, b: "running" },
  { name: "B's machine cannot tell", a: processA, b: "unknown" },
  { name: "A recorded no process", a: null, b: "gone" },
  { name: "B has no machine", a: processA, b: null },
] as const)("keeps a silent A alive for 20 s when $name", async (row) => {
  vi.useFakeTimers({ toFake: ["Date", "performance", "setInterval", "clearInterval"] });
  vi.setSystemTime(0);
  const intervals = vi.spyOn(globalThis, "setInterval");
  await using resources = new AsyncDisposableStack();
  const store = resources.adopt(sqliteStore({ memory: true }), (owned) => owned.close());

  const compose = (label: string, chosen: Machine | undefined) =>
    composeServer({
      store,
      models: fakeModels().models,
      plugins: [chatOnly],
      workspace: { kind: "chat-only", locator: null },
      execution: { kind: "admit-only" },
      member: {
        label,
        pid: null,
        capabilities: [],
        ...(chosen === undefined ? {} : { machine: chosen }),
      },
      home: null,
      description: { name: label, platform: "darwin", version: "0.1.0" },
    });

  const a = await compose("A", machine(row.a, "running"));
  resources.use(a.host);
  const heartbeat =
    intervals.mock.results[intervals.mock.calls.findIndex(([, every]) => every === 5_000)];
  assert(heartbeat?.type === "return");
  clearInterval(heartbeat.value);

  const b = await compose(
    "B",
    row.b === null ? undefined : machine({ ...processA, pid: 202 }, row.b),
  );

  resources.use(b.host);
  assert(b.kernel.presence !== null);
  expect(await b.kernel.presence.holder(a.kernel.instance)).toMatchObject({ kind: "alive" });
  await vi.advanceTimersByTimeAsync(20_000);
  expect(await b.kernel.presence.holder(a.kernel.instance)).toMatchObject({
    kind: "dead",
    why: "lapsed",
  });
});
