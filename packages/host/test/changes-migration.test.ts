import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { STORE_VERSION } from "@nyte-ai/core/store";
import { composeHost } from "@nyte-ai/core/server";
import type { FileChange, SessionId } from "@nyte-ai/schema";
import { afterEach, expect, it, vi } from "vitest";
import { sqliteStore } from "../src/index.ts";
import { chatOnly, fakeModels } from "./fixtures/fake-models.ts";

const folders: string[] = [];

/** How many events core replays before it checkpoints a fold. */
const REPLAY_EVENTS = 1_024;

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

const viewChanges = (path: string, session: SessionId) =>
  withHost(path, async (host) => (await host.session(session).view()).changes);

function query(path: string, sql: string, ...values: string[]) {
  const database = new DatabaseSync(path);

  try {
    return database.prepare(sql).all(...values);
  } finally {
    database.close();
  }
}

it("shows a 0.0.18 chat's whole changed-files list after the store migrates", async () => {
  const folder = await mkdtemp(join(tmpdir(), "nyte-changes-migration-"));
  folders.push(folder);
  const path = join(folder, "nyte.db");

  const session = await withHost(
    path,
    async (host) => (await host.sessions.start({ name: "Edits", content: "Hi." })).session.id,
  );

  query(
    path,
    `WITH RECURSIVE pad(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM pad WHERE n < ${REPLAY_EVENTS}) INSERT INTO log (session, seq, at, event) SELECT ?, (SELECT MAX(seq) FROM log WHERE session = ?) + n, 1, ? FROM pad RETURNING seq`,
    session,
    session,
    JSON.stringify({ head: null, kind: "seen", principal: "nobody", commit: null }),
  );

  for (const files of [[file("a", 1)], [file("b", 1)], [file("a", 2), file("c", 1)]])
    query(
      path,
      "INSERT INTO log (session, seq, at, event) SELECT ?, MAX(seq) + 1, 1, ? FROM log WHERE session = ? RETURNING seq",
      session,
      JSON.stringify({ head: null, kind: "changes", files }),
      session,
    );

  await withHost(path, async (host) => {
    expect((await host.session(session).view()).changes).toEqual([file("a", 2), file("c", 1)]);
    await vi.waitFor(() =>
      expect(
        query(path, "SELECT session FROM fold_checkpoints WHERE session = ?", session),
      ).toHaveLength(1),
    );
  });

  query(path, "UPDATE store_meta SET version = ? RETURNING version", "20");

  const whole = [file("a", 2), file("b", 1), file("c", 1)];

  expect(await viewChanges(path, session)).toEqual(whole);
  expect(
    query(
      path,
      "SELECT event FROM log WHERE session = ? AND json_extract(event, '$.kind') = 'changes' ORDER BY seq",
      session,
    ).map((row) => JSON.parse(String(row.event)).files),
  ).toEqual([[file("a", 1)], [file("a", 1), file("b", 1)], whole]);
  expect(query(path, "SELECT version FROM store_meta")).toEqual([{ version: STORE_VERSION }]);
}, 30_000);
