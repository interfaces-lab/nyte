import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { asId, asSeq } from "@nyte-ai/schema";
import type { DurableEvent, SessionId } from "@nyte-ai/schema";
import { afterEach, assert, describe, expect, it } from "vitest";
import { sqliteStore } from "../src/index.ts";
import { storeConformance } from "./store-conformance.ts";

const created: DurableEvent = { head: null, kind: "head", from: null, to: null, reason: "created" };

const session: SessionId = asId("s1");

const folders: string[] = [];

afterEach(async () => {
  for (const folder of folders.splice(0)) await rm(folder, { recursive: true, force: true });
});

async function folder(): Promise<string> {
  const made = await mkdtemp(join(tmpdir(), "nyte-sqlite-"));
  folders.push(made);

  return made;
}

storeConformance("sqliteStore in memory", async () => sqliteStore({ memory: true }));

storeConformance("sqliteStore on a file", async () =>
  sqliteStore({ path: join(await folder(), "nyte.db") }),
);

describe("sqliteStore", () => {
  it("opens a file in WAL mode", async () => {
    const path = join(await folder(), "nyte.db");
    const store = sqliteStore({ path });
    await store.open();
    const probe = new DatabaseSync(path);

    expect(probe.prepare("PRAGMA journal_mode").get()).toEqual({ journal_mode: "wal" });
    probe.close();
    await store.close();
  });

  it("keeps refs, objects, blobs and the log across a reopen", async () => {
    const path = join(await folder(), "nyte.db");
    const first = sqliteStore({ path });
    const { objects, refs } = await first.open();
    const target = await objects.put({ kept: true });

    const blob = await objects.putBlob(
      (async function* () {
        yield new Uint8Array([1, 2, 3]);
      })(),
    );

    await refs.set([{ name: "sessions/s1/heads/main", target, event: created }]);
    await first.close();

    const second = sqliteStore({ path });
    const reopened = await second.open();

    expect(await reopened.objects.get(target)).toEqual({ kept: true });
    expect((await reopened.objects.blob(blob))?.size).toBe(3);
    expect((await reopened.refs.get("sessions/s1/heads/main"))?.target).toBe(target);
    expect(await reopened.refs.log(session, asSeq(0), 10)).toMatchObject([
      { seq: 1, kind: "head", reason: "created" },
    ]);
    await second.close();
  });

  it("lets one of two connections to one file win a set under one expect", async () => {
    const path = join(await folder(), "nyte.db");
    const left = sqliteStore({ path });
    const right = sqliteStore({ path });
    const one = await left.open();
    const two = await right.open();
    const target = await one.objects.put("base");
    const first = await one.refs.set([{ name: "kv/x", target }]);
    assert(first.kind === "set");

    const outcomes = [
      await one.refs.set([{ name: "kv/x", target, expect: first.revisions[0] }]),
      await two.refs.set([{ name: "kv/x", target, expect: first.revisions[0] }]),
    ];

    expect(outcomes.map((outcome) => outcome.kind)).toEqual(["set", "stale"]);
    await left.close();
    await right.close();
  });
});
