import assert from "node:assert/strict";
import { describe, test } from "vitest";
import type { HeadName, SessionInfo } from "@nyte-ai/core";
import { sessionId } from "@nyte-ai/protocol";
import {
  DEFAULT_SESSION_VIEW,
  sessionsForView,
  type SessionViewGroup,
  type SessionViewSettings,
} from "./sidebar-view.ts";
const NOW = Date.UTC(2026, 8, 2, 12);
const DAY_MS = 24 * 60 * 60 * 1_000;
const MAIN_HEAD = "main" satisfies HeadName;

type FixtureStatus = "done" | "draft" | "working" | "needs-attention";
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
      : status === "needs-attention"
        ? {
            runId: `run-${id}`,
            head: MAIN_HEAD,
            phase: { kind: "waiting" },
            startedAt: updatedAt,
            attempts: 1,
            config: {},
          }
        : undefined;

  const heads: SessionInfo["heads"] =
    run === undefined ? [{ head: MAIN_HEAD, tip: null }] : [{ head: MAIN_HEAD, tip: null, run }];
  const info: SessionInfo = {
    sessionId: sessionId(id),
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

    assert.deepEqual(ids(sessionsForView(sessions, matching, NOW)), ["working", "done"]);

    for (const [dimension, settings] of [
      ["pull request", view({ ...matching, pullRequests: ["open"] })],
      ["environment", view({ ...matching, environments: ["cloud"] })],
      ["source", view({ ...matching, sources: ["web"] })],
    ] as const) {
      assert.deepEqual(ids(sessionsForView(sessions, settings, NOW)), [], dimension);
    }
  });

  test("includes archived sessions only when archived visibility is enabled", () => {
    const sessions = [
      session({ id: "archived", updatedAt: NOW, archived: true }),
      session({ id: "active", updatedAt: NOW - 1 }),
    ];

    assert.deepEqual(ids(sessionsForView(sessions, view({}), NOW)), ["active"]);
    assert.deepEqual(ids(sessionsForView(sessions, view({ archived: true }), NOW)), [
      "archived",
      "active",
    ]);
  });
});

describe("sidebar session ordering and grouping", () => {
  test("orders pinned sessions first, then applies the selected ordering", () => {
    const sessions = [
      session({ id: "recent-unpinned", updatedAt: NOW, status: "needs-attention" }),
      session({ id: "older-pinned", updatedAt: NOW - 30, pinned: true }),
      session({ id: "newer-pinned", updatedAt: NOW - 20, pinned: true }),
      session({ id: "older-unpinned", updatedAt: NOW - 40 }),
    ];

    assert.deepEqual(
      ids(sessionsForView(sessions, view({ grouping: "workspace", ordering: "updated" }), NOW)),
      ["newer-pinned", "older-pinned", "recent-unpinned", "older-unpinned"],
    );
    assert.deepEqual(
      ids(sessionsForView(sessions, view({ grouping: "workspace", ordering: "status" }), NOW)),
      ["newer-pinned", "older-pinned", "recent-unpinned", "older-unpinned"],
    );
  });

  test("status grouping yields populated groups in relevance order", () => {
    const groups = sessionsForView(
      [
        session({ id: "done", updatedAt: NOW, status: "done" }),
        session({ id: "draft", updatedAt: NOW, status: "draft" }),
        session({ id: "working", updatedAt: NOW, status: "working" }),
        session({ id: "attention", updatedAt: NOW, status: "needs-attention" }),
      ],
      view({ grouping: "status" }),
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
        { key: "working", label: "Working", sessions: ["working"] },
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
