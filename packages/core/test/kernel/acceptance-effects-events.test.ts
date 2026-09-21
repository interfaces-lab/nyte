import assert from "node:assert/strict";
import { test } from "vitest";
import { foldEvent, stateFromSnapshot, type SessionState } from "@nyte-ai/client";
import { CursorExpired } from "@nyte-ai/protocol";
import type { SessionEvent } from "@nyte-ai/protocol";
import { Type } from "typebox";
import { trimStream } from "../../src/kernel/gc.ts";
import { ToolWait } from "../../src/kernel/loop/types.ts";
import { headRef } from "../../src/kernel/names.ts";
import { definePlugin, inlinePlugin } from "../../src/plugins/index.ts";
import { driveToIdle, openAcceptanceNyte, scripted } from "./acceptance-helpers.ts";
import { assistant, call, openStore, sleep, storePath, within } from "./helpers.ts";

const emptyParameters = Type.Object({});

async function foldUntilSynced(
  initial: SessionState,
  events: AsyncIterable<SessionEvent>,
): Promise<SessionState> {
  let state = initial;
  for await (const event of events) {
    const outcome = foldEvent(state, event);
    assert.equal(outcome.kind, "state");
    if (outcome.kind !== "state") assert.fail("event fold requested a snapshot");
    state = outcome.state;
    if (event.kind === "synced") return state;
  }
  assert.fail("watch ended before synced");
}

test("A crash between effect intent and result follows safe or never replay", async () => {
  const path = storePath();
  const firstStore = openStore(path);
  const safeStarted = Promise.withResolvers<void>();
  const neverStarted = Promise.withResolvers<void>();
  const crash = Promise.withResolvers<void>();
  let safeExecutions = 0;
  let neverExecutions = 0;
  let responses = 0;
  const plugin = inlinePlugin(
    definePlugin({
      id: "replay-tools",
      session(api) {
        api.tools.add((draft) => {
          draft.set("safe-effect", {
            name: "safe-effect",
            description: "Safe replay test",
            parameters: emptyParameters,
            replay: "safe",
            execute: async () => {
              safeExecutions += 1;
              if (safeExecutions === 1) {
                safeStarted.resolve();
                await crash.promise;
              }
              return {
                content: [{ type: "text", text: `safe run ${String(safeExecutions)}` }],
                details: {},
              };
            },
          });
          draft.set("never-effect", {
            name: "never-effect",
            description: "Never replay test",
            parameters: emptyParameters,
            replay: "never",
            execute: async () => {
              neverExecutions += 1;
              if (neverExecutions === 1) {
                neverStarted.resolve();
                await crash.promise;
              }
              return {
                content: [{ type: "text", text: `never run ${String(neverExecutions)}` }],
                details: {},
              };
            },
          });
        });
      },
    }),
  );
  const provider = scripted(() => {
    responses += 1;
    return responses === 1
      ? assistant("", {
          calls: [call("safe-call", "safe-effect"), call("never-call", "never-effect")],
        })
      : assistant("recovered");
  });
  const first = await openAcceptanceNyte(firstStore, provider, { plugins: [plugin] });
  const { sessionId } = await first.sessions.create();
  await first.messages.send({ sessionId, content: "run effects" });
  await first.advance({ sessionId });
  await first.advance({ sessionId });
  const interrupted = first.advance({ sessionId });
  await within(Promise.all([safeStarted.promise, neverStarted.promise]).then(() => undefined));
  await firstStore.close();
  crash.resolve();
  await assert.rejects(interrupted);
  await first.close();

  const reopenedStore = openStore(path);
  const recoverySession = await reopenedStore.open(sessionId);
  const abandonedLease = await recoverySession.leases.read(headRef("main"));
  assert.ok(abandonedLease);
  assert.equal(await recoverySession.leases.renew(abandonedLease, 1), true);
  await sleep(5);
  assert.equal(await recoverySession.leases.read(headRef("main")), undefined);
  const reopened = await openAcceptanceNyte(reopenedStore, provider, { plugins: [plugin] });
  try {
    await driveToIdle(reopened, sessionId);
    assert.equal(safeExecutions, 2);
    assert.equal(neverExecutions, 1);
    const parts = (await reopened.messages.list({ sessionId })).flatMap((turn) =>
      turn.kind === "turn" ? turn.parts.filter((part) => part.kind === "tool") : [],
    );
    const safe = parts.find((part) => part.callId === "safe-call");
    const never = parts.find((part) => part.callId === "never-call");
    assert.equal(safe?.result?.output, "safe run 2");
    assert.equal(safe?.result?.isError, false);
    assert.equal(never?.result?.isError, true);
    assert.match(never?.result?.output ?? "", /interrupted/u);
  } finally {
    await reopened.close();
  }
});

