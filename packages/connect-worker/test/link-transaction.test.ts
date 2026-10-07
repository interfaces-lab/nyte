import {
  ErrorBody,
  LINK_AUTHORIZATION_LIFETIME_SECONDS,
  LINK_TRANSACTION_LIFETIME_SECONDS,
  LinkResponse,
  LinkTransactionCompletion,
  LinkTransactionLookup,
  LinkTransactionOpened,
  keyFingerprint,
} from "@nyte-ai/connect";
import { keyThumbprint } from "@nyte-ai/connect/signing";
import { Value } from "typebox/value";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { claimEnvironment } from "../src/store.ts";
import { createHarness, read } from "./harness.ts";
import type { FakeDesktop, Harness } from "./harness.ts";

let harness: Harness;

beforeAll(async () => {
  harness = await createHarness();
});

afterAll(async () => {
  await harness.dispose();
});

beforeEach(async () => {
  await harness.reset();
});

const code = (body: unknown) => (Value.Check(ErrorBody, body) ? body.error.code : undefined);

const state = (body: unknown) => read(body, "state");

const deleted = (id: string) => ({
  type: "user.deleted",
  object: "event",
  timestamp: Date.now(),
  instance_id: "ins_test",
  data: { object: "user", id, deleted: true },
});

/** The fake Clerk knows this owner, as a browser session implies. */
function knownOwner(userId: string): void {
  if (!harness.clerkApi.users.has(userId))
    harness.clerkApi.users.set(userId, {
      banned: false,
      locked: false,
      updated_at: 1,
      email: `${userId}@example.com`,
    });
}

/** A host opened a transaction and the owner looked its code up. */
async function opened(input: { readonly name?: string; readonly desktop?: FakeDesktop } = {}) {
  knownOwner("user_alice");
  const desktop = input.desktop ?? (await harness.newDesktop());
  const open = await harness.openTransaction({ desktop, name: input.name });

  expect(open.answer.status).toBe(201);

  if (!Value.Check(LinkTransactionOpened, open.answer.body)) throw new Error("not opened");
  const lookup = await harness.lookupTransaction({ userId: "user_alice", userCode: open.userCode });

  expect(lookup.status).toBe(200);

  if (!Value.Check(LinkTransactionLookup, lookup.body)) throw new Error("not looked up");

  return {
    desktop,
    transactionId: open.answer.body.transactionId,
    userCode: open.userCode,
    operationId: open.operationId,
    fingerprint: lookup.body.fingerprint,
    opened: open.answer.body,
  };
}

async function approved(input: { readonly name?: string; readonly desktop?: FakeDesktop } = {}) {
  const transaction = await opened(input);
  const approve = await harness.decideTransaction({
    userId: "user_alice",
    transactionId: transaction.transactionId,
    decision: "approve",
    fingerprint: transaction.fingerprint,
  });

  expect(approve.status).toBe(200);
  expect(state(approve.body)).toBe("approved");

  return transaction;
}

async function completed(
  desktop: FakeDesktop,
  transactionId: string,
): Promise<{ readonly status: number; readonly link: LinkResponse }> {
  const answer = await harness.transactionCall({ desktop, transactionId, step: "complete" });

  if (!Value.Check(LinkTransactionCompletion, answer.body) || answer.body.state !== "consumed")
    throw new Error(`not completed: ${answer.text}`);

  return { status: answer.status, link: answer.body.link };
}

