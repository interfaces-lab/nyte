import assert from "node:assert/strict";
import { afterEach, beforeEach, test, vi } from "vitest";
import { QueryClient } from "@tanstack/react-query";
import { toast } from "@nyte-ai/ui/toast";
import type { SessionInfo } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { ActionToasts } from "../lib/action-toasts.ts";
import { reflects, SessionActions } from "./session-actions.ts";
import { keys } from "./query-client.ts";
import { scriptedConnection } from "../../test/scripted-connection.ts";

function chat(id: string): SessionInfo {
  return {
    id: asId<"session">(id),
    name: id,
    parent: null,
    call: null,
    workspace: asId<"workspace">("fixture"),
    pinned: false,
    archived: false,
    activation: { kind: "active" },
    heads: [],
    createdAt: 1,
    lastActivityAt: 1,
  };
}

/** Sessions on a scripted host whose updates wait for `writes`. While `lag.held` is set, the host's rows wait for `release` after an answer, as a socket change that comes after the HTTP answer does. */
function fixture(chats: readonly SessionInfo[] = [chat("one"), chat("two"), chat("three")]) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const saved = new Map(chats.map((session) => [session.id, session]));
  const writes = Promise.withResolvers<void>();
  const failures = new Set<string>();
  const rows = { current: chats };
  const lag = { held: false, next: chats };
  const listeners = new Set<() => void>();

  const publish = (next: readonly SessionInfo[]): void => {
    lag.next = next;

    if (lag.held) return;
    rows.current = next;

    for (const listener of listeners) listener();
  };

  for (const session of chats) client.setQueryData(keys.session(session.id), session);

  const toasts = new ActionToasts();
  const { connection } = scriptedConnection({
    session: (id) => ({
      async update(patch) {
        await writes.promise;
        const session = saved.get(id);
        assert.ok(session);

        if (failures.has(id) || (patch.name !== undefined && failures.has(patch.name ?? "")))
          throw new Error("Disk unavailable");
        const next = {
          ...session,
          ...(patch.archived === undefined ? {} : { archived: patch.archived }),
          ...(patch.pinned === undefined ? {} : { pinned: patch.pinned }),
          ...(patch.name === undefined ? {} : { name: patch.name }),
        };
        saved.set(id, next);
        publish(
          rows.current.map((row) =>
            row.id === id
              ? {
                  ...row,
                  name: next.name,
                  pinned: next.pinned,
                  archived: next.archived,
                  workspace: patch.workspace ?? row.workspace,
                }
              : row,
          ),
        );

        return { kind: "updated" };
      },
      async remove() {
        await writes.promise;

        if (failures.has(id)) throw new Error("Disk unavailable");
        saved.delete(id);
        publish(rows.current.filter((row) => row.id !== id));

        return { kind: "removed" };
      },
    }),
  });

  const actions = new SessionActions({
    toasts,
    client,
    findRow: () => undefined,
    hosted: {
      row: (id) => rows.current.find((row) => row.id === id),
      subscribe(listener) {
        listeners.add(listener);

        return () => listeners.delete(listener);
      },
    },
    sessions: () => connection,
  });
  const directory = () => rows.current.flatMap((row) => actions.projectSession(row) ?? []);

  const release = (): void => {
    lag.held = false;
    publish(lag.next);
  };

  return { client, saved, writes, failures, actions, directory, toasts, rows, lag, release };
}

const notifications = new Map<string, Parameters<typeof toast.add>[0] & { id: string }>();

function notification(title: string) {
  const notice = notifications.values().find((item) => item.title === title);
  assert.ok(notice !== undefined, `Missing notification: ${title}`);

  return notice;
}

function undo(title: string, toasts: ActionToasts): void {
  const notice = notification(title);
  assert.ok(notice.actionProps);
  toasts.undo(notice.id);
}

beforeEach(() => {
  notifications.clear();
  const add = toast.add.bind(toast);
  vi.spyOn(toast, "add").mockImplementation((options) => {
    const id = add(options);
    notifications.set(id, { ...options, id });

    return id;
  });
  vi.spyOn(toast, "close").mockImplementation((id) => {
    const closing = [...notifications.values()].filter(
      (notice) => id === undefined || notice.id === id,
    );

    for (const notice of closing) {
      notifications.delete(notice.id);
      notice.onClose?.();
    }
  });
});

