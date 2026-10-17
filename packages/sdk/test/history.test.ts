import type { SessionView } from "@nyte-ai/schema";
import { afterEach, assert, expect, it } from "vitest";
import { connect } from "../src/connect.ts";
import { pagedViews } from "../src/history.ts";
import { createSendJournal } from "../src/journal.ts";
import { BASE, TOKEN_SECRET, served } from "./served.ts";

const cleanups: (() => Promise<void>)[] = [];

afterEach(async () => {
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
});

function users(view: SessionView) {
  return view.messages.flatMap((message) => (message.kind === "user" ? [message.content] : []));
}

it("pages a head's older messages and their turns into its views and keeps them while new ones slide the window", async () => {
  const host = await served();
  cleanups.push(() => host.close());

  const connection = await connect({
    url: BASE,
    credentials: { kind: "token", token: TOKEN_SECRET },
    fetch: host.fetch,
    journal: createSendJournal(),
  });

  cleanups.push(() => connection.close());
  host.fake.reply(
    ...["One.", "Two.", "Three.", "Four."].map((text) => ({
      content: [{ type: "text" as const, text }],
    })),
  );
  const { session, receipt } = await connection.sessions.start({ content: "First." });
  await receipt.settled();

  for (const text of ["Second.", "Third."])
    await (await session.send(text, { delivery: "queue" })).settled();

  const views = pagedViews(session, { tail: 2 });
  const iterator = views[Symbol.asyncIterator]();

  const next = async (done: (view: SessionView) => boolean): Promise<SessionView> => {
    for (;;) {
      const step = await iterator.next();
      assert(step.done !== true);

      if (done(step.value)) return step.value;
    }
  };

  try {
    expect(users(await next(() => true))).toEqual(["Third."]);
    expect(await views.earlier(3)).toBe(3);
    expect(users(await next((view) => view.messages.length === 5))).toEqual(["Second.", "Third."]);
    expect(await views.earlier(10)).toBe(1);
    expect(users(await next((view) => view.messages.length === 6))).toEqual([
      "First.",
      "Second.",
      "Third.",
    ]);
    expect(await views.earlier(10)).toBe(0);

    await (await session.send("Fourth.", { delivery: "queue" })).settled();

    const slid = await next(
      (view) => users(view).includes("Fourth.") && view.messages.length === 8,
    );

    expect(users(slid)).toEqual(["First.", "Second.", "Third.", "Fourth."]);
    expect(slid.turns.map((turn) => turn.prompt)).toEqual(
      slid.messages.flatMap((message) => (message.kind === "user" ? [message.id] : [])),
    );
  } finally {
    await iterator.return?.();
  }
});