describe("opening a link transaction", () => {
  it("answers the page, deadline and interval, and the same row for the same operation and code", async () => {
    const desktop = await harness.newDesktop();
    const first = await harness.openTransaction({ desktop });

    expect(first.answer.status).toBe(201);
    expect(Value.Check(LinkTransactionOpened, first.answer.body)).toBe(true);
    expect(read(first.answer.body, "verifyUrl")).toBe("https://app.test.example/link");
    expect(read(first.answer.body, "pollIntervalMs")).toBe(5000);
    const expiresAt = read(first.answer.body, "expiresAt");

    expect(
      typeof expiresAt === "number"
        ? Math.abs(expiresAt - harness.now() - LINK_TRANSACTION_LIFETIME_SECONDS * 1000)
        : NaN,
    ).toBeLessThan(5000);
    const again = await harness.openTransaction({
      desktop,
      operationId: first.operationId,
      userCode: first.userCode,
    });

    expect(again.answer.status).toBe(200);
    expect(read(again.answer.body, "transactionId")).toBe(read(first.answer.body, "transactionId"));
    expect((await harness.rows("link_transactions")).length).toBe(1);
    const rows = await harness.rows("link_transactions");

    // The code is stored as its hash only.
    expect(JSON.stringify(rows)).not.toContain(first.userCode.replace("-", ""));
  });

  it("conflicts on a changed name, key or code under the same operation id", async () => {
    const desktop = await harness.newDesktop();
    const first = await harness.openTransaction({ desktop, name: "Build box" });
    const renamed = await harness.openTransaction({
      desktop,
      name: "Other box",
      operationId: first.operationId,
      userCode: first.userCode,
    });

    expect(renamed.answer.status).toBe(409);
    const recoded = await harness.openTransaction({ desktop, operationId: first.operationId });

    expect(recoded.answer.status).toBe(409);
    expect((await harness.rows("link_transactions")).length).toBe(1);
  });

  it("refuses a code another pending transaction holds, and bounds pending transactions per key", async () => {
    const first = await harness.openTransaction({ desktop: await harness.newDesktop() });
    const squatter = await harness.openTransaction({
      desktop: await harness.newDesktop(),
      userCode: first.userCode,
    });

    expect(squatter.answer.status).toBe(409);
    const busy = await harness.newDesktop();

    for (let count = 0; count < 3; count += 1) {
      expect((await harness.openTransaction({ desktop: busy })).answer.status).toBe(201);
    }

    const fourth = await harness.openTransaction({ desktop: busy });

    expect(fourth.answer.status).toBe(409);
    expect(code(fourth.answer.body)).toBe("limit");
  });

  it("needs a proof by the key being linked", async () => {
    const desktop = await harness.newDesktop();
    const body = JSON.stringify({
      publicKey: desktop.publicKey,
      name: "Build box",
      operationId: "AAAAAAAAAAAAAAAAAAAAAA",
      userCode: "BCDF-GHJK",
    });
    const answer = await harness.send({
      method: "POST",
      path: "/v1/link-transactions",
      headers: {
        "content-type": "application/json",
        "nyte-proof": await harness.proof({
          key: (await harness.newDesktop()).key,
          issuer: await keyThumbprint(desktop.publicKey),
          method: "POST",
          path: "/v1/link-transactions",
          body,
        }),
      },
      body,
    });

    expect(answer.status).toBe(401);
    expect(await harness.rows("link_transactions")).toEqual([]);
  });
});

describe("looking a code up", () => {
  it("shows the host's name and key fingerprint and creates nothing", async () => {
    const { desktop, fingerprint, transactionId } = await opened({ name: "Build box" });
    const lookup = await harness.lookupTransaction({
      userId: "user_alice",
      userCode: "bcdf ghjk",
    });

    expect(lookup.status).toBe(404);
    const typed = await harness.lookupTransaction({
      userId: "user_bob",
      userCode: (await opened()).userCode.toLowerCase().replace("-", " "),
    });

    expect(typed.status).toBe(200);
    expect(fingerprint).toBe(keyFingerprint(await keyThumbprint(desktop.publicKey)));
    expect(await harness.rows("environments")).toEqual([]);
    const row = (await harness.rows("link_transactions")).find(
      (candidate) => read(candidate, "id") === transactionId,
    );

    expect(read(row, "state")).toBe("pending");
    expect(read(row, "owner_id")).toBeNull();
  });

  it("no longer names a transaction once it is approved, denied or past its deadline", async () => {
    const approvedOne = await approved();
    const after = await harness.lookupTransaction({
      userId: "user_alice",
      userCode: approvedOne.userCode,
    });

    expect(after.status).toBe(404);
    const stale = await opened();
    harness.clock.offsetMs = LINK_TRANSACTION_LIFETIME_SECONDS * 1000 + 1;
    expect(
      (await harness.lookupTransaction({ userId: "user_alice", userCode: stale.userCode })).status,
    ).toBe(404);
    const poll = await harness.transactionCall({
      desktop: stale.desktop,
      transactionId: stale.transactionId,
      step: "poll",
    });

    expect(state(poll.body)).toBe("expired");
  });

  it("throttles one owner's guesses", async () => {
    for (let attempt = 0; attempt < 10; attempt += 1) {
      await harness.lookupTransaction({ userId: "user_guess", userCode: "BCDF-GHJK" });
    }

    const eleventh = await harness.lookupTransaction({
      userId: "user_guess",
      userCode: "BCDF-GHJK",
    });

    expect(eleventh.status).toBe(429);
  });
});

