import type { Scenario } from "../scenario.ts";
import { invariant, timed } from "../scenario.ts";

/** §7: refs.set is the one CAS; contending writers get exactly one set and one stale; the log reads back in order. */
export const storeCas: Scenario = {
  name: "store-cas",
  guarantee: "Two writers on one ref with the same expect: one set, one stale, nothing partial; log(after) is exactly what was appended.",
  async run(driver) {
    const bench = await driver.open();
    const store = await bench.store.open();
    const session = bench.ids.session("bench");
    const name = `sessions/${session}/heads/main`;
    const target = await store.objects.put({ kind: "bench" });
    const first = await store.refs.set([{ name, target, expect: "absent" }]);
    if (first.kind !== "set" || first.revisions[0] === undefined) throw new Error("initial set failed");
    const revision = first.revisions[0];
    const [a, b] = await Promise.all([
      store.refs.set([{ name, target, expect: revision }]),
      store.refs.set([{ name, target, expect: revision }]),
    ]);
    const outcomes = [a.kind, b.kind].toSorted();
    const batch = await timed(async () => {
      for (let i = 0; i < 2_000; i += 1) {
        await store.refs.set([{ name: `sessions/${session}/parts/p${i}`, target, event: { head: null, kind: "part", part: bench.ids.part(`p${i}`), change: "created", partKind: "bench", placement: { kind: "modal" }, state: {}, version: 1, run: null } }]);
      }
    });
    const tail = await store.refs.tail(session);
    const log = await timed(() => store.refs.log(session, bench.ids.seq(0), 10_000));
    const ordered = log.value.every((event, index) => index === 0 || event.seq > (log.value[index - 1]?.seq ?? 0));
    await store.close();
    await bench.close();

    return {
      name: this.name,
      invariants: [
        invariant("contending writers: exactly one set and one stale", outcomes.join() === "set,stale"),
        invariant("the log holds every appended event in seq order", ordered && log.value.length >= 2_000 && log.value.at(-1)?.seq === tail),
      ],
      metrics: { setsPerSecondMin: 2_000 / (batch.ms / 1000), logReadMs: log.ms },
    };
  },
};
