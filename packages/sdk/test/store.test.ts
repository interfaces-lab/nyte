import type { SessionView } from "@nyte-ai/schema";
import type { Head } from "@nyte-ai/core";
import { afterEach, describe, expect, it } from "vitest";
import { answer, client, closeOpened, open, settledChat, text, users } from "./connection.ts";

afterEach(closeOpened);

/** Resolves with the first view `head` holds that `accept` takes, read through its store. */
function viewWhere(head: Head, accept: (view: SessionView) => boolean): Promise<SessionView> {
  return new Promise((resolve) => {
    const check = () => {
      const view = head.current();

      if (view === undefined || !accept(view)) return;
      unsubscribe();
      resolve(view);
    };

    const unsubscribe = head.subscribe(check);

    check();
  });
}

describe("a remote head as a store", () => {
  it("delivers the host's views to subscribers, including messages it sends", async () => {
    const host = await open();
    const connection = await client(host);
    const session = await settledChat(host, connection);
    let calls = 0;
    const unsubscribe = session.subscribe(() => (calls += 1));

    await viewWhere(session, (view) => answer(view) === "Ready.");

    host.fake.reply(text("Again."));
    await (await session.send("More.")).settled();

    const latest = await viewWhere(
      session,
      (view) => users(view).includes("More.") && view.execution.kind === "idle",
    );

    unsubscribe();

    expect(calls).toBeGreaterThan(1);
    expect(users(latest)).toEqual(["Hi.", "More."]);
  });
});