afterEach(() => vi.restoreAllMocks());

test("consecutive archives paint immediately and share one Undo notification", async () => {
  const f = fixture();

  for (const id of ["one", "two", "three"]) f.actions.archive([asId<"session">(id)], true);
  assert.ok(f.directory().every((session) => session.archived));
  assert.ok([...f.saved.values()].every((session) => !session.archived));
  assert.equal(notifications.size, 1);
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

test("a new directory row cannot erase an archive, and success updates the cached row", async () => {
  const f = fixture();
  const id = asId<"session">("one");
  f.actions.archive([id], true);
  f.rows.current = [{ ...chat("one"), lastActivityAt: 99 }, chat("two")];
  assert.equal(f.directory()[0]?.archived, true);
  assert.equal(f.directory()[0]?.lastActivityAt, 99);
  f.writes.resolve();
  await vi.waitFor(() =>
    assert.equal(f.client.getQueryData<SessionInfo>(keys.session(id))?.archived, true),
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
  f.actions.archive(
    [asId<"session">("one"), asId<"session">("two"), asId<"session">("three")],
    true,
  );
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

test("a newer restore replaces the older archive's Undo action", async () => {
  const f = fixture();
  f.actions.archive([asId<"session">("one")], true);
  const old = notification("1 chat archived");
  f.actions.archive([asId<"session">("one")], false);
  assert.equal(notifications.size, 1);
  notification("1 chat restored");
  old.onClose?.();
  assert.equal(f.directory()[0]?.archived, false);
  f.writes.resolve();
  await vi.waitFor(() => assert.equal(f.actions.getSnapshot().length, 0));
  undo("1 chat restored", f.toasts);
  assert.equal(f.directory()[0]?.archived, true);
  await vi.waitFor(() => assert.equal(f.saved.get(asId<"session">("one"))?.archived, true));
  f.client.clear();
});

test("rename rollback preserves a later rename, pin, and refreshed activity", async () => {
  const f = fixture();
  const id = asId<"session">("one");
  f.failures.add("rejected");
  const failed = f.actions.rename({ sessionId: id, name: "rejected" });
  const renamed = f.actions.rename({ sessionId: id, name: "kept" });
  f.actions.pin({ sessionId: id, pinned: true });
  f.rows.current = [{ ...chat("one"), lastActivityAt: 42 }];
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
  f.actions.delete(asId<"session">("one"), () => {
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
  notice.onClose?.();
  await Promise.resolve();
  assert.equal(open, true);
  assert.equal(f.directory().length, 3);
  assert.equal(f.saved.size, 3);
  f.client.clear();
});

test("delete commits when the notification closes", async () => {
  const f = fixture();
  f.writes.resolve();
  f.actions.delete(asId<"session">("one"), () => () => {});
  f.actions.delete(asId<"session">("two"), () => () => {});
  assert.equal(f.saved.size, 3);
  const notice = notification("2 chats deleted");
  toast.close(notice.id);
  notice.onClose?.();
  await vi.waitFor(() => assert.equal(f.saved.size, 1));
  assert.deepEqual(
    f.directory().map((session) => session.id),
    [asId<"session">("three")],
  );
  assert.equal(f.client.getQueryData(keys.session(asId<"session">("one"))), undefined);
  f.client.clear();
});

test("failed permanent deletion restores the chat and its pane", async () => {
  const f = fixture();
  let open = true;
  f.failures.add("one");
  f.actions.delete(asId<"session">("one"), () => {
    open = false;

    return () => {
      open = true;
    };
  });
  const notice = notification("1 chat deleted");
  notice.onClose?.();
  f.writes.resolve();
  await vi.waitFor(() => assert.equal(open, true));
  assert.equal(f.directory().length, 3);
  notification("Couldn't delete this chat. Try again.");
  f.client.clear();
});

test("undoing the delete of a chat being archived leaves it archived with no archive notification", async () => {
  const f = fixture();
  const id = asId<"session">("one");
  let open = true;
  f.actions.archive([id], true);
  notification("1 chat archived");
  f.actions.delete(id, () => {
    open = false;

    return () => {
      open = true;
    };
  });
  undo("1 chat deleted", f.toasts);
  assert.equal(open, true);
  assert.equal(f.directory()[0]?.archived, true);
  assert.deepEqual(
    [...notifications.values()].map((notice) => notice.title),
    [],
  );
  f.writes.resolve();
  await vi.waitFor(() => {
    assert.equal(f.saved.get(id)?.archived, true);
    assert.equal(f.actions.getSnapshot().length, 0);
  });
  assert.equal(f.directory()[0]?.archived, true);
  f.client.clear();
});

test.each<{
  readonly name: string;
  readonly row: SessionInfo | undefined;
  readonly change: Parameters<typeof reflects>[1];
  readonly reflects: boolean;
}>([
  {
    name: "an archived row shows an archive",
    row: { ...chat("one"), archived: true },
    change: { kind: "archive", archived: true },
    reflects: true,
  },
  {
    name: "a row not yet archived does not",
    row: chat("one"),
    change: { kind: "archive", archived: true },
    reflects: false,
  },
  {
    name: "a pinned row shows a pin",
    row: { ...chat("one"), pinned: true },
    change: { kind: "pin", pinned: true },
    reflects: true,
  },
  {
    name: "a row with the old name does not show a rename",
    row: chat("one"),
    change: { kind: "rename", name: "two" },
    reflects: false,
  },
  {
    name: "a row with the new name shows a rename",
    row: chat("one"),
    change: { kind: "rename", name: "one" },
    reflects: true,
  },
  {
    name: "a row still there does not show a delete",
    row: chat("one"),
    change: { kind: "delete" },
    reflects: false,
  },
  { name: "no row shows a delete", row: undefined, change: { kind: "delete" }, reflects: true },
  {
    name: "no row left shows nothing older than a rename",
    row: undefined,
    change: { kind: "rename", name: "two" },
    reflects: true,
  },
])("reflects: $name", (row) => {
  assert.equal(reflects(row.row, row.change), row.reflects);
});

test.each<{
  readonly name: string;
  readonly fails: boolean;
  /** Renames back to the old name once the first rename is answered. */
  readonly back?: true;
  /** Ms waited after the answer before the host's row arrives; null when it never does. */
  readonly rowAfter: number | null;
  readonly afterAnswer: { readonly name: string; readonly pending: number };
  readonly settled: { readonly name: string; readonly pending: number };
}>([
  {
    name: "a rename stays shown between the answer and the row that shows it",
    fails: false,
    rowAfter: 500,
    afterAnswer: { name: "renamed", pending: 1 },
    settled: { name: "renamed", pending: 0 },
  },
  {
    name: "a rename whose row never comes drops after 2 s",
    fails: false,
    rowAfter: null,
    afterAnswer: { name: "renamed", pending: 1 },
    settled: { name: "one", pending: 0 },
  },
  {
    name: "a rename the host refuses drops at the answer",
    fails: true,
    rowAfter: null,
    afterAnswer: { name: "one", pending: 0 },
    settled: { name: "one", pending: 0 },
  },
  {
    name: "a rename back to the old name is not undone by the rename before it",
    fails: false,
    back: true,
    rowAfter: 500,
    afterAnswer: { name: "one", pending: 0 },
    settled: { name: "one", pending: 0 },
  },
])("between the answer and the row: $name", async (row) => {
  vi.useFakeTimers();
  const f = fixture();
  const id = asId<"session">("one");
  f.lag.held = true;

  if (row.fails) f.failures.add("renamed");
  f.writes.resolve();
  await f.actions.rename({ sessionId: id, name: "renamed" });

  if (row.back === true) await f.actions.rename({ sessionId: id, name: "one" });

  const afterAnswer = {
    name: f.directory()[0]?.name,
    pending: f.actions.getSnapshot().length,
  };

  if (row.rowAfter !== null) {
    await vi.advanceTimersByTimeAsync(row.rowAfter);
    f.release();
  }

  await vi.advanceTimersByTimeAsync(2_000);

  assert.deepEqual(
    {
      afterAnswer,
      settled: { name: f.directory()[0]?.name, pending: f.actions.getSnapshot().length },
    },
    { afterAnswer: row.afterAnswer, settled: row.settled },
  );
  vi.useRealTimers();
  f.client.clear();
});
