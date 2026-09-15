import assert from "node:assert/strict";
import { describe, test } from "vitest";
import type { HeadName, SessionInfo } from "@nyte-ai/core";
import { sessionId } from "@nyte-ai/protocol";
import {
  DEFAULT_SESSION_VIEW,
  ENVIRONMENTS,
  GROUPINGS,
  ORDERINGS,
  sessionIsDraft,
  sessionsForNavigation,
  sessionsForView,
  type SessionViewGroup,
  type SessionViewSettings,
} from "./sidebar-view.ts";
const NOW = Date.UTC(2026, 8, 2, 12);
const DAY_MS = 24 * 60 * 60 * 1_000;
const MAIN_HEAD = "main" satisfies HeadName;

type FixtureStatus = "done" | "draft" | "working" | "waiting" | "retry" | "failed";
type FixtureRun = NonNullable<SessionInfo["heads"][number]["run"]>;

function session({
  id,
  updatedAt,
  status = "done",
  pinned = false,
  archived = false,
}: {
  readonly id: string;
  readonly updatedAt: number;
  readonly status?: FixtureStatus;
  readonly pinned?: boolean;
  readonly archived?: boolean;
}): SessionInfo {
  const run: FixtureRun | undefined =
    status === "working"
      ? {
          runId: `run-${id}`,
          head: MAIN_HEAD,
          phase: { kind: "respond" },
          startedAt: updatedAt,
          attempts: 1,
          config: {},
          lease: { owner: "test", expiresAt: updatedAt + 1_000 },
        }
      : status === "waiting"
        ? {
            runId: `run-${id}`,
            head: MAIN_HEAD,
            phase: { kind: "waiting" },
            startedAt: updatedAt,
            attempts: 1,
            config: {},
          }
        : status === "retry"
          ? {
              runId: `run-${id}`,
              head: MAIN_HEAD,
              phase: { kind: "retry", at: updatedAt + 1_000, error: "rate limit" },
              startedAt: updatedAt,
              attempts: 2,
              config: {},
            }
          : status === "failed"
            ? {
                runId: `run-${id}`,
                head: MAIN_HEAD,
                phase: { kind: "failed", error: "provider error" },
                startedAt: updatedAt,
                attempts: 1,
                config: {},
              }
            : undefined;

  const heads: SessionInfo["heads"] =
    run === undefined ? [{ head: MAIN_HEAD, tip: null }] : [{ head: MAIN_HEAD, tip: null, run }];
  const info: SessionInfo = {
    sessionId: sessionId(id),
    activation: { kind: "active" },
    createdAt: updatedAt,
    lastActivityAt: updatedAt,
    pinned,
    archived,
    heads,
    config: {},
  };
  return status === "draft" ? info : { ...info, name: id };
}

function view(patch: Partial<SessionViewSettings>): SessionViewSettings {
  return { ...DEFAULT_SESSION_VIEW, ...patch };
}

function ids(groups: readonly SessionViewGroup[]): string[] {
  return groups.flatMap((group) => group.sessions.map((item) => item.sessionId));
}

describe("sidebar session filtering", () => {
  const parent = {
    sessionId: sessionId("parent"),
    runId: "parent-run",
    callId: "task-call",
    depth: 1,
  };
  const children = (["working", "done", "draft", "waiting"] as const).map((status) => ({
    ...session({ id: `child-${status}`, updatedAt: NOW, status, pinned: true }),
    parent,
  }));
  const archivedChild = {
    ...session({ id: "archived-child", updatedAt: NOW, archived: true }),
    parent,
  };
  const root = session({ id: "parent", updatedAt: NOW - 1 });
  const archivedRoot = session({ id: "archived-root", updatedAt: NOW - 2, archived: true });
  const sessions = Object.freeze([...children, archivedChild, root, archivedRoot]);

  test("hides delegated sessions in every sidebar grouping, ordering, and environment", () => {
    for (const grouping of GROUPINGS) {
      for (const ordering of ORDERINGS) {
        for (const environment of ENVIRONMENTS) {
          for (const archived of [false, true]) {
            assert.deepEqual(
              ids(
                sessionsForView(sessions, view({ grouping, ordering, archived }), environment, NOW),
              ),
              archived ? ["parent", "archived-root"] : ["parent"],
              `${grouping}/${ordering}/${environment}/archived=${String(archived)}`,
            );
          }
        }
      }
    }
  });

  test("recent chats, search results, and archive-all include only unarchived roots", () => {
    assert.deepEqual(
      sessionsForNavigation(sessions).map((item) => item.sessionId),
      ["parent"],
    );
    assert.deepEqual(sessionsForNavigation([...children, archivedChild]), []);
    // Search results may contain a child without its parent in the same page.
    assert.deepEqual(sessionsForNavigation([{ ...archivedChild, archived: false }]), []);
  });

  test("navigation does not remove child records needed by parent task/job inspection", () => {
    sessionsForNavigation(sessions);
    sessionsForView(sessions, view({ archived: true }), "local", NOW);

    assert.equal(sessions.length, 7);
    const child = sessions.find((item) => item.sessionId === sessionId("child-working"));
    assert.equal(child, children[0]);
    assert.deepEqual(child?.parent, parent);
    assert.equal(child?.heads[0]?.run?.phase.kind, "respond");
  });

  test("ORs values within a dimension and ANDs independent dimensions", () => {
    const sessions = [
      session({ id: "working", updatedAt: NOW, status: "working" }),
      session({ id: "done", updatedAt: NOW - 1, status: "done" }),
      session({ id: "draft", updatedAt: NOW - 2, status: "draft" }),
    ];
    const matching = view({
      statuses: ["working", "done"],
      pullRequests: ["open", "none"],
      environments: ["cloud", "local"],
      sources: ["web", "desktop"],
    });

    assert.deepEqual(ids(sessionsForView(sessions, matching, "local", NOW)), ["working", "done"]);

    for (const [dimension, settings] of [
      ["pull request", view({ ...matching, pullRequests: ["open"] })],
      ["environment", view({ ...matching, environments: ["cloud"] })],
      ["source", view({ ...matching, sources: ["web"] })],
    ] as const) {
      assert.deepEqual(ids(sessionsForView(sessions, settings, "local", NOW)), [], dimension);
    }
  });

  test("includes archived sessions only when archived visibility is enabled", () => {
    const sessions = [
      session({ id: "archived", updatedAt: NOW, archived: true }),
      session({ id: "active", updatedAt: NOW - 1 }),
    ];

    assert.deepEqual(ids(sessionsForView(sessions, view({}), "local", NOW)), ["active"]);
    assert.deepEqual(ids(sessionsForView(sessions, view({ archived: true }), "local", NOW)), [
      "archived",
      "active",
    ]);
  });
});

