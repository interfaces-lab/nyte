/** What the collector keeps: everything a ref or a recent reflog line can still name. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { openEffect, settleEffect } from "../../src/kernel/effects.ts";
import { collect, trimStream } from "../../src/kernel/gc.ts";
import { headRef } from "../../src/kernel/names.ts";
import { submit } from "../../src/kernel/queue.ts";
import { createHead } from "../../src/kernel/stacks.ts";
import type { Session } from "../../src/kernel/store.ts";
import {
  assistant,
  chain,
  lease,
  message,
  openSession,
  seedHead,
  toolResult,
  user,
} from "./helpers.ts";

const GRACE = 60_000;
/** Objects are stamped with the clock; the collector's `now` must move past them. */
const NOW = Date.now();

async function present(session: Session, oid: string | undefined): Promise<boolean> {
  return (await session.objects.get(oid ?? "")) !== undefined;
}

test("a loose object outlives the grace period, then goes; a referenced one stays", async () => {
  const session = await openSession();
  const [kept] = await seedHead(session, "main", [message(user("kept"))]);
  const [loose] = await chain(session, null, [message(user("loose"))]);

  const early = await collect(session, { graceMs: GRACE, now: NOW });
  assert.equal(early.swept, 0);
  assert.equal(await present(session, loose), true);

  const late = await collect(session, { graceMs: GRACE, now: NOW + 10 * GRACE });
  assert.equal(late.swept, 1);
  assert.equal(await present(session, loose), false);
  assert.equal(await present(session, kept), true);
});

test("a commit a head moved away from survives while the reflog can still name it", async () => {
  const session = await openSession();
  const [a, b] = await seedHead(session, "main", [message(user("a")), message(assistant("b"))]);
  await session.refs.update([{ name: headRef("main"), from: b ?? "", to: a ?? "" }], {
    reason: "move",
  });
  const later = NOW + 10 * GRACE;
  await collect(session, { graceMs: GRACE, now: later });
  assert.equal(await present(session, b), true);

  await trimStream(session, { keepAfterSeq: await session.events.last() });
  await collect(session, { graceMs: GRACE, now: later });
  assert.equal(await present(session, b), false);
  assert.equal(await present(session, a), true);
});

test("every object a ref can reach through the graph is kept", async () => {
  const session = await openSession();
  const [, tip] = await seedHead(session, "main", [message(user("a")), message(assistant("b"))]);
  await createHead(session, { head: "review", from: { head: "main" } });
  const queued = await submit(session, {
    preparation: { kind: "none" },
    head: "main",
    delivery: "steer",
    kind: "user",
    body: message(user("pending")),
  });
  const held = await lease(session, "main");
  const opened = await openEffect(session, {
    lease: held,
    runId: "run_1",
    callId: "c1",
    tool: "read",
    args: {},
    replay: "never",
  });
  assert.ok(opened.kind === "opened");
  await settleEffect(session, {
    lease: held,
    view: opened.view,
    result: toolResult("c1", "read", "x"),
  });
  await trimStream(session, { keepAfterSeq: await session.events.last() });

  const outcome = await collect(session, { graceMs: GRACE, now: NOW + 10 * GRACE });
  assert.equal(outcome.swept, 0);
  assert.equal(await present(session, tip), true);
  assert.equal(await present(session, queued.change), true);
  assert.equal(await present(session, opened.view.oid), true);

  const again = await collect(session, { graceMs: GRACE, now: NOW + 10 * GRACE });
  assert.equal(again.swept, 0);
  assert.equal(again.reachable, outcome.reachable);
});
