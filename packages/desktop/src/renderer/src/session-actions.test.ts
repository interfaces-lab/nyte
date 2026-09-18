import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { toast } from "@nyte-ai/ui/sonner";
import type { SessionInfo, SessionSnapshot } from "@nyte-ai/protocol";
import { sessionId } from "@nyte-ai/protocol";
import type { WorkspaceSessionDirectory } from "../../shared/ipc.ts";
import { ActionToasts } from "./action-toasts.ts";
import { SessionActions } from "./session-actions.ts";
import { PaneController } from "./layout/pane-controller.ts";
import { activeSelection } from "./layout/pane-layout.ts";
import { keys } from "./query-keys.ts";
import type { SessionPage } from "./session-directory.ts";

function chat(id: string): SessionInfo {
  return {
    sessionId: sessionId(id),
    activation: { kind: "active" },
    name: id,
    createdAt: 1,
    lastActivityAt: 1,
    pinned: false,
    archived: false,
    heads: [],
    config: {},
  };
}

function snapshot(session: SessionInfo): SessionSnapshot {
  return {
    session,
    seq: 1,
    head: "main",
    tip: null,
    config: {},
    transcript: [],
    pending: [],
    context: { estimatedTokens: 0, usageTokens: 0, trailingTokens: 0, contextWindow: 1000 },
  };
}

function fixture(chats = [chat("one"), chat("two"), chat("three")]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const saved = new Map(chats.map((session) => [session.sessionId, session]));
  const writes = Promise.withResolvers<void>();
  const failures = new Set<string>();
  client.setQueryData(keys.sessionDirectory, [{ workspacePath: null, sessions: chats }]);
  client.setQueryData(keys.sessionPreview, { items: chats });
  client.setQueryData(keys.sessionSearch("chat"), { items: chats });
  for (const session of chats) {
    client.setQueryData(keys.session(session.sessionId), session);
    client.setQueryData(keys.snapshot(session.sessionId), snapshot(session));
  }
  const toasts = new ActionToasts();
  const actions = new SessionActions({
    toasts,
    client,
    sessions: {
      async setArchived(input) {
        await writes.promise;
        if (failures.has(input.sessionId)) throw new Error("Disk unavailable");
        const session = saved.get(input.sessionId);
        assert.ok(session);
        saved.set(input.sessionId, { ...session, archived: input.archived });
      },
      async setPinned(input) {
        await writes.promise;
        const session = saved.get(input.sessionId);
        assert.ok(session);
        saved.set(input.sessionId, { ...session, pinned: input.pinned });
      },
      async rename(input) {
        await writes.promise;
        if (failures.has(input.name)) throw new Error("Disk unavailable");
        const session = saved.get(input.sessionId);
        assert.ok(session);
        saved.set(input.sessionId, { ...session, name: input.name });
      },
      async delete(input) {
        await writes.promise;
        if (failures.has(input.sessionId)) throw new Error("Disk unavailable");
        saved.delete(input.sessionId);
      },
    },
  });
  const directory = () =>
    actions.projectList(
      client
        .getQueryData<readonly WorkspaceSessionDirectory[]>(keys.sessionDirectory)
        ?.flatMap((entry) => entry.sessions) ?? [],
    );
  return { client, saved, writes, failures, actions, directory, toasts };
}

function notification(title: string) {
  const notice = toast.getToasts().find((item) => "title" in item && item.title === title);
  assert.ok(notice !== undefined && "title" in notice, `Missing notification: ${title}`);
  return notice;
}

function undo(title: string, toasts: ActionToasts): void {
  const notice = notification(title);
  assert.ok(notice.action);
  toasts.undo(notice.id);
  toast.dismiss(notice.id);
}

beforeEach(() => {
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(performance.now());
    return 0;
  });
  vi.stubGlobal("cancelAnimationFrame", () => {});
  toast.dismiss();
});
afterEach(() => vi.unstubAllGlobals());

test("consecutive archives paint immediately and share one Undo notification", async () => {
  const f = fixture();
  for (const id of ["one", "two", "three"]) f.actions.archive([sessionId(id)], true);
  assert.ok(f.directory().every((session) => session.archived));
  assert.ok([...f.saved.values()].every((session) => !session.archived));
  assert.equal(toast.getToasts().length, 1);
  notification("3 chats archived");
  undo("3 chats archived", f.toasts);
  assert.ok(f.directory().every((session) => !session.archived));
  f.writes.resolve();
  await vi.waitFor(() => {
    assert.ok([...f.saved.values()].every((session) => !session.archived));
    assert.equal(f.actions.getSnapshot().length, 0);
  });
  f.client.clear();
});