test("A waiting effect survives its host and accepts only the first signal", async () => {
  let responses = 0;
  const asking = inlinePlugin(
    definePlugin({
      id: "asking",
      session(api) {
        api.tools.add((draft) =>
          draft.set("ask", {
            name: "ask",
            description: "Ask once",
            parameters: emptyParameters,
            execute: async () => {
              throw new ToolWait();
            },
            wake: async (_call, context) => ({
              kind: "settle",
              result: {
                content: [{ type: "text", text: `winner ${JSON.stringify(context.reply)}` }],
                details: {},
              },
            }),
          }),
        );
      },
    }),
  );
  const path = storePath();
  const firstStore = openStore(path);
  const provider = scripted(() => {
    responses += 1;
    return responses === 1
      ? assistant("", { calls: [call("ask-once", "ask")] })
      : assistant("done");
  });
  const first = await openAcceptanceNyte(firstStore, provider, { plugins: [asking] });
  const { sessionId } = await first.sessions.create();
  await first.messages.send({ sessionId, content: "ask" });
  await first.advance({ sessionId });
  await first.advance({ sessionId });
  assert.equal((await first.advance({ sessionId })).kind, "waiting");
  await first.close();
  await firstStore.close();

  const reopened = await openAcceptanceNyte(openStore(path), provider, { plugins: [asking] });
  try {
    const parked = (await reopened.sessions.snapshot({ sessionId }))?.parked?.[0];
    assert.ok(parked);
    const replies = await Promise.all(
      ["left", "right"].map((reply) =>
        reopened.runs.reply({
          sessionId,
          runId: parked.runId,
          callId: parked.callId,
          waitId: parked.waitId,
          reply,
        }),
      ),
    );
    assert.deepEqual(replies.map((reply) => reply.kind).sort(), ["not_waiting", "signalled"]);
    const winner = replies[0]?.kind === "signalled" ? "left" : "right";
    await driveToIdle(reopened, sessionId);
    const tool = (await reopened.messages.list({ sessionId })).flatMap((turn) =>
      turn.kind === "turn" ? turn.parts.filter((part) => part.kind === "tool") : [],
    )[0];
    assert.equal(tool?.result?.output, `winner ${JSON.stringify(winner)}`);
  } finally {
    await reopened.close();
  }
});

test("Two clients with independent cursors reconstruct the same event stream", async () => {
  const store = openStore();
  const nyte = await openAcceptanceNyte(store);
  try {
    const { sessionId } = await nyte.sessions.create();
    const earlySnapshot = await nyte.sessions.snapshot({ sessionId });
    assert.ok(earlySnapshot);

    await nyte.messages.send({ sessionId, content: "landed" });
    await driveToIdle(nyte, sessionId);
    const laterSnapshot = await nyte.sessions.snapshot({ sessionId });
    assert.ok(laterSnapshot);
    assert.ok(laterSnapshot.seq > earlySnapshot.seq);

    await nyte.messages.send({ sessionId, content: "pending" });
    const early = foldUntilSynced(
      stateFromSnapshot(earlySnapshot),
      nyte.watch({ sessionId, afterSeq: earlySnapshot.seq }),
    );
    const later = foldUntilSynced(
      stateFromSnapshot(laterSnapshot),
      nyte.watch({ sessionId, afterSeq: laterSnapshot.seq }),
    );
    const [earlyState, laterState] = await Promise.all([early, later]);
    assert.equal(earlyState.seq, laterState.seq);
    assert.deepEqual(earlyState.transcript, laterState.transcript);
    assert.deepEqual(earlyState.pending, laterState.pending);
    assert.deepEqual(
      earlyState.pending.map((item) => item.content),
      ["pending"],
    );
  } finally {
    await nyte.close();
  }
});

test("A cursor older than the floor is refused and takes a snapshot", async () => {
  const store = openStore();
  const nyte = await openAcceptanceNyte(store);
  try {
    const { sessionId } = await nyte.sessions.create();
    await nyte.messages.send({ sessionId, content: "retained" });
    await driveToIdle(nyte, sessionId);
    const session = await store.open(sessionId);
    const floor = await trimStream(session, { keepAfterSeq: await session.events.last() });
    assert.ok(floor > 0);
    const expired = nyte.watch({ sessionId, afterSeq: 0 })[Symbol.asyncIterator]();
    await assert.rejects(expired.next(), CursorExpired);

    const snapshot = await nyte.sessions.snapshot({ sessionId });
    assert.ok(snapshot);
    assert.ok(snapshot.seq >= floor);
    await nyte.messages.send({ sessionId, content: "after snapshot" });
    const folded = await foldUntilSynced(
      stateFromSnapshot(snapshot),
      nyte.watch({ sessionId, afterSeq: snapshot.seq }),
    );
    const current = await nyte.sessions.snapshot({ sessionId });
    assert.ok(current);
    assert.deepEqual(folded.transcript.items, current.transcript);
    assert.deepEqual(folded.pending, current.pending);
    assert.equal(folded.seq, current.seq);
  } finally {
    await nyte.close();
  }
});