describe("approving", () => {
  it("binds the owner once to the fingerprint they compared, and the host completes to a link", async () => {
    const { desktop, transactionId, fingerprint } = await opened({ name: "Build box" });
    const wrong = await harness.decideTransaction({
      userId: "user_alice",
      transactionId,
      decision: "approve",
      fingerprint: "0000-0000-0000-0000",
    });

    expect(wrong.status).toBe(404);
    const pending = await harness.transactionCall({ desktop, transactionId, step: "poll" });

    expect(state(pending.body)).toBe("pending");
    const approve = await harness.decideTransaction({
      userId: "user_alice",
      transactionId,
      decision: "approve",
      fingerprint,
    });

    expect(approve.status).toBe(200);
    const again = await harness.decideTransaction({
      userId: "user_bob",
      transactionId,
      decision: "approve",
      fingerprint,
    });

    expect(again.status).toBe(404);
    expect(
      state((await harness.transactionCall({ desktop, transactionId, step: "poll" })).body),
    ).toBe("approved");
    const { status, link } = await completed(desktop, transactionId);

    expect(status).toBe(201);
    expect(Value.Check(LinkResponse, link)).toBe(true);
    expect(link.environment.name).toBe("Build box");
    expect(link.owner).toEqual({ id: "user_alice", label: "user_alice@example.com" });
    expect(link.brokerKeys).toEqual(harness.brokerKeys);
    expect(await harness.rows("environments")).toEqual([
      expect.objectContaining({
        id: link.environment.id,
        owner_id: "user_alice",
        public_key: desktop.publicKey.x,
        state: "active",
      }),
    ]);
    expect(await harness.rows("link_transactions")).toEqual([
      expect.objectContaining({
        id: transactionId,
        state: "consumed",
        owner_id: "user_alice",
        session_id: "sess_user_alice",
        environment_id: link.environment.id,
      }),
    ]);
  });

  it("lets the owner deny, after which completion reports it and nothing links", async () => {
    const { desktop, transactionId } = await opened();
    const deny = await harness.decideTransaction({
      userId: "user_alice",
      transactionId,
      decision: "deny",
    });

    expect(deny.status).toBe(200);
    expect(state(deny.body)).toBe("denied");
    const complete = await harness.transactionCall({ desktop, transactionId, step: "complete" });

    expect(complete.status).toBe(200);
    expect(state(complete.body)).toBe("denied");
    expect(await harness.rows("environments")).toEqual([]);
    const late = await harness.decideTransaction({
      userId: "user_alice",
      transactionId,
      decision: "approve",
      fingerprint: keyFingerprint(await keyThumbprint(desktop.publicKey)),
    });

    expect(late.status).toBe(404);
  });
});

