/** Heads as refs and stacks as a parent plus a base. */
import assert from "node:assert/strict";
import { test } from "vitest";
import { headRef, runRef, stackRef } from "../../src/kernel/names.ts";
import { submit } from "../../src/kernel/queue.ts";
import {
  advanceBase,
  createHead,
  deleteHead,
  fastForward,
  listHeads,
  moveHead,
  stackStatus,
} from "../../src/kernel/stacks.ts";
import { assistant, lease, message, openSession, seedHead, user } from "./helpers.ts";

test("a head exists once something names it, and a head cut from it remembers where it was cut", async () => {
  const session = await openSession();
  assert.deepEqual(await listHeads(session), []);
  // A parent is a name; cutting from one that has no tip yet records no base.
  assert.deepEqual(await createHead(session, { head: "early", from: { head: "main" } }), {
    kind: "created",
    tip: null,
  });
  assert.deepEqual(await listHeads(session), [
    { head: "early", tip: null, stack: { kind: "stack", parent: "main", base: null } },
  ]);

  const [a, b] = await seedHead(session, "main", [message(user("a")), message(assistant("b"))]);
  assert.deepEqual(await createHead(session, { head: "review", from: { head: "main" } }), {
    kind: "created",
    tip: b,
  });
  assert.deepEqual(await listHeads(session), [
    { head: "early", tip: null, stack: { kind: "stack", parent: "main", base: null } },
    { head: "main", tip: b },
    { head: "review", tip: b, stack: { kind: "stack", parent: "main", base: b } },
  ]);
  assert.deepEqual(await createHead(session, { head: "review", from: { head: "main" } }), {
    kind: "exists",
  });
  assert.deepEqual(await createHead(session, { head: "old", from: { commit: a ?? "" } }), {
    kind: "created",
    tip: a,
  });
  assert.equal((await listHeads(session)).find((head) => head.head === "old")?.stack, undefined);
});

test("a head moves to any commit, and only from where the caller believes it is", async () => {
  const session = await openSession();
  const [a, b] = await seedHead(session, "main", [message(user("a")), message(assistant("b"))]);
  assert.deepEqual(await moveHead(session, { head: "main", to: a ?? "", expect: null }), {
    kind: "moved_since",
    tip: b,
  });
  assert.equal(await session.refs.read(headRef("main")), b);
  assert.deepEqual(await moveHead(session, { head: "main", to: a ?? "", expect: b }), {
    kind: "moved",
    from: b,
  });
  assert.equal(await session.refs.read(headRef("main")), a);
  assert.deepEqual(await moveHead(session, { head: "main", to: "0".repeat(64) }), {
    kind: "not_found",
  });
  assert.deepEqual(await moveHead(session, { head: "main", to: null }), { kind: "moved", from: a });
  assert.equal(await session.refs.read(headRef("main")), null);

  // A head is a name: pointing an unborn one at a commit is what creates it.
  assert.deepEqual(await moveHead(session, { head: "fresh", to: b ?? "", expect: null }), {
    kind: "moved",
    from: null,
  });
  assert.deepEqual(await listHeads(session), [{ head: "fresh", tip: b }]);
});

test("deleting a head drops everything it owns unless a runner holds it", async () => {
  const session = await openSession();
  const [tip] = await seedHead(session, "main", [message(user("a"))]);
  await createHead(session, { head: "review", from: { head: "main" } });
  await submit(session, {
    preparation: { kind: "none" },
    head: "review",
    delivery: "steer",
    kind: "user",
    body: message(user("queued")),
  });
  await session.refs.update([{ name: runRef("review"), from: null, to: tip ?? "" }], {
    reason: "test",
  });

  const held = await lease(session, "review");
  assert.deepEqual(await deleteHead(session, { head: "review" }), { kind: "busy" });
  await session.leases.release(held);

  assert.deepEqual(await deleteHead(session, { head: "review" }), { kind: "deleted" });
  assert.deepEqual(await listHeads(session), [{ head: "main", tip }]);
  assert.deepEqual(
    (await session.refs.list("")).map((ref) => ref.name).filter((name) => name.includes("review")),
    [],
  );
  assert.deepEqual(await deleteHead(session, { head: "review" }), { kind: "not_found" });
  assert.equal(await session.refs.read(stackRef("review")), null);

  // No head is privileged here; which one a client must keep is the client's rule.
  assert.deepEqual(await deleteHead(session, { head: "main" }), { kind: "deleted" });
  assert.deepEqual(await listHeads(session), []);
});

test("a stack is stale exactly when its parent moved on, and heals when the parent only advanced", async () => {
  const session = await openSession();
  const [base] = await seedHead(session, "main", [message(user("a"))]);
  await createHead(session, { head: "review", from: { head: "main" } });
  assert.deepEqual(await stackStatus(session, "review"), {
    kind: "current",
    base,
    parentTip: base,
  });
  assert.deepEqual(await stackStatus(session, "main"), { kind: "no_stack" });

  const [advanced] = await seedHead(session, "main", [message(assistant("b"))]);
  assert.deepEqual(await stackStatus(session, "review"), {
    kind: "stale",
    base,
    parentTip: advanced,
  });
  assert.deepEqual(await advanceBase(session, { head: "review" }), { kind: "advanced" });
  assert.deepEqual(await stackStatus(session, "review"), {
    kind: "current",
    base: advanced,
    parentTip: advanced,
  });
  assert.deepEqual(await advanceBase(session, { head: "review" }), { kind: "unchanged" });

  await moveHead(session, { head: "main", to: base ?? "" });
  const [elsewhere] = await seedHead(session, "main", [message(assistant("c"))]);
  assert.notEqual(elsewhere, advanced);
  assert.deepEqual(await advanceBase(session, { head: "review" }), { kind: "diverged" });
  assert.equal((await stackStatus(session, "review")).kind, "stale");
});

test("a current child fast-forwards its parent in one step; a stale one is refused", async () => {
  const session = await openSession();
  await seedHead(session, "main", [message(user("a"))]);
  await createHead(session, { head: "review", from: { head: "main" } });
  assert.deepEqual(await fastForward(session, { head: "review" }), { kind: "empty" });
  assert.deepEqual(await fastForward(session, { head: "main" }), { kind: "no_stack" });

  const [, childTip] = await seedHead(session, "review", [
    message(user("work")),
    message(assistant("done")),
  ]);
  const before = await session.events.last();
  assert.deepEqual(await fastForward(session, { head: "review" }), {
    kind: "merged",
    tip: childTip,
  });
  assert.equal(await session.refs.read(headRef("main")), childTip);
  assert.deepEqual(await stackStatus(session, "review"), {
    kind: "current",
    base: childTip,
    parentTip: childTip,
  });
  // The merge moves the parent head and the child's stack base, nothing else.
  const moved = (await session.events.read({ afterSeq: before })).flatMap((event) =>
    event.kind === "ref" ? [[event.name, event.to]] : [],
  );
  assert.ok(moved.some(([name, to]) => name === headRef("main") && to === childTip));
  assert.deepEqual(
    new Set(moved.map(([name]) => name)),
    new Set([headRef("main"), stackRef("review")]),
  );

  await seedHead(session, "main", [message(user("moved on"))]);
  await seedHead(session, "review", [message(user("more"))]);
  const parentTip = await session.refs.read(headRef("main"));
  assert.deepEqual(await fastForward(session, { head: "review" }), { kind: "stale" });
  assert.equal(await session.refs.read(headRef("main")), parentTip);
});
