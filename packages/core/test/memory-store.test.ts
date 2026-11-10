import type { RefUpdate } from "@nyte-ai/schema";
import { assert, describe, expect, it } from "vitest";
import { publishSet } from "../src/fold/watch.ts";
import { dev } from "../src/index.ts";
import { memoryStore, sessionRef } from "../src/store.ts";
import { commit } from "../src/fold/commit.ts";
import type { StoreConnection } from "../src/index.ts";
import { attempt, STALE } from "../src/store/session.ts";
import { main, setup, until } from "../src/harness.ts";

describe("memoryStore", () => {
  it("lists names by code point, as the SQL stores do", async () => {
    const { objects, refs } = await memoryStore().open();
    const target = await objects.put(1);
    await refs.set([
      { name: "kv/\u{1F600}", target },
      { name: "kv/\uFFFF", target },
    ]);

    expect((await refs.list("kv/")).map((ref) => ref.name)).toEqual(["kv/\uFFFF", "kv/\u{1F600}"]);
  });
});

describe("attempt", () => {
  it("retries a lost write until it lands, and fails stale once it keeps losing", async () => {
    let lost = 2;

    expect(await attempt("Landing", async () => (lost-- > 0 ? STALE : "landed"))).toBe("landed");

    let tries = 0;

    await expect(
      attempt("Racing", async () => {
        tries += 1;

        return STALE;
      }),
    ).rejects.toMatchObject({
      code: "stale",
      message: "Racing lost to concurrent writes 8 times.",
    });
    expect(tries).toBe(8);
  });
});

describe("commit", () => {
  it("publishes a write's events from the updates in hand, reading none of them back", async () => {
    const store = await memoryStore().open();
    let reads = 0;

    const counted: StoreConnection = {
      ...store,
      refs: {
        ...store.refs,
        async log(session, after, limit) {
          reads += 1;

          return store.refs.log(session, after, limit);
        },
      },
    };

    const { kernel, host } = await setup({ store: counted });
    const seen: number[] = [];
    kernel.bus.subscribeAll((_session, event) => {
      if (event.kind === "session") seen.push(event.seq);
    });
    const { session } = await host.sessions.start({ content: "Hi." });
    reads = 0;
    await session.update({ name: "Renamed" });

    expect(seen).toHaveLength(2);
    expect(reads).toBe(0);
  });

  it("publishes a landed write again when its first publish failed, so watchers still see it", async () => {
    const store = await memoryStore().open();
    let failing = false;

    const flaky: StoreConnection = {
      ...store,
      refs: {
        ...store.refs,
        async get(name) {
          if (failing && name.endsWith("/heads/main")) {
            failing = false;

            throw new Error("The head read failed.");
          }

          return store.refs.get(name);
        },
      },
    };

    const { kernel, host } = await setup({ store: flaky });
    const { session: created } = await host.sessions.start({ content: "Hi." });
    const seen: string[] = [];
    kernel.bus.subscribe(created.id, (event) => seen.push(event.kind));
    const lines: string[] = [];
    const sink = dev.sink;
    dev.on((line) => lines.push(line));
    failing = true;

    try {
      await commit(kernel, [
        {
          name: `${sessionRef(created.id)}/marks/m`,
          target: null,
          events: [{ head: main, kind: "head", from: null, to: null, reason: "moved" }],
        },
      ]);

      expect(lines.filter((line) => line.startsWith("DEV:store publish failed"))).toHaveLength(1);
      expect(await until(() => (seen.includes("head") ? seen : undefined))).toContain("head");
    } finally {
      dev.sink = sink;
    }
  });

  it("puts each logged event on the bus once and in seq order, reading a gap from the log", async () => {
    const { kernel, host } = await setup();
    const { session: created } = await host.sessions.start({ content: "Hi." });
    const seqs: number[] = [];

    kernel.bus.subscribe(created.id, (event) => {
      if (event.kind === "head") seqs.push(event.seq);
    });

    const mark = (name: string): RefUpdate[] => [
      {
        name: `${sessionRef(created.id)}/marks/${name}`,
        target: null,
        events: [{ head: main, kind: "head", from: null, to: null, reason: "moved" }],
      },
    ];

    const first = mark("a");
    const second = mark("b");
    const landedFirst = await kernel.store.refs.set(first);
    const landedSecond = await kernel.store.refs.set(second);
    assert(landedFirst.kind === "set");

    await publishSet(kernel, second, landedSecond);
    await publishSet(kernel, first, landedFirst);
    await publishSet(kernel, second, landedSecond);

    const [seq = 0] = landedFirst.logged;

    expect(seqs).toEqual([seq, seq + 1]);
  });
});
