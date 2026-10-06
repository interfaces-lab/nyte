import assert from "node:assert/strict";
import { test } from "vitest";
import { sessionId } from "@nyte-ai/core";
import type { HeadInfo, SessionInfo } from "@nyte-ai/core";
import type { HostEvent } from "@nyte-ai/app/bridge.ts";
import { SessionDirectory } from "./session-directory.ts";

const home = { environment: "local", workspacePath: null } as const;

const working: HeadInfo = {
  head: "main",
  tip: null,
  run: {
    runId: "r1",
    head: "main",
    origin: { kind: "user" },
    root: "r1",
    phase: { kind: "tools" },
    startedAt: 1,
    attempts: 1,
    config: {},
  },
};

const idle: HeadInfo = { head: "main", tip: null };

function row(id: string, options: { parent?: string; working?: boolean } = {}): SessionInfo {
  const session: SessionInfo = {
    sessionId: sessionId(id),
    activation: { kind: "active" },
    workspace: { kind: "local", id: "fixture", cwd: "/" },
    createdAt: 1,
    lastActivityAt: 1,
    pinned: false,
    archived: false,
    heads: [options.working === true ? working : idle],
    config: {},
  };

  if (options.parent === undefined) return session;

  return {
    ...session,
    parent: { sessionId: sessionId(options.parent), runId: "run", callId: "call", depth: 1 },
  };
}

function harness() {
  const events: HostEvent[] = [];
  const directory = new SessionDirectory((event) => events.push(event));

  return {
    directory,
    delegating: () =>
      events.flatMap((event) =>
        event.kind === "session_directory"
          ? event.changes.flatMap((change) =>
              change.kind === "delegating" ? [change.sessionIds.map(String)] : [],
            )
          : [],
      ),
  };
}

test("a settled root with a working grandchild is delegating until the grandchild settles", () => {
  const h = harness();
  h.directory.upsert(home, row("root"));
  h.directory.upsert(home, row("child", { parent: "root" }));
  h.directory.upsert(home, row("grandchild", { parent: "child", working: true }));
  h.directory.flush();

  assert.deepEqual(h.delegating(), [["root"]]);
  const snapshot = h.directory.snapshot();
  assert.deepEqual(
    snapshot.directories.map((entry) => [
      entry.sessions.map((session) => String(session.sessionId)),
      entry.delegating.map(String),
    ]),
    [[["root"], ["root"]]],
  );

  h.directory.upsert(home, row("grandchild", { parent: "child" }));
  h.directory.flush();
  assert.deepEqual(h.delegating(), [["root"], []]);

  h.directory.upsert(home, row("root", { working: true }));
  h.directory.flush();
  assert.deepEqual(h.delegating(), [["root"], []], "a root's own run never counts");
});

test("removing a root takes its descendants and a stale sweep cannot bring them back", () => {
  const h = harness();
  const startedAt = h.directory.clock();
  h.directory.replace(home, [row("root"), row("child", { parent: "root" })], startedAt);
  h.directory.remove(sessionId("root"));
  h.directory.replace(home, [row("root"), row("child", { parent: "root" })], startedAt);

  assert.deepEqual(h.directory.rows(home), []);
});

test("a sweep that no longer lists a child evicts the child alone", () => {
  const h = harness();
  h.directory.replace(home, [row("root"), row("child", { parent: "root" })], 0);
  h.directory.replace(home, [row("root")], h.directory.clock());

  assert.deepEqual(
    h.directory.rows(home).map((session) => String(session.sessionId)),
    ["root"],
  );
});
