import { existsSync } from "node:fs";
import { memoryStore } from "@nyte-ai/core";
import { assert, describe, expect, it } from "vitest";
import { createBenchDriver } from "../src/bench/index.ts";
import { cuttableLink } from "../src/bench/link.ts";
import { severableStore } from "../src/bench/store.ts";

const driver = createBenchDriver();

describe("bench driver", () => {
  it("opens a host with the bench tools and streams a scripted reply in tokens, pausing on command", async () => {
    const bench = await driver.open();
    const session = await bench.host.sessions.create();
    const view = await session.view();

    expect(view.catalog.tools.map((tool) => tool.name)).toEqual(
      expect.arrayContaining(["bench_wait_job", "bench_never"]),
    );

    bench.model.script({ text: "abcdef", tokens: 6 });
    const paused = bench.model.pauseAfter(3);
    const receipt = await session.send("go");
    await paused;
    bench.model.release();
    const end = await receipt.settled();

    assert(end.kind === "completed");
    expect((await session.view()).messages.at(-1)).toMatchObject({
      kind: "part",
      partKind: "text",
      state: { markdown: "abcdef" },
    });

    const fallback = await (await session.send("again")).settled();

    expect(fallback.kind).toBe("completed");
    await bench.close();
  });

  it("seeds sessions and messages without a model", async () => {
    const bench = await driver.open({ sessions: 3, messagesPerSession: 2 });
    const listed = await bench.host.sessions.list();

    expect(listed.items).toHaveLength(3);
    const first = bench.host.session(listed.items[0].id);

    expect((await first.view()).messages.map((message) => message.kind)).toEqual(["part", "part"]);
    await bench.close();
  });

  it("crashes, restarts over the same store, and removes its directories on close", async () => {
    const bench = await driver.open();
    const session = await bench.host.sessions.create();
    const [workspace] = await bench.host.workspaces.list();
    const crashed = bench.host;
    await bench.crash();

    await expect(crashed.sessions.list()).rejects.toMatchObject({ code: "unavailable" });

    const restarted = await bench.restart();

    expect(restarted).toBe(bench.host);
    expect((await restarted.sessions.list()).items.map((info) => info.id)).toEqual([session.id]);
    await expect(bench.connect()).rejects.toMatchObject({ code: "unavailable" });
    expect(bench.ids.seq(3)).toBe(3);
    await bench.close();

    assert(workspace !== undefined && "path" in workspace.target);
    expect(existsSync(workspace.target.path)).toBe(false);
  });

  it("counts the host's git diff reads over a fixture of changed files", async () => {
    const bench = await driver.open({ changedFiles: 3 });
    const [info] = await bench.host.workspaces.list();
    assert(info !== undefined);
    const git = await bench.host.workspace(info.id).git();
    assert(git.kind === "available");
    const changes = await git.api.changes({ kind: "worktree" });

    expect(changes.files).toHaveLength(3);

    for await (const set of git.api.patches(
      { kind: "worktree" },
      changes.files.map((file) => file.path),
    ))
      if ([...set.entries.values()].every((entry) => entry.fresh) && set.entries.size === 3) break;

    expect(bench.counters.gitDiffReads()).toBeGreaterThan(0);
    await bench.close();
  });
});

describe("severableStore", () => {
  it("rejects every call once severed and never closes the inner store", async () => {
    const inner = memoryStore();
    const severable = severableStore(inner);
    const connection = await severable.store.open();
    const target = await connection.objects.put({ kind: "x" });
    severable.sever();

    await expect(connection.refs.get("a")).rejects.toMatchObject({ code: "unavailable" });
    await expect(connection.objects.get(target)).rejects.toMatchObject({ code: "unavailable" });
    await expect(severable.store.open()).rejects.toMatchObject({ code: "unavailable" });
    await connection.close();
    await severable.store.close();
    const still = await inner.open();

    expect(await still.objects.get(target)).toEqual({ kind: "x" });
    await still.close();
  });
});

describe("cuttableLink", () => {
  it("pipes to its target, refuses while dropped and pipes again once restored", async () => {
    const bench = await driver.open();
    const listener = await bench.host.listen({
      transport: { kind: "http", port: 0 },
      auth: { kind: "token", token: "a-token-of-16-chars" },
    });
    assert(listener.address !== null);
    const link = await cuttableLink(listener.address);
    const status = () => fetch(`${link.url}/.nyte/describe`).then((response) => response.status);

    expect(await status()).toBe(200);
    link.drop();
    await expect(status()).rejects.toThrow();
    link.restore();
    expect(await status()).toBe(200);
    await link.close();
    await listener.close();
    await bench.close();
  });
});
