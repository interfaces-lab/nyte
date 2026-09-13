import assert from "node:assert/strict";
import { createNyteClient } from "@nyte-ai/client";
import { test, vi } from "vitest";
import { postgresFixture } from "../fixtures/postgres.ts";
import { createChatServer, type WakeSession } from "../src/chat.ts";
import type { openExecution } from "../src/runtime.ts";
import { runSession } from "../workflows/session.ts";

const { openSdk } = vi.hoisted(() => ({ openSdk: vi.fn<typeof openExecution>() }));
vi.mock("../src/runtime.ts", () => ({ openExecution: openSdk }));

test("a lost dispatch can be retried through the production execution loop and read from another PostgreSQL host", async (context) => {
  const fixture = await postgresFixture();
  context.onTestFinished(() => fixture.close());
  openSdk.mockImplementation(() => fixture.openSdk());
  const sdk = await fixture.openSdk();
  let dispatchAvailable = false;
  const queued: Parameters<WakeSession>[0][] = [];
  const token = "nyte-infrastructure-fixture-token";
  const server = createChatServer({
    sdk,
    token,
    async wake(input) {
      if (!dispatchAvailable) throw new Error("The dispatcher is temporarily unavailable");
      queued.push(input);
    },
  });
  context.onTestFinished(() => server.close());
  const client = createNyteClient({
    baseUrl: "http://fixture.test",
    token,
    fetch: (input, init) => server.fetch(new Request(input, init)),
  });
  const { sessionId } = await client.sessions.create();
  const message = { sessionId, content: "Persist this reply.", key: "one-admission" };
  await assert.rejects(client.messages.send(message), { code: "internal" });
  assert.equal((await client.sessions.snapshot({ sessionId }))?.pending.length, 1);
  dispatchAvailable = true;
  assert.equal((await client.messages.send(message)).kind, "duplicate");

  for (const input of queued) await runSession(input.sessionId, input.head ?? "main");
  await sdk.close();
  const reader = await fixture.openSdk();
  const saved = await reader.sessions.snapshot({ sessionId });
  assert.ok(saved);
  assert.equal(saved.run?.phase.kind, "done");
  assert.equal(saved.pending.length, 0);
  const parts = saved.transcript.flatMap((turn) => (turn.kind === "turn" ? turn.parts : []));
  assert.equal(parts.filter((part) => part.kind === "user").length, 1);
  assert.deepEqual(
    parts.flatMap((part) => (part.kind === "assistant" ? [part.text] : [])),
    ["Fixture reply: Persist this reply."],
  );
});

test("one workflow finishes the active run and drains its queued follow-up", async (context) => {
  const fixture = await postgresFixture();
  context.onTestFinished(() => fixture.close());
  openSdk.mockImplementation(() => fixture.openSdk());
  const sdk = await fixture.openSdk();
  const { sessionId } = await sdk.sessions.create();
  await sdk.messages.send({ sessionId, content: "First message" });
  await sdk.advance({ sessionId });
  assert.equal((await sdk.runs.current({ sessionId }))?.phase.kind, "respond");
  await sdk.messages.send({ sessionId, content: "Follow-up message" });

  await runSession(sessionId, "main");
  await sdk.close();

  const reader = await fixture.openSdk();
  const saved = await reader.sessions.snapshot({ sessionId });
  assert.ok(saved);
  assert.equal(saved.pending.length, 0);
  assert.equal(saved.run?.phase.kind, "done");
  assert.deepEqual(
    saved.transcript.flatMap((turn) =>
      turn.kind === "turn"
        ? turn.parts.flatMap((part) => (part.kind === "assistant" ? [part.text] : []))
        : [],
    ),
    ["Fixture reply: First message", "Fixture reply: Follow-up message"],
  );
});
