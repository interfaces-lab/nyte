import { fakeModels, lastUserText, simulate, titleReply } from "@nyte-ai/bench";
import type { SessionInfo } from "@nyte-ai/schema";
import { expect, it } from "vitest";
import { connect } from "../src/connect.ts";

it("updates sidebar rows live: a chat another client starts appears, its title lands, and its next message moves it above an older chat", async () => {
  const fake = fakeModels({
    fallback: (request) => ({
      content: [{ type: "text", text: titleReply(request) ?? `Echo: ${lastUserText(request)}` }],
    }),
  });

  await using simulation = await simulate({ models: fake.models });
  const listening = await simulation.drive({ kind: "listen" });

  if (listening.kind !== "listening") throw new Error(`Expected listening, got ${listening.kind}.`);

  await using sidebar = await connect({
    url: listening.url,
    credentials: { kind: "token", token: listening.token },
  });

  const rows = sidebar.sessions.watch({ parents: { kind: "roots" } })[Symbol.asyncIterator]();
  const names = (list: readonly SessionInfo[]) => list.map((row) => row.name);

  const until = async (done: (list: readonly SessionInfo[]) => boolean) => {
    for (;;) {
      const next = await rows.next();

      if (next.done === true) throw new Error("The sidebar's watch ended.");

      if (done(next.value)) return next.value;
    }
  };

  await until((list) => list.length === 0);

  const older = await simulation.drive({ kind: "send", text: "older chat" });
  const newer = await simulation.drive({ kind: "send", text: "newer chat" });

  if (older.kind !== "sent" || newer.kind !== "sent") throw new Error("A chat did not start.");

  expect(names(await until((list) => names(list).join() === "newer chat,older chat"))).toEqual([
    "newer chat",
    "older chat",
  ]);

  await simulation.drive({ kind: "send", session: older.session, text: "bump" });

  const bumped = await until((list) => list[0]?.id === older.session);

  expect(bumped.map((row) => row.id)).toEqual([older.session, newer.session]);
  expect(bumped[0]?.lastActivityAt).toBeGreaterThan(bumped[1]?.lastActivityAt ?? Infinity);
  await rows.return?.();
});
