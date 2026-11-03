import assert from "node:assert/strict";
import { test } from "vitest";
import type { Message, SessionView } from "@nyte-ai/sdk";
import { asId, asSeq } from "@nyte-ai/schema";
import { chatStore, loadEarlierMessages } from "./chat-store.ts";
import { installScripted, scriptedConnection } from "../../test/scripted-connection.ts";
import { COMPLETED, USAGE } from "../../test/view-fixtures.ts";

function prompt(id: string): Message {
  return {
    id: asId<"message">(id),
    turn: asId<"turn">(id),
    at: 1,
    kind: "user",
    content: id,
    source: { kind: "user" },
    delivery: "steer",
    status: { kind: "landed", commit: asId<"commit">(id), run: null, replaced: null },
    siblings: { index: 0, count: 1, ids: [] },
  };
}

function view(messages: readonly Message[]): SessionView {
  return {
    revision: asId<"revision">("r1"),
    seq: asSeq(1),
    activation: { kind: "active" },
    messages,
    queue: [],
    leadingPrompt: null,
    parts: [],
    turns: [],
    usage: USAGE,
    execution: COMPLETED,
    reportsHeld: false,
    seenThrough: null,
    background: [],
    configuration: { selected: null, effective: null },
    context: { tokens: 0, window: 1_000, lastRequest: null },
    heads: [],
    changes: [],
    catalog: { commands: [], settings: [], skills: [], agents: [], tools: [] },
  };
}

test("a chat pages in earlier messages while it is watched, and none once nobody watches it", async () => {
  const session = asId<"session">("paged");

  installScripted(
    scriptedConnection({
      views: new Map([[session, [view([prompt("latest")])]]]),
      session: () => ({
        history: async () => ({ messages: [prompt("older")], leadingPrompt: null, turns: [] }),
      }),
    }),
  );

  const store = chatStore(session);
  const leave = store.subscribe(() => undefined);
  await store.first();
  const paged = store.next();

  assert.equal(await loadEarlierMessages(session, 10), 1);
  assert.deepEqual(
    (await paged).messages.map((message) => message.id),
    ["older", "latest"],
  );

  leave();
  await new Promise((resolve) => setTimeout(resolve, 0));

  assert.equal(await loadEarlierMessages(session, 10), 0);
});
