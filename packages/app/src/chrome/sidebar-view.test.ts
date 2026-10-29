import { Value } from "typebox/value";
import { expect, test } from "vitest";
import type { SessionInfo } from "@nyte-ai/sdk";
import { sessionRow } from "../../test/view-fixtures.ts";
import {
  DEFAULT_SESSION_VIEW,
  ENVIRONMENTS,
  folderView,
  GROUPINGS,
  SessionViewSchema,
  sessionPage,
  sessionsForView,
  SHOW_FIELDS,
  SORTS,
  STATUSES,
  type SessionViewGroup,
} from "./sidebar-view.ts";

const NONE = new Map<never, never>();

function names(groups: readonly SessionViewGroup[]): readonly (readonly [string, string[]])[] {
  return groups.map((group) => [
    group.label ?? group.key,
    group.sessions.map((session) => session.name ?? ""),
  ]);
}

test("every view the Customize menu can choose is one the sidebar can store", () => {
  expect(Value.Check(SessionViewSchema, DEFAULT_SESSION_VIEW)).toBe(true);

  for (const grouping of GROUPINGS)
    for (const sort of SORTS)
      expect(
        Value.Check(SessionViewSchema, {
          grouping,
          sort,
          show: SHOW_FIELDS,
          statuses: STATUSES,
          environments: ENVIRONMENTS,
          archived: true,
        }),
      ).toBe(true);

  expect(Value.Check(SessionViewSchema, { ...DEFAULT_SESSION_VIEW, grouping: "folder" })).toBe(
    false,
  );
});

test("Updated grouping buckets chats by local calendar day", () => {
  const now = new Date(2026, 4, 20, 9, 0).getTime();

  const at = (name: string, day: number, hour: number): SessionInfo =>
    sessionRow(name, { lastActivityAt: new Date(2026, 4, day, hour, 0).getTime() });

  const groups = sessionsForView(
    [
      at("this morning", 20, 0),
      at("late last night", 19, 23),
      at("two days back", 18, 12),
      at("six days back", 14, 12),
      at("a week back", 13, 12),
      at("29 days back", 21 - 30, 12),
      at("30 days back", 20 - 30, 12),
    ],
    { ...DEFAULT_SESSION_VIEW, grouping: "updated", sort: "updated" },
    "local",
    now,
  );

  expect(names(groups)).toEqual([
    ["Today", ["this morning"]],
    ["Yesterday", ["late last night"]],
    ["Last 7 Days", ["two days back", "six days back"]],
    ["Last 30 Days", ["a week back", "29 days back"]],
    ["Older", ["30 days back"]],
  ]);
});

test("the Archived filter lists archived chats only, and live chats leave it", () => {
  const sessions = [
    sessionRow("live"),
    sessionRow("archived", { archived: true }),
    sessionRow("child", { archived: true, parent: sessionRow("live").id }),
  ];

  const listed = (archived: boolean) =>
    sessionsForView(sessions, { ...DEFAULT_SESSION_VIEW, archived }, "local", 0).flatMap((group) =>
      group.sessions.map((session) => session.name),
    );

  expect(listed(false)).toEqual(["live"]);
  expect(listed(true)).toEqual(["archived"]);
});

test("pinned chats leave their workspace in grouped views and lead the flat list", () => {
  const sessions = [
    sessionRow("older pin", { pinned: true, createdAt: 1 }),
    sessionRow("newest", { createdAt: 3 }),
    sessionRow("middle", { createdAt: 2 }),
  ];

  const status = { ...DEFAULT_SESSION_VIEW, grouping: "status" } as const;

  expect(names(folderView(sessions, status, 0, NONE, new Set()))).toEqual([
    ["Done", ["newest", "middle"]],
  ]);
  expect(names(sessionsForView(sessions, DEFAULT_SESSION_VIEW, "local", 0))).toEqual([
    ["none", ["older pin", "newest", "middle"]],
  ]);
});

test("a page shows the open chat past the fold and Show More reveals the rows after it", () => {
  expect(sessionPage(20, 5, 0, -1)).toEqual({ visible: 5, next: 8, revealed: 8 });
  expect(sessionPage(20, 5, 0, 2)).toEqual({ visible: 5, next: 8, revealed: 8 });

  const raised = sessionPage(20, 5, 0, 11);
  expect(raised).toEqual({ visible: 12, next: 8, revealed: 15 });
  expect(sessionPage(20, 5, raised.revealed, -1)).toEqual({ visible: 20, next: 0, revealed: 23 });
  expect(sessionPage(6, 5, 0, -1), "a lone leftover row is shown").toMatchObject({
    visible: 6,
    next: 0,
  });
});