describe("completing", () => {
  it("answers the same link again to the same key after a lost answer, without renaming or re-approving", async () => {
    const { desktop, transactionId } = await approved({ name: "Build box" });
    const first = await completed(desktop, transactionId);
    const renamed = await harness.openTransaction({ desktop, name: "Renamed" });

    expect(renamed.answer.status).toBe(201);
    const second = await completed(desktop, transactionId);

    expect(second.status).toBe(200);
    expect(second.link).toEqual(first.link);
    expect((await harness.rows("environments")).length).toBe(1);
    expect(read((await harness.rows("environments"))[0], "name")).toBe("Build box");
  });

  it("refuses a replayed proof and another key's proof", async () => {
    const { desktop, transactionId } = await approved();
    const path = `/v1/link-transactions/${transactionId}/complete`;
    const token = await harness.proof({
      key: desktop.key,
      issuer: await keyThumbprint(desktop.publicKey),
      method: "POST",
      path,
      body: "",
    });
    const first = await harness.send({ method: "POST", path, headers: { "nyte-proof": token } });

    expect(first.status).toBe(201);
    const replay = await harness.send({ method: "POST", path, headers: { "nyte-proof": token } });

    expect(replay.status).toBe(401);
    const stranger = await harness.transactionCall({
      desktop: await harness.newDesktop(),
      transactionId,
      step: "complete",
    });

    expect(stranger.status).toBe(401);
    expect((await harness.rows("environments")).length).toBe(1);
  });

  it("converges two concurrent completions on one environment and one consumption", async () => {
    const { desktop, transactionId } = await approved();
    const [left, right] = await Promise.all([
      completed(desktop, transactionId),
      completed(desktop, transactionId),
    ]);

    expect(left.link.environment.id).toBe(right.link.environment.id);
    expect([left.status, right.status].toSorted((a, b) => a - b)).toEqual([200, 201]);
    expect((await harness.rows("environments")).length).toBe(1);
  });

  it("resumes the owner's existing environment for the same key, renamed, even at the environment limit", async () => {
    const { desktop, link } = await harness.link({ userId: "user_alice", name: "Studio" });
    await harness.link({ userId: "user_alice" });
    await harness.link({ userId: "user_alice" });
    expect((await harness.rows("environments")).length).toBe(3);
    const { transactionId } = await approved({ desktop, name: "Studio headless" });
    const resumed = await completed(desktop, transactionId);

    expect(resumed.status).toBe(200);
    expect(resumed.link.environment.id).toBe(link?.environment.id);
    expect(resumed.link.environment.name).toBe("Studio headless");
    expect((await harness.rows("environments")).length).toBe(3);
  });

  it("refuses a key linked to another owner, a tombstoned key, and an owner at the limit", async () => {
    const { desktop: bobs } = await harness.link({ userId: "user_bob" });
    const other = await approved({ desktop: bobs });
    const conflict = await harness.transactionCall({
      desktop: bobs,
      transactionId: other.transactionId,
      step: "complete",
    });

    expect(code(conflict.body)).toBe("conflict");
    const { desktop: gone } = await harness.link({ userId: "user_alice" });
    expect(
      (await harness.removeEnvironment({ as: "desktop", desktop: gone }, gone.environmentId))
        .status,
    ).toBe(204);
    const tombstoned = await approved({ desktop: gone });
    const revoked = await harness.transactionCall({
      desktop: gone,
      transactionId: tombstoned.transactionId,
      step: "complete",
    });

    expect(code(revoked.body)).toBe("revoked");
    await harness.link({ userId: "user_alice" });
    await harness.link({ userId: "user_alice" });
    await harness.link({ userId: "user_alice" });
    const full = await approved();
    const limit = await harness.transactionCall({
      desktop: full.desktop,
      transactionId: full.transactionId,
      step: "complete",
    });

    expect(code(limit.body)).toBe("limit");
    expect(read((await harness.rows("link_transactions")).at(-1), "state")).toBe("approved");
  });

  it("lapses an approval the host did not complete in time", async () => {
    const { desktop, transactionId } = await approved();
    harness.clock.offsetMs = LINK_AUTHORIZATION_LIFETIME_SECONDS * 1000 + 1;
    const late = await harness.transactionCall({ desktop, transactionId, step: "complete" });

    expect(late.status).toBe(200);
    expect(state(late.body)).toBe("expired");
    expect(await harness.rows("environments")).toEqual([]);
    await harness.sweep();
    expect(await harness.rows("link_transactions")).toEqual([
      expect.objectContaining({ id: transactionId, state: "expired", owner_id: null }),
    ]);
  });

  it("refuses an owner deleted or a session denied between approval and completion", async () => {
    const first = await approved();
    expect((await harness.webhook(deleted("user_alice"))).status).toBe(204);
    const gone = await harness.transactionCall({
      desktop: first.desktop,
      transactionId: first.transactionId,
      step: "complete",
    });

    expect(code(gone.body)).toBe("owner_disabled");
    expect(await harness.rows("environments")).toEqual([]);

    await harness.reset();
    const { desktop } = await harness.link({ userId: "user_alice" });
    const phone = await harness.enroll({
      userId: "user_alice",
      sessionId: "sess_user_alice",
      environmentId: desktop.environmentId,
    });

    expect(phone.status).toBe(201);
    const second = await approved();
    const revokedPhone = await harness.removeDevice(
      { as: "desktop", desktop },
      { environmentId: desktop.environmentId, deviceId: String(read(phone.body, "deviceId")) },
    );

    expect(revokedPhone.status).toBe(204);
    const denied = await harness.transactionCall({
      desktop: second.desktop,
      transactionId: second.transactionId,
      step: "complete",
    });

    expect(code(denied.body)).toBe("session_revoked");
    expect((await harness.rows("environments")).length).toBe(1);
  });
});