describe("sidebar session ordering and grouping", () => {
  test("orders pinned sessions first, then applies the selected ordering", () => {
    const sessions = [
      session({ id: "recent-unpinned", updatedAt: NOW, status: "waiting" }),
      session({ id: "older-pinned", updatedAt: NOW - 30, pinned: true }),
      session({ id: "newer-pinned", updatedAt: NOW - 20, pinned: true }),
      session({ id: "older-unpinned", updatedAt: NOW - 40 }),
    ];

    assert.deepEqual(
      ids(
        sessionsForView(
          sessions,
          view({ grouping: "workspace", ordering: "updated" }),
          "local",
          NOW,
        ),
      ),
      ["newer-pinned", "older-pinned", "recent-unpinned", "older-unpinned"],
    );
    assert.deepEqual(
      ids(
        sessionsForView(
          sessions,
          view({ grouping: "workspace", ordering: "status" }),
          "local",
          NOW,
        ),
      ),
      ["newer-pinned", "older-pinned", "recent-unpinned", "older-unpinned"],
    );
  });

  test("status grouping yields populated groups in relevance order", () => {
    const groups = sessionsForView(
      [
        session({ id: "done", updatedAt: NOW, status: "done" }),
        session({ id: "draft", updatedAt: NOW, status: "draft" }),
        session({ id: "working", updatedAt: NOW, status: "working" }),
        // A parked run shares the Working group with a running one, most recent first.
        session({ id: "waiting", updatedAt: NOW - 10, status: "waiting" }),
        session({ id: "attention", updatedAt: NOW, status: "failed" }),
      ],
      view({ grouping: "status" }),
      "local",
      NOW,
    );

    assert.deepEqual(
      groups.map(({ key, label, sessions }) => ({
        key,
        label,
        sessions: sessions.map((item) => item.sessionId),
      })),
      [
        { key: "needs-attention", label: "Needs attention", sessions: ["attention"] },
        { key: "working", label: "Working", sessions: ["working", "waiting"] },
        { key: "draft", label: "Draft", sessions: ["draft"] },
        { key: "done", label: "Done", sessions: ["done"] },
      ],
    );
  });

  test("groups updates at the exact day and week boundaries", () => {
    const groups = sessionsForView(
      [
        session({ id: "today", updatedAt: NOW }),
        session({ id: "day-boundary", updatedAt: NOW - DAY_MS }),
        session({ id: "week", updatedAt: NOW - DAY_MS - 1 }),
        session({ id: "week-boundary", updatedAt: NOW - 7 * DAY_MS }),
        session({ id: "earlier", updatedAt: NOW - 7 * DAY_MS - 1 }),
      ],
      view({ grouping: "updated" }),
      "local",
      NOW,
    );

    assert.deepEqual(
      groups.map(({ key, label, sessions }) => ({
        key,
        label,
        sessions: sessions.map((item) => item.sessionId),
      })),
      [
        { key: "day", label: "Past day", sessions: ["today", "day-boundary"] },
        { key: "week", label: "Past week", sessions: ["week", "week-boundary"] },
        { key: "earlier", label: "Earlier", sessions: ["earlier"] },
      ],
    );
  });
});

describe("session marks", () => {
  test("untitled chats without a preview are drafts", () => {
    assert.equal(sessionIsDraft(session({ id: "draft", updatedAt: NOW, status: "draft" })), true);
    assert.equal(sessionIsDraft(session({ id: "done", updatedAt: NOW, status: "done" })), false);
  });
});
