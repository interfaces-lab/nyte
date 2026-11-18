import { expect, test, vi } from "vitest";
import { asId } from "@nyte-ai/schema";
import { toast } from "@nyte-ai/ui/toast";
import { chatDirectory, subscribeChats } from "../chats/index.ts";
import { installScripted, scriptedConnection } from "../../test/scripted-connection.ts";
import { chatsFor, sessionRow } from "../../test/view-fixtures.ts";
import { chatWindow } from "./index.ts";
import { toSee } from "./seen.ts";

const unread = sessionRow("unread", {
  heads: [
    {
      name: asId<"head">("main"),
      tip: { kind: "commit", id: asId<"commit">("reply") },
      stack: null,
      execution: { kind: "idle", lastRun: null },
      unread: true,
      background: { working: 0, waiting: 0 },
    },
  ],
});

test("a chat that can't be marked read says so once, whoever marked it", async () => {
  installScripted(
    scriptedConnection({
      sessions: [unread],
      session: () => ({
        see: async () => {
          throw new Error("Disk unavailable");
        },
      }),
    }),
  );
  const leave = subscribeChats(() => undefined);
  await vi.waitFor(() =>
    expect(chatDirectory().get(unread.id)?.unreadTip).toEqual({ head: "main", commit: "reply" }),
  );
  const shown: unknown[] = [];
  const toasted = Promise.withResolvers<void>();

  const unsubscribe = toast[" subscribe"]((event) => {
    if (event.action !== "add") return;
    shown.push(event.options);
    toasted.resolve();
  });

  chatWindow.markRead([unread.id]);
  await toasted.promise;
  expect(shown).toEqual([
    expect.objectContaining({
      type: "error",
      title: "Couldn't mark this chat as read. Try again.",
    }),
  ]);

  unsubscribe();
  leave();
});

const looked = sessionRow("looked", {
  heads: [
    {
      name: asId<"head">("main"),
      tip: { kind: "commit", id: asId<"commit">("first") },
      stack: null,
      execution: { kind: "idle", lastRun: null },
      unread: true,
      background: { working: 0, waiting: 0 },
    },
  ],
});

const later = sessionRow("looked", {
  heads: [
    {
      name: asId<"head">("main"),
      tip: { kind: "commit", id: asId<"commit">("second") },
      stack: null,
      execution: { kind: "idle", lastRun: null },
      unread: true,
      background: { working: 0, waiting: 0 },
    },
  ],
});

test.each<{
  readonly name: string;
  readonly sent: readonly (readonly [string, string])[];
  readonly looking: boolean;
  readonly row: typeof looked | undefined;
  readonly ready: boolean;
  readonly see: readonly string[];
  readonly kept: readonly (readonly [string, string])[];
}>([
  {
    name: "a view not arrived yet",
    sent: [],
    looking: true,
    row: looked,
    ready: false,
    see: [],
    kept: [],
  },
  {
    name: "looked at and ready",
    sent: [],
    looking: true,
    row: looked,
    ready: true,
    see: ["looked"],
    kept: [["looked", "first"]],
  },
  {
    name: "the same tip again",
    sent: [["looked", "first"]],
    looking: true,
    row: looked,
    ready: true,
    see: [],
    kept: [["looked", "first"]],
  },
  {
    name: "a new tip",
    sent: [["looked", "first"]],
    looking: true,
    row: later,
    ready: true,
    see: ["looked"],
    kept: [["looked", "second"]],
  },
  {
    name: "looked away, so looking back sends again",
    sent: [["looked", "first"]],
    looking: false,
    row: looked,
    ready: true,
    see: [],
    kept: [],
  },
  {
    name: "a read chat",
    sent: [["looked", "first"]],
    looking: true,
    row: sessionRow("looked"),
    ready: true,
    see: [],
    kept: [],
  },
])("marking read: $name", (row) => {
  const chats = chatsFor(row.row === undefined ? [] : [row.row]);
  const id = asId<"session">("looked");

  const step = toSee(
    new Map(row.sent.map((entry) => [asId<"session">(entry[0]), asId<"commit">(entry[1])])),
    row.looking ? new Set([id]) : new Set(),
    chats,
    () => row.ready,
  );

  expect({ see: step.see, kept: [...step.sent] }).toEqual({ see: row.see, kept: row.kept });
});