describe("cancelling", () => {
  it("ends a pending or approved transaction so completion cannot claim", async () => {
    const { desktop, transactionId } = await approved();
    const cancel = await harness.transactionCall({ desktop, transactionId, step: "cancel" });

    expect(cancel.status).toBe(200);
    expect(state(cancel.body)).toBe("cancelled");
    const complete = await harness.transactionCall({ desktop, transactionId, step: "complete" });

    expect(state(complete.body)).toBe("cancelled");
    expect(await harness.rows("environments")).toEqual([]);
    expect(read((await harness.rows("link_transactions"))[0], "owner_id")).toBeNull();
  });

  it("reports consumed when completion won, leaving the environment and the receipt", async () => {
    const { desktop, transactionId } = await approved();
    const { link } = await completed(desktop, transactionId);
    const cancel = await harness.transactionCall({ desktop, transactionId, step: "cancel" });

    expect(state(cancel.body)).toBe("consumed");
    expect((await completed(desktop, transactionId)).link).toEqual(link);
    expect((await harness.rows("environments")).length).toBe(1);
  });
});

describe("browser access", () => {
  it("answers CORS preflight for lookup and approve from the web origin, and for nothing proof-bound", async () => {
    const preflight = (path: string, method: string) =>
      harness.send({
        method: "OPTIONS",
        path,
        headers: {
          origin: "https://app.test.example",
          "access-control-request-method": method,
        },
      });
    const lookup = await preflight("/v1/link-transactions/lookup", "POST");

    expect(lookup.status).toBe(204);
    expect(lookup.headers.get("access-control-allow-methods")).toContain("POST");
    const id = "4b0c2f3a-1d2e-4f5a-8b6c-7d8e9f0a1b2c";
    expect(
      (await preflight(`/v1/link-transactions/${id}/approve`, "POST")).headers.get(
        "access-control-allow-methods",
      ),
    ).toContain("POST");
    const poll = await preflight(`/v1/link-transactions/${id}/poll`, "POST");

    expect(poll.headers.get("access-control-allow-origin")).toBeNull();
  });
});

