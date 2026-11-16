import { asId } from "@nyte-ai/schema";
import type { SessionView } from "@nyte-ai/schema";
import type { Session } from "@nyte-ai/core";
import { afterEach, assert, describe, expect, it, vi } from "vitest";
import { createSendJournal } from "../src/send/journal.ts";
import type { JournalStorage } from "../src/send/journal.ts";
import { readOperation } from "./served.ts";
import type { Served } from "./served.ts";
import {
  client,
  closeOpened,
  heldChat,
  liveClient,
  open,
  settledChat,
  text,
  users,
  viewWhen,
} from "./connection.ts";

afterEach(closeOpened);

interface Quit {
  readonly host: Served;
  readonly storage: JournalStorage;
  readonly stored: Map<string, string>;
  readonly session: Session;
}

interface Restart {
  readonly name: string;
  readonly quit: (left: Quit) => Promise<void>;
  readonly windows: number;
  readonly elsewhere: boolean;
  readonly sends: number;
  readonly users: readonly string[];
  readonly shown: "landed" | "expired" | "refused" | null;
  readonly back?: true;
  readonly choice?: "remove" | "send again";
}

const restarts: readonly Restart[] = [
  {
    name: "a message typed while the host was down, then the client quit, lands once on the next start",
    quit: (left) => quitSending(left, "Typed offline.", "dropped"),
    windows: 1,
    elsewhere: false,
    sends: 1,
    users: ["Hi.", "Typed offline."],
    shown: "landed",
  },
  {
    name: "a message the host admitted before the quit, its answer lost, reconciles to one landed row",
    quit: (left) => quitSending(left, "Landed first.", "admitted"),
    windows: 1,
    elsewhere: false,
    sends: 1,
    users: ["Hi.", "Landed first."],
    shown: "landed",
  },
  {
    name: "two windows that load one entry send it once, and both drop it",
    quit: (left) => quitSending(left, "Typed offline.", "dropped"),
    windows: 2,
    elsewhere: false,
    sends: 2,
    users: ["Hi.", "Typed offline."],
    shown: "landed",
  },
  {
    name: "an entry older than a day that the host never saw stays unsent, is not sent, and is removed on request",
    quit: async (left) => {
      await quitSending(left, "Stale.", "dropped");
      await age(left.storage);
    },
    windows: 1,
    elsewhere: false,
    sends: 0,
    users: ["Hi."],
    shown: "expired",
    choice: "remove",
  },
  {
    name: "an entry older than a day that the host never saw lands once when sent again",
    quit: async (left) => {
      await quitSending(left, "Stale.", "dropped");
      await age(left.storage);
    },
    windows: 1,
    elsewhere: false,
    sends: 0,
    users: ["Hi."],
    shown: "expired",
    choice: "send again",
  },
  {
    name: "an entry older than a day that the host already admitted reconciles to its landed row",
    quit: async (left) => {
      await quitSending(left, "Stale, but landed.", "admitted");
      await age(left.storage);
    },
    windows: 1,
    elsewhere: false,
    sends: 1,
    users: ["Hi.", "Stale, but landed."],
    shown: "landed",
  },
  {
    name: "a client of another host over the same storage never sends it, and keeps it",
    quit: (left) => quitSending(left, "For the first host.", "dropped"),
    windows: 1,
    elsewhere: true,
    sends: 0,
    users: ["Hi."],
    shown: null,
  },
  {
    name: "a message kept through a client of another host shows unsent on the next client of its own host, then lands once",
    quit: (left) => quitSending(left, "For the first host.", "dropped"),
    windows: 1,
    elsewhere: true,
    sends: 0,
    users: ["Hi."],
    shown: null,
    back: true,
  },
  {
    name: "an entry the host refuses on the next start is listed refused with its content until taken, and leaves the storage",
    quit: async (left) => {
      await quitSending(left, "Refused on replay.", "dropped");
      await strand(left.storage);
    },
    windows: 1,
    elsewhere: false,
    sends: 1,
    users: ["Hi."],
    shown: "refused",
  },
];

describe("a send journal over storage that outlives the client", () => {
  for (const row of restarts) it(row.name, () => restart(row));
});