test("polling cannot erase an archive, and success updates every cached projection", async () => {
  const f = fixture();
  const id = sessionId("one");
  f.actions.archive([id], true);
  f.client.setQueryData(keys.sessionDirectory, [
    { workspacePath: null, sessions: [{ ...chat("one"), lastActivityAt: 99 }, chat("two")] },
  ]);
  assert.equal(f.directory()[0]?.archived, true);
  assert.equal(f.directory()[0]?.lastActivityAt, 99);
  f.writes.resolve();
  await vi.waitFor(() =>
    assert.equal(f.client.getQueryData<SessionInfo>(keys.session(id))?.archived, true),
  );
  assert.equal(f.client.getQueryData<SessionSnapshot>(keys.snapshot(id))?.session.archived, true);
  assert.equal(f.client.getQueryData<SessionPage>(keys.sessionPreview)?.items[0]?.archived, true);
  assert.equal(
    f.client
      .getQueryData<SessionPage>(keys.sessionSearch("chat"))
      ?.items.some((session) => session.sessionId === id),
    false,
  );
  assert.equal(f.directory()[0]?.lastActivityAt, 99);
  undo("1 chat archived", f.toasts);
  await vi.waitFor(() =>
    assert.equal(f.client.getQueryData<SessionInfo>(keys.session(id))?.archived, false),
  );
  f.client.clear();
});

test("a partial bulk failure restores only the failed chat and updates the toast count", async () => {
  const f = fixture();
  f.failures.add("two");
  f.actions.archive([sessionId("one"), sessionId("two"), sessionId("three")], true);
  f.writes.resolve();
  await vi.waitFor(() => {
    assert.deepEqual(
      f.directory().map((session) => session.archived),
      [true, false, true],
    );
    notification("2 chats archived");
  });
  notification("Couldn't archive this chat. Try again.");
  undo("2 chats archived", f.toasts);
  await vi.waitFor(() => assert.ok(f.directory().every((session) => !session.archived)));
  f.client.clear();
});

test.each([false, true])(
  "Undo preserves the pane when both writes fail, initially archived: %s",
  async (archived) => {
    const f = fixture([{ ...chat("one"), archived }]);
    const id = sessionId("one");
    const panes = new PaneController({ storageKey: "test" });
    panes.selectSession(id);
    f.failures.add("one");
    f.actions.archive([id], !archived, (sessionId) => panes.removeSessionWithUndo(sessionId));
    assert.equal(f.directory()[0]?.archived, !archived);
    assert.deepEqual(
      activeSelection(panes.getSnapshot().layout),
      archived ? { kind: "session", sessionId: id } : { kind: "blank" },
    );
    undo(archived ? "1 chat restored" : "1 chat archived", f.toasts);
    assert.equal(f.directory()[0]?.archived, archived);
    const selection = archived ? { kind: "blank" } : { kind: "session", sessionId: id };
    assert.deepEqual(activeSelection(panes.getSnapshot().layout), selection);
    f.writes.resolve();
    await vi.waitFor(() => assert.equal(f.actions.getSnapshot().length, 0));
    assert.equal(f.saved.get(id)?.archived, archived);
    assert.equal(f.directory()[0]?.archived, archived);
    assert.deepEqual(activeSelection(panes.getSnapshot().layout), selection);
    notification("Couldn't archive this chat. Try again.");
    notification("Couldn't restore this chat. Try again.");
    f.client.clear();
  },
);

test.each([false, true])(
  "failed Undo follows a successful write, initially archived: %s",
  async (archived) => {
    const f = fixture([{ ...chat("one"), archived }]);
    const id = sessionId("one");
    const panes = new PaneController({ storageKey: "test" });
    panes.selectSession(id);
    f.actions.archive([id], !archived, (sessionId) => panes.removeSessionWithUndo(sessionId));
    f.writes.resolve();
    await vi.waitFor(() => assert.equal(f.actions.getSnapshot().length, 0));
    f.failures.add("one");
    undo(archived ? "1 chat restored" : "1 chat archived", f.toasts);
    await vi.waitFor(() => assert.equal(f.actions.getSnapshot().length, 0));
    assert.equal(f.saved.get(id)?.archived, !archived);
    assert.equal(f.directory()[0]?.archived, !archived);
    assert.deepEqual(
      activeSelection(panes.getSnapshot().layout),
      archived ? { kind: "session", sessionId: id } : { kind: "blank" },
    );
    f.client.clear();
  },
);

