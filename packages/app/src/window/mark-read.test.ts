import { expect, test, vi } from "vitest";
import { asId } from "@nyte-ai/schema";
import { toast } from "@nyte-ai/ui/toast";
import { chatDirectory, subscribeChats } from "../chats/index.ts";
import { installConnection } from "../data/connection.ts";
import { scriptedConnection } from "../../test/scripted-connection.ts";
import { sessionRow } from "../../test/view-fixtures.ts";
import { chatWindow } from "./index.ts";

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
  installConnection(
    scriptedConnection({
      sessions: [unread],
      session: () => ({
        see: async () => {
          throw new Error("Disk unavailable");
        },
      }),
    }).connection,
  );
  const leave = subscribeChats(() => undefined);
  await vi.waitFor(() =>
    expect(chatDirectory().get(unread.id)?.unreadTip).toEqual({ head: "main", commit: "reply" }),
  );
  const shown: unknown[] = [];

  const unsubscribe = toast[" subscribe"]((event) => {
    if (event.action === "add") shown.push(event.options);
  });

  chatWindow.markRead([unread.id]);
  await vi.waitFor(() => expect(shown).toHaveLength(1));
  expect(shown[0]).toMatchObject({
    type: "error",
    title: "Couldn't mark this chat as read. Try again.",
  });

  unsubscribe();
  leave();
});
