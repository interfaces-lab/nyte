import { expect, test } from "vitest";
import { asId } from "@nyte-ai/schema";
import type { Execution, HeadInfo, SessionInfo } from "@nyte-ai/sdk";
import { chatsFor, COMPLETED, sessionRow, workspaceRow } from "../../test/view-fixtures.ts";

const run = {
  id: asId<"run">("run"),
  head: asId<"head">("main"),
  startedAt: 1,
  attempt: 1,
  origin: { kind: "input", message: asId<"message">("m") },
} as const;

const LIVE: Execution = { kind: "live", run, phase: "responding", stopping: false };

const STOPPED: Execution = {
  kind: "idle",
  lastRun: { id: run.id, end: { kind: "stopped" }, endedAt: 2 },
};

const FAILED: Execution = {
  kind: "idle",
  lastRun: {
    id: run.id,
    end: { kind: "failed", failure: { class: "provider", message: "Rate limited." } },
    endedAt: 2,
  },
};

const main = asId<"head">("main");

const tip = asId<"commit">("tip");

function heads(execution: Execution, unread = false): readonly HeadInfo[] {
  return [{ name: main, tip: { kind: "commit", id: tip }, stack: null, execution, unread }];
}

function unreadRow(id: string, execution: Execution, change: Partial<SessionInfo> = {}) {
  return sessionRow(id, { heads: heads(execution, true), ...change });
}

test("each chat takes one title rule, its parent, and the status of its main head", () => {
  const root = sessionRow("root", { name: null });
  const child = sessionRow("child", { name: null, parent: root.id }, LIVE);
  const named = sessionRow("Release", {}, STOPPED);
  const chats = chatsFor([root, child, named]);

  expect(chats.get(root.id)).toMatchObject({ title: "New chat", parent: null });
  expect(chats.get(child.id)).toMatchObject({ title: "Subagent", parent: root.id });
  expect(chats.get(child.id)?.status).toEqual({ kind: "working", run: run.id, stopping: false });
  expect(chats.get(named.id)).toMatchObject({ title: "Release", status: { kind: "stopped" } });
});

test("an open view's heads replace the listed ones as a unit, and closing it hands back the list", () => {
  const listed = sessionRow("open");
  const views = new Map([[listed.id, { execution: LIVE, heads: heads(LIVE, true) }]]);
  const open = chatsFor([listed], { views });

  expect(open.get(listed.id)).toMatchObject({
    status: { kind: "working" },
    unreadTip: { head: main, commit: tip },
  });
  expect(chatsFor([listed], {}, open).get(listed.id)).toMatchObject({
    status: { kind: "completed" },
    unreadTip: null,
  });

  const headless = new Map([[listed.id, { execution: LIVE, heads: [] }]]);

  expect(chatsFor([listed], { views: headless }).get(listed.id)?.status.kind).toBe("working");
});

test("a chat whose own run is over reads as a subagent still working while any descendant runs", () => {
  const root = sessionRow("root", {}, FAILED);
  const middle = sessionRow("middle", { parent: root.id });
  const leaf = sessionRow("leaf", { parent: middle.id }, LIVE);
  const busy = sessionRow("busy", {}, LIVE);
  const helper = sessionRow("helper", { parent: busy.id }, LIVE);
  const chats = chatsFor([root, middle, leaf, busy, helper]);

  expect(chats.get(root.id)?.status).toEqual({ kind: "subagent-working" });
  expect(chats.get(middle.id)?.status).toEqual({ kind: "subagent-working" });
  expect(chats.get(leaf.id)?.status.kind).toBe("working");
  expect(chats.get(busy.id)?.status.kind, "its own run outranks the subagent").toBe("working");

  const settled = chatsFor([root, middle, sessionRow("leaf", { parent: middle.id }), busy, helper]);

  expect(settled.get(root.id)?.status.kind, "the failure shows again").toBe("failed");
  expect(settled.get(middle.id)?.status.kind).toBe("completed");
});

test("a chat carries its main head's tip past the read mark, whatever its run did; deciding unread is the window's", () => {
  const chats = chatsFor([
    unreadRow("completed", COMPLETED),
    unreadRow("stopped", STOPPED),
    unreadRow("failed", FAILED),
    unreadRow("working", LIVE),
    sessionRow("seen"),
  ]);

  expect([...chats.values()].map((chat) => [chat.title, chat.unreadTip?.commit ?? null])).toEqual([
    ["completed", tip],
    ["stopped", tip],
    ["failed", tip],
    ["working", tip],
    ["seen", null],
  ]);
});

test("a chat's location stays unknown until the folders load, and a worktree names its source", () => {
  const project = workspaceRow("project", "/Users/ada/nyte");

  const worktree = workspaceRow("worktree", "/Users/ada/.nyte/worktrees/fix", {
    kind: "worktree",
    source: project.id,
    session: asId<"session">("fix"),
    branch: "fix-scroll",
    base: "main",
  });

  const offline = {
    ...workspaceRow("offline", "/Volumes/usb/notes"),
    availability: { kind: "unavailable", reason: "unreachable" },
  } as const;

  const sessions = [
    sessionRow("plain", { workspace: project.id }),
    sessionRow("fix", { workspace: worktree.id }),
    sessionRow("away", { workspace: offline.id }),
    sessionRow("gone", { workspace: asId<"workspace">("gone") }),
  ];

  const loading = chatsFor(sessions, { workspaces: undefined });

  expect(loading.get(asId<"session">("plain"))?.location).toEqual({ kind: "loading" });

  const chats = chatsFor(sessions, { workspaces: [project, worktree, offline] });
  const folder = { workspace: project.id, path: "/Users/ada/nyte", name: "nyte" };

  expect(chats.get(asId<"session">("plain"))?.location).toEqual({
    kind: "folder",
    ...folder,
    available: true,
    worktree: null,
  });

  expect(chats.get(asId<"session">("fix"))?.location).toEqual({
    kind: "folder",
    workspace: worktree.id,
    path: "/Users/ada/.nyte/worktrees/fix",
    name: "fix",
    available: true,
    worktree: { branch: "fix-scroll", source: folder },
  });

  expect(chats.get(asId<"session">("away"))?.location).toMatchObject({ available: false });
  expect(chats.get(asId<"session">("gone"))?.location).toEqual({ kind: "unlisted" });
});

test("pending actions reach the chat, and the first list that has a session gives its row", () => {
  const renamed = sessionRow("before");
  const deleted = sessionRow("deleted");
  const stale = sessionRow("both", { name: "Stale root row" });
  const fresh = sessionRow("both", { name: "Fresh" });

  const chats = chatsFor([], {
    lists: [[renamed, deleted, fresh], [stale]],
    project: (session) =>
      session.id === deleted.id
        ? null
        : session.id === renamed.id
          ? { ...session, name: "After" }
          : session,
  });

  expect([...chats.values()].map((chat) => chat.title)).toEqual(["After", "Fresh"]);
});

test("joining again keeps every chat that did not change, and the directory when none did", () => {
  const one = sessionRow("one");
  const two = sessionRow("two");
  const first = chatsFor([one, two]);

  expect(chatsFor([{ ...one }, { ...two }], {}, first)).toBe(first);

  const next = chatsFor([one, sessionRow("two", {}, LIVE)], {}, first);

  expect(next).not.toBe(first);
  expect(next.get(one.id)).toBe(first.get(one.id));
  expect(next.get(two.id)).not.toBe(first.get(two.id));
});
