import { fakeModels, lastUserText, simulate, titleReply } from "@nyte-ai/bench";
import { expect, it, vi } from "vitest";
import { openHost } from "../src/host-connection.ts";

it("updates sidebar rows live: a chat another client starts appears, its title lands, and its next message moves it above an older chat", async () => {
  const fake = fakeModels({
    fallback: (request) => ({
      content: [{ type: "text", text: titleReply(request) ?? `Echo: ${lastUserText(request)}` }],
    }),
  });

  await using simulation = await simulate({ models: fake.models });
  const listening = await simulation.drive({ kind: "listen" });

  if (listening.kind !== "listening") throw new Error(`Expected listening, got ${listening.kind}.`);

  const sidebar = openHost(listening.url, {
    credentials: { kind: "token", token: listening.token },
    client: { kind: "other", name: "sidebar", version: "1" },
  });

  const rows = sidebar.directory({ parents: { kind: "roots" } });

  const listed = () => {
    const snapshot = rows.snapshot();

    return (snapshot?.ids ?? []).flatMap((id) => {
      const row = snapshot?.rows.get(id);

      return row === undefined ? [] : [row];
    });
  };

  try {
    await vi.waitFor(() => expect(rows.snapshot()?.ids).toEqual([]), { timeout: 5_000 });

    const older = await simulation.drive({ kind: "send", text: "older chat" });
    const newer = await simulation.drive({ kind: "send", text: "newer chat" });

    if (older.kind !== "sent" || newer.kind !== "sent") throw new Error("A chat did not start.");

    await vi.waitFor(
      () => expect(listed().map((row) => row.name)).toEqual(["newer chat", "older chat"]),
      { timeout: 5_000 },
    );

    await simulation.drive({ kind: "send", session: older.session, text: "bump" });

    await vi.waitFor(
      () => expect(listed().map((row) => row.id)).toEqual([older.session, newer.session]),
      { timeout: 5_000 },
    );

    const bumped = listed();

    expect(bumped[0]?.lastActivityAt).toBeGreaterThan(bumped[1]?.lastActivityAt ?? Infinity);
  } finally {
    rows.close();
    sidebar.release();
  }
});