describe("claim atomicity and authority", () => {
  it("consumes alongside the claim even while an unrelated session is denied, for new and resumed keys", async () => {
    // Bob's phone enrolled with his session, then was revoked: an effective denial exists in D1.
    const { desktop: bobs } = await harness.link({ userId: "user_bob" });
    const phone = await harness.enroll({
      userId: "user_bob",
      sessionId: "sess_bob_phone",
      environmentId: bobs.environmentId,
    });
    expect(phone.status).toBe(201);
    expect(
      (
        await harness.removeDevice(
          { as: "desktop", desktop: bobs },
          { environmentId: bobs.environmentId, deviceId: String(read(phone.body, "deviceId")) },
        )
      ).status,
    ).toBe(204);

    const fresh = await approved({ name: "New box" });
    const made = await completed(fresh.desktop, fresh.transactionId);
    expect(made.status).toBe(201);
    const { desktop: resumed, link } = await harness.link({ userId: "user_alice", name: "Old" });
    const again = await approved({ desktop: resumed, name: "Old renamed" });
    const kept = await completed(resumed, again.transactionId);
    expect(kept.link.environment.id).toBe(link?.environment.id);

    for (const id of [fresh.transactionId, again.transactionId]) {
      const row = (await harness.rows("link_transactions")).find(
        (candidate) => read(candidate, "id") === id,
      );
      expect(read(row, "state")).toBe("consumed");
      expect(read(row, "environment_id")).toBeTruthy();
    }

    const active = (await harness.rows("environments")).filter(
      (row) => read(row, "state") === "active",
    );
    expect(active.length).toBe(3);
  });

  it("refuses a direct resume whose session was denied between verification and the claim", async () => {
    // The route verifies the session, then a denial lands before the batch: the store must not call it linked.
    const { desktop } = await harness.link({ userId: "user_alice", sessionId: "sess_alice_mac" });
    await harness.db
      .prepare(
        "INSERT INTO denied_sessions (session_id, user_id, denied_at, next_attempt_at) VALUES (?1, ?2, ?3, ?3)",
      )
      .bind("sess_alice_mac", "user_alice", harness.now())
      .run();
    const outcome = await claimEnvironment(harness.db, {
      kind: "session",
      ownerId: "user_alice",
      sessionId: "sess_alice_mac",
      thumbprint: await keyThumbprint(desktop.publicKey),
      publicKey: desktop.publicKey.x,
      name: "Renamed",
      now: harness.now(),
    });

    expect(outcome).toEqual({ kind: "session_revoked" });
    expect(read((await harness.rows("environments"))[0], "name")).toBe("Studio Mac");
  });

  it("reports revoked, not a link, for a consumed transaction whose environment was since unlinked", async () => {
    const { desktop, transactionId } = await approved();
    const { link } = await completed(desktop, transactionId);
    const removed = await harness.send({
      method: "DELETE",
      path: `/v1/environments/${link.environment.id}`,
      headers: {
        authorization: `Bearer ${await harness.sessionToken({ userId: "user_alice" })}`,
      },
    });
    expect(removed.status).toBe(204);
    const again = await harness.transactionCall({ desktop, transactionId, step: "complete" });

    expect(code(again.body)).toBe("revoked");
  });

  it("recovers the receipt with the transaction's own name after a later transaction renamed the key", async () => {
    const first = await approved({ name: "First name" });
    const { link } = await completed(first.desktop, first.transactionId);
    const second = await approved({ desktop: first.desktop, name: "Second name" });
    const renamed = await completed(first.desktop, second.transactionId);
    expect(renamed.link.environment.name).toBe("Second name");
    const recovered = await completed(first.desktop, first.transactionId);

    expect(recovered.link).toEqual(link);
  });

  it("keeps terminal rows through the sweep, so a lost answer stays recoverable and a cancelled open stays closed", async () => {
    const consumedOne = await approved();
    const { link } = await completed(consumedOne.desktop, consumedOne.transactionId);
    const cancelledOne = await harness.openTransaction({ desktop: consumedOne.desktop });
    const cancelledId = String(read(cancelledOne.answer.body, "transactionId"));
    expect(
      state(
        (
          await harness.transactionCall({
            desktop: consumedOne.desktop,
            transactionId: cancelledId,
            step: "cancel",
          })
        ).body,
      ),
    ).toBe("cancelled");
    harness.clock.offsetMs = 30 * 86_400_000;
    await harness.sweep();

    expect((await harness.rows("link_transactions")).length).toBe(2);
    expect((await completed(consumedOne.desktop, consumedOne.transactionId)).link).toEqual(link);
    const replayed = await harness.openTransaction({
      desktop: consumedOne.desktop,
      operationId: cancelledOne.operationId,
      userCode: cancelledOne.userCode,
    });

    // The exact open answers the cancelled transaction as it stands; nothing reopens.
    expect(replayed.answer.status).toBe(200);
    expect(read(replayed.answer.body, "transactionId")).toBe(cancelledId);
    expect(read(replayed.answer.body, "state")).toBe("cancelled");
    expect((await harness.rows("link_transactions")).length).toBe(2);
  });

  it("answers an exact open retry with the transaction as it stands after its deadline, and still conflicts on changed input", async () => {
    const desktop = await harness.newDesktop();
    const first = await harness.openTransaction({ desktop, name: "Build box" });
    const transactionId = read(first.answer.body, "transactionId");

    expect(read(first.answer.body, "state")).toBe("pending");
    harness.clock.offsetMs = LINK_TRANSACTION_LIFETIME_SECONDS * 1000 + 1000;

    const late = await harness.openTransaction({
      desktop,
      name: "Build box",
      operationId: first.operationId,
      userCode: first.userCode,
    });

    expect(late.answer.status).toBe(200);
    expect(read(late.answer.body, "transactionId")).toBe(transactionId);
    expect(read(late.answer.body, "state")).toBe("expired");
    await harness.sweep();

    const swept = await harness.openTransaction({
      desktop,
      name: "Build box",
      operationId: first.operationId,
      userCode: first.userCode,
    });

    expect(read(swept.answer.body, "state")).toBe("expired");

    const renamed = await harness.openTransaction({
      desktop,
      name: "Renamed box",
      operationId: first.operationId,
      userCode: first.userCode,
    });

    expect(renamed.answer.status).toBe(409);
    expect((await harness.rows("link_transactions")).length).toBe(1);
  });
});