test.each(["selection", "draft"])("double-failure Undo preserves a newer %s", async (newer) => {
  const f = fixture();
  const id = sessionId("one");
  const panes = new PaneController({ storageKey: "test" });
  panes.selectSession(id);
  f.failures.add("one");
  f.actions.archive([id], true, (sessionId) => panes.removeSessionWithUndo(sessionId));
  if (newer === "selection") panes.selectSession(sessionId("two"));
  else
    panes.viewState.writeBlank("primary", {
      ...panes.viewState.readBlank("primary"),
      composer: { draft: "Keep my draft", selectionStart: 13, selectionEnd: 13, focused: true },
    });
  const selection = activeSelection(panes.getSnapshot().layout);
  const draft = panes.viewState.readBlank("primary").composer;
  undo("1 chat archived", f.toasts);
  assert.deepEqual(activeSelection(panes.getSnapshot().layout), selection);
  assert.deepEqual(panes.viewState.readBlank("primary").composer, draft);
  f.writes.resolve();
  await vi.waitFor(() => assert.equal(f.actions.getSnapshot().length, 0));
  assert.equal(f.directory()[0]?.archived, false);
  assert.deepEqual(activeSelection(panes.getSnapshot().layout), selection);
  assert.deepEqual(panes.viewState.readBlank("primary").composer, draft);
  f.client.clear();
});

test("a newer restore replaces the older archive's Undo action", async () => {
  const f = fixture();
  f.actions.archive([sessionId("one")], true);
  const old = notification("1 chat archived");
  f.actions.archive([sessionId("one")], false);
  assert.equal(toast.getToasts().length, 1);
  notification("1 chat restored");
  old.onDismiss?.(old);
  assert.equal(f.directory()[0]?.archived, false);
  f.writes.resolve();
  await vi.waitFor(() => assert.equal(f.actions.getSnapshot().length, 0));
  undo("1 chat restored", f.toasts);
  assert.equal(f.directory()[0]?.archived, true);
  await vi.waitFor(() => assert.equal(f.saved.get(sessionId("one"))?.archived, true));
  f.client.clear();
});

test("rename rollback preserves a later rename, pin, and refreshed activity", async () => {
  const f = fixture();
  const id = sessionId("one");
  f.failures.add("rejected");
  const failed = f.actions.rename({ sessionId: id, name: "rejected" });
  const renamed = f.actions.rename({ sessionId: id, name: "kept" });
  f.actions.pin({ sessionId: id, pinned: true });
  f.client.setQueryData(keys.sessionDirectory, [
    { workspacePath: null, sessions: [{ ...chat("one"), lastActivityAt: 42 }] },
  ]);
  assert.equal(f.directory()[0]?.name, "kept");
  assert.equal(f.directory()[0]?.pinned, true);
  f.writes.resolve();
  assert.equal(await failed, false);
  assert.equal(await renamed, true);
  await vi.waitFor(() => assert.equal(f.saved.get(id)?.pinned, true));
  assert.equal(f.directory()[0]?.name, "kept");
  assert.equal(f.directory()[0]?.lastActivityAt, 42);
  f.client.clear();
});

test("delete hides immediately but Undo cancels permanent deletion", async () => {
  const f = fixture();
  let open = true;
  f.writes.resolve();
  f.actions.delete(sessionId("one"), () => {
    open = false;
    return () => {
      open = true;
    };
  });
  assert.equal(open, false);
  assert.equal(f.directory().length, 2);
  assert.equal(f.saved.size, 3);
  const notice = notification("1 chat deleted");
  undo("1 chat deleted", f.toasts);
  notice.onAutoClose?.(notice);
  await Promise.resolve();
  assert.equal(open, true);
  assert.equal(f.directory().length, 3);
  assert.equal(f.saved.size, 3);
  f.client.clear();
});

test.each(["onDismiss", "onAutoClose"] as const)(
  "delete commits when Sonner sends %s",
  async (event) => {
    const f = fixture();
    f.writes.resolve();
    f.actions.delete(sessionId("one"), () => () => {});
    f.actions.delete(sessionId("two"), () => () => {});
    assert.equal(f.saved.size, 3);
    const notice = notification("2 chats deleted");
    notice[event]?.(notice);
    notice[event]?.(notice);
    await vi.waitFor(() => assert.equal(f.saved.size, 1));
    assert.deepEqual(
      f.directory().map((session) => session.sessionId),
      [sessionId("three")],
    );
    assert.equal(f.client.getQueryData(keys.snapshot(sessionId("one"))), undefined);
    f.client.clear();
  },
);

test("failed permanent deletion restores the chat and its pane", async () => {
  const f = fixture();
  let open = true;
  f.failures.add("one");
  f.actions.delete(sessionId("one"), () => {
    open = false;
    return () => {
      open = true;
    };
  });
  const notice = notification("1 chat deleted");
  notice.onAutoClose?.(notice);
  f.writes.resolve();
  await vi.waitFor(() => assert.equal(open, true));
  assert.equal(f.directory().length, 3);
  notification("Couldn't delete this chat. Try again.");
  f.client.clear();
});