async function restart(row: Restart): Promise<void> {
  const host = await open();
  const session = await settledChat(host, await client(host));
  const stored = new Map<string, string>();

  const storage: JournalStorage = {
    read: () => [...stored],
    write: (key, value) => void stored.set(key, value),
    remove: (key) => void stored.delete(key),
  };

  await row.quit({ host, storage, stored, session });
  expect(stored.size).toBe(1);
  const reached = row.elsewhere ? await open() : host;
  let posts = 0;

  reached.intercept((request, next) => {
    if (readOperation(request) === "head.send") posts += 1;

    return next(request);
  });

  const windows = await Promise.all(
    Array.from({ length: row.windows }, () => liveClient(reached, createSendJournal(storage))),
  );

  if (row.shown === null) await new Promise((resolve) => setTimeout(resolve, 300));
  const views: SessionView[] = [];
  const chats = windows.map((window) => heldChat(window, session.id));

  for (const window of windows) {
    if (row.shown !== "refused") break;

    await vi.waitFor(() =>
      expect(
        window.refused.snapshot().map((send) => [send.session, send.content, send.error]),
      ).toEqual([["stranded", "Refused on replay.", expect.objectContaining({ code: "unknown" })]]),
    );

    const [refused] = window.refused.snapshot();
    assert(refused !== undefined);
    window.refused.take(refused.id);
    expect(window.refused.snapshot()).toEqual([]);
  }

  for (const [index, window] of windows.entries()) {
    if (row.shown === null || row.shown === "refused") break;
    const shown = row.shown;
    const chat = chats[index];
    assert(chat !== undefined);

    const settled = await viewWhen(
      () => window.session(session.id).view(),
      (view) => view.execution.kind === "idle" && drawn(view, chat.snapshot().expired) === shown,
    );

    views.push(settled);
    expect(
      [...settled.messages, ...settled.queue].filter((message) => message.kind === "user"),
    ).toHaveLength(row.users.length + (shown === "expired" ? 1 : 0));
  }

  expect(posts).toBe(row.sends);
  expect(users(await host.view(session.id))).toEqual(row.users);
  await expect
    .poll(() => stored.size)
    .toBe(row.shown === "landed" || row.shown === "refused" ? 0 : 1);

  if (row.back === true) await comeBack(host, storage, stored, session);

  if (row.shown !== "expired") return;
  const [window] = windows;
  const [chat] = chats;
  const [stale] = views;
  assert(window !== undefined && chat !== undefined && stale !== undefined);
  const [id] = chat.snapshot().expired;
  assert(id !== undefined);

  expect(stale.queue.find((message) => message.id === id)?.status).toEqual({
    kind: "unsent",
    attempts: 0,
    retrying: { at: expect.any(Number), reason: "it waited more than a day" },
  });

  if (row.choice === "remove") {
    await chat.remove(id);
    expect(stored.size).toBe(0);
    await vi.waitFor(() => expect(chat.snapshot().expired).toEqual([]));
    expect(drawn(await window.session(session.id).view(), [])).toBe("landed");
    expect(posts).toBe(0);

    return;
  }

  await chat.resend(id);

  await viewWhen(
    () => window.session(session.id).view(),
    (view) => view.execution.kind === "idle" && drawn(view, chat.snapshot().expired) === "landed",
  );

  expect(posts).toBe(1);
  expect(users(await host.view(session.id))).toEqual([...row.users, "Stale."]);
  await expect.poll(() => stored.size).toBe(0);
}

async function quitSending(
  left: Quit,
  content: string,
  fate: "admitted" | "dropped",
): Promise<void> {
  const reached = Promise.withResolvers<void>();
  left.host.fake.reply(text("Answered."));

  left.host.intercept(async (request, next) => {
    if (readOperation(request) !== "head.send") return next(request);

    if (fate === "admitted") await next(request);
    reached.resolve();

    throw new TypeError("fetch failed");
  });

  const leaving = await client(left.host, createSendJournal(left.storage));
  const sending = leaving.session(left.session.id).send(content);
  await reached.promise;
  await leaving.close();
  await expect(sending).rejects.toMatchObject({ code: "unavailable" });
  left.host.intercept(null);
}

async function comeBack(
  host: Served,
  storage: JournalStorage,
  stored: ReadonlyMap<string, string>,
  session: Session,
): Promise<void> {
  const posting = Promise.withResolvers<void>();
  let posts = 0;

  host.intercept(async (request, next) => {
    if (readOperation(request) !== "head.send") return next(request);
    posts += 1;
    await posting.promise;

    return next(request);
  });

  const home = await liveClient(host, createSendJournal(storage));
  const chat = heldChat(home, session.id);

  await vi.waitFor(() =>
    expect(
      [...(chat.snapshot().view?.messages ?? []), ...(chat.snapshot().view?.queue ?? [])]
        .flatMap((message) =>
          message.kind === "user" ? [[message.content, message.status.kind]] : [],
        )
        .at(-1),
    ).toEqual(["For the first host.", "unsent"]),
  );
  posting.resolve();

  await viewWhen(
    () => home.session(session.id).view(),
    (view) => view.execution.kind === "idle" && drawn(view, []) === "landed",
  );

  expect(posts).toBe(1);
  expect(users(await host.view(session.id))).toEqual(["Hi.", "For the first host."]);
  await expect.poll(() => stored.size).toBe(0);
}

async function strand(storage: JournalStorage): Promise<void> {
  const journal = createSendJournal(storage);

  for (const entry of await journal.load())
    await journal.put({ ...entry, session: asId<"session">("stranded") });
}

async function age(storage: JournalStorage): Promise<void> {
  const journal = createSendJournal(storage);

  for (const entry of await journal.load())
    await journal.put({ ...entry, at: entry.at - 24 * 60 * 60 * 1000 - 1 });
}

function drawn(view: SessionView, expired: readonly string[]): "landed" | "expired" | null {
  const last = [...view.messages, ...view.queue].findLast((message) => message.kind === "user");

  if (last?.kind !== "user") return null;

  if (last.status.kind === "landed") return "landed";

  return last.status.kind === "unsent" && expired.includes(last.id) ? "expired" : null;
}
