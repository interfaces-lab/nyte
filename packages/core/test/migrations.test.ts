import { asId } from "@nyte-ai/schema";
import type { Json } from "@nyte-ai/schema";
import { expect, it } from "vitest";
import { runStep } from "../src/engine/durable.ts";
import { migrateStore, STORE_VERSION } from "../src/store.ts";
import type { StoredRecord } from "../src/store.ts";
import { liveRef } from "../src/store/refs.ts";
import { configuration, main, setup, startRun } from "./harness.ts";

it("gives an older store's unstopped runs their live ref and its parked calls their wait index", async () => {
  const { kernel, host } = await setup();
  const session = await host.sessions.create();

  const run = await startRun(
    kernel,
    session.id,
    main,
    { kind: "continuation", from: "wake" },
    configuration,
  );

  await runStep<Json>(kernel, {
    session: session.id,
    head: main,
    run: null,
    call: asId("c1"),
    kind: "hook",
    replay: "safe",
    intent: { test: true },
    part: null,
    signal: new AbortController().signal,
    body: async (durable) => durable.wait({ kind: "timer", until: Date.now() + 60_000 }),
    settle: async () => ({ result: null, updates: [] }),
    decode: (result) => result,
  });

  const live = liveRef(session.id, run.id);
  const index = (await kernel.store.refs.list("waits/")).map((ref) => ref.name);
  const records: StoredRecord[] = [];

  for (const ref of await kernel.store.refs.list("sessions/"))
    if (ref.target !== null && ref.name !== live)
      records.push({
        name: ref.name,
        target: ref.target,
        revision: ref.revision,
        body: JSON.stringify(await kernel.store.objects.get(ref.target)),
      });

  const created: string[] = [];
  const moved: string[] = [];

  await migrateStore({
    dialect: "sqlite",
    stamp: async () => ({ version: STORE_VERSION - 2, empty: false }),
    records: async () => records,
    logs: async function* () {},
    commit: async (change) => {
      created.push(...change.creates.map((creation) => creation.name));
      moved.push(...change.repoints.map((repoint) => repoint.name));

      return "committed";
    },
  });

  expect(index).toHaveLength(1);
  expect(moved).toEqual([]);
  expect(created.toSorted()).toEqual([live, ...index].toSorted());
});
