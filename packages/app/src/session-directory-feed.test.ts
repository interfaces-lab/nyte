import assert from "node:assert/strict";
import { test } from "vitest";
import { sessionId } from "@nyte-ai/protocol";
import type { SessionInfo } from "@nyte-ai/protocol";
import type { SessionDirectoryChange, WorkspaceSessionDirectory } from "./bridge.ts";
import { SessionDirectoryFeed } from "./session-directory-feed.ts";

function row(id: string, parent?: string): SessionInfo {
  return {
    sessionId: sessionId(id),
    activation: { kind: "active" },
    createdAt: 1,
    lastActivityAt: 1,
    pinned: false,
    archived: false,
    heads: [],
    config: {},
    ...(parent === undefined
      ? {}
      : { parent: { sessionId: sessionId(parent), runId: "run", callId: "call", depth: 1 } }),
  };
}

const home = { environment: "local", workspacePath: null } as const;

function harness() {
  let directories: readonly WorkspaceSessionDirectory[] | undefined;
  const rows: SessionDirectoryChange[][] = [];
  let resyncs = 0;

  const feed = new SessionDirectoryFeed({
    directory: (update) => {
      directories = update(directories);
    },
    rows: (changes) => rows.push([...changes]),
    resync: () => {
      resyncs += 1;
    },
  });

  return {
    feed,
    rows,
    ids: () => directories?.flatMap((entry) => entry.sessions.map((item) => item.sessionId)),
    resyncs: () => resyncs,
  };
}

test("an event buffered before the snapshot applies on top of it", () => {
  const h = harness();
  h.feed.receive({ revision: 4, changes: [{ kind: "upsert", source: home, session: row("b") }] });
  assert.equal(h.ids(), undefined);

  const applied = h.feed.snapshot({
    revision: 3,
    directories: [{ ...home, sessions: [row("a")] }],
  });
  assert.deepEqual(
    applied.flatMap((entry) => entry.sessions.map((item) => item.sessionId)),
    ["b", "a"],
  );
  assert.deepEqual(h.ids(), ["b", "a"]);
  assert.equal(h.resyncs(), 0);
});

test("a duplicate or older revision is ignored", () => {
  const h = harness();
  h.feed.snapshot({ revision: 3, directories: [{ ...home, sessions: [row("a")] }] });
  h.feed.receive({ revision: 3, changes: [{ kind: "removed", sessionId: sessionId("a") }] });
  h.feed.receive({ revision: 2, changes: [{ kind: "removed", sessionId: sessionId("a") }] });
  assert.deepEqual(h.ids(), ["a"]);
  assert.deepEqual(h.rows, []);
});

test("a gap re-reads the snapshot and holds later events until it lands", () => {
  const h = harness();
  h.feed.snapshot({ revision: 3, directories: [{ ...home, sessions: [] }] });
  h.feed.receive({ revision: 5, changes: [{ kind: "upsert", source: home, session: row("c") }] });
  assert.equal(h.resyncs(), 1);
  assert.deepEqual(h.ids(), []);

  h.feed.receive({ revision: 6, changes: [{ kind: "removed", sessionId: sessionId("c") }] });
  h.feed.snapshot({ revision: 5, directories: [{ ...home, sessions: [row("c")] }] });
  assert.deepEqual(h.ids(), []);
  assert.equal(h.resyncs(), 1);
});

test("a child row never enters the top-level list but still reaches the row sink", () => {
  const h = harness();
  h.feed.snapshot({ revision: 1, directories: [{ ...home, sessions: [row("parent")] }] });
  const child = row("child", "parent");
  h.feed.receive({ revision: 2, changes: [{ kind: "upsert", source: home, session: child }] });
  assert.deepEqual(h.ids(), ["parent"]);
  assert.deepEqual(h.rows, [[{ kind: "upsert", source: home, session: child }]]);
});

test("a dropped source leaves the directory and availability creates the cloud entry", () => {
  const h = harness();
  h.feed.snapshot({ revision: 1, directories: [{ ...home, sessions: [row("a")] }] });
  h.feed.receive({
    revision: 2,
    changes: [{ kind: "availability", availability: { kind: "unavailable", message: "down" } }],
  });
  h.feed.receive({ revision: 3, changes: [{ kind: "dropped", source: home }] });
  assert.deepEqual(h.ids(), []);
});
