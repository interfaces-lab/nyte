import { spawnSync } from "node:child_process";
import { mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import { composeHost } from "@nyte-ai/core/server";
import type { FileChange, SessionId } from "@nyte-ai/schema";
import { afterEach, expect, it } from "vitest";
import { sqliteStore } from "../src/index.ts";
import { chatOnly, fakeModels } from "./fixtures/fake-models.ts";

const COMPACT_STORE = join(import.meta.dirname, "..", "scripts", "compact-store.ts");

const folders: string[] = [];

afterEach(async () => {
  await Promise.all(folders.splice(0).map((path) => rm(path, { recursive: true, force: true })));
});

async function withHost<T>(
  path: string,
  read: (host: Awaited<ReturnType<typeof composeHost>>) => Promise<T>,
): Promise<T> {
  const store = sqliteStore({ path });

  try {
    await using host = await composeHost({
      store,
      models: fakeModels().models,
      plugins: [chatOnly],
      workspace: { kind: "chat-only", locator: null },
      execution: { kind: "admit-only" },
      home: null,
      description: { name: "test", platform: "darwin", version: "0.1.0" },
    });

    return await read(host);
  } finally {
    await store.close();
  }
}

const file = (path: string, added: number): FileChange => ({
  path,
  status: "modified",
  added,
  removed: 0,
});

const compact = (path: string) =>
  spawnSync(process.execPath, [COMPACT_STORE, path], { encoding: "utf8" });

const viewChanges = (path: string, session: SessionId) =>
  withHost(path, async (host) => (await host.session(session).view()).changes);

function loggedChanges(path: string, session: SessionId) {
  const database = new DatabaseSync(path, { readOnly: true });

  try {
    return database
      .prepare(
        "SELECT event FROM log WHERE session = ? AND json_extract(event, '$.kind') = 'changes' ORDER BY seq",
      )
      .all(session)
      .map((row) => JSON.parse(String(row.event)).files);
  } finally {
    database.close();
  }
}

it("rewrites cumulative changes events to the deltas that fold to the same list, once", async () => {
  const folder = await mkdtemp(join(tmpdir(), "nyte-compact-store-"));
  folders.push(folder);
  const path = join(folder, "nyte.db");

  const session = await withHost(path, async (host) => {
    const { session: started } = await host.sessions.start({ name: "Edits", content: "Hi." });

    expect(compact(path)).toMatchObject({
      status: 1,
      stderr: expect.stringContaining("Quit every nyte and Nyte.app"),
    });

    return started;
  });

  const cumulative = [
    [file("a", 1)],
    [file("a", 1), file("b", 1)],
    [file("a", 2), file("b", 1), file("c", 1)],
    [file("a", 2), file("b", 1), file("c", 1)],
  ];

  const seeded = new DatabaseSync(path);

  const append = seeded.prepare(
    "INSERT INTO log (session, seq, at, event) SELECT ?, MAX(seq) + 1, 1, ? FROM log WHERE session = ?",
  );

  for (const files of cumulative)
    append.run(session.id, JSON.stringify({ head: null, kind: "changes", files }), session.id);
  seeded.close();

  const folded = await viewChanges(path, session.id);

  expect(folded).toEqual([file("a", 2), file("b", 1), file("c", 1)]);
  expect(compact(path)).toMatchObject({ status: 0 });
  expect(loggedChanges(path, session.id)).toEqual([
    [file("a", 1)],
    [file("b", 1)],
    [file("a", 2), file("c", 1)],
    [],
  ]);
  expect(await readdir(join(folder, "backups"))).toEqual([
    expect.stringMatching(/^manual-.+-before-compact-changes\.db$/u),
  ]);
  expect(await viewChanges(path, session.id)).toEqual(folded);
  expect(compact(path)).toMatchObject({
    status: 0,
    stdout: expect.stringContaining("Nothing to compact"),
  });
  expect(await readdir(join(folder, "backups"))).toHaveLength(1);
}, 30_000);
