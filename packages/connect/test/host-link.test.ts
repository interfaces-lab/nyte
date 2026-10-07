/**
 * A host with no browser links through a transaction: the key, operation id
 * and code are on disk before the real broker hears of them, the owner
 * approves from a browser session, and the host completes with fresh proofs.
 * The broker is the real Worker over workerd and D1; only Clerk is fake.
 */
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Value } from "typebox/value";
import { afterAll, afterEach, beforeAll, beforeEach, test, vi } from "vitest";
import { startWorkerdBroker } from "../../connect-worker/test/workerd.ts";
import type { WorkerdBroker } from "../../connect-worker/test/workerd.ts";
import { LinkTransactionLookup, keyFingerprint } from "../src/index.ts";
import type { ConnectLinking, ConnectView } from "../src/index.ts";
import { ConnectRuntime } from "../src/host/index.ts";
import type { ConnectFile, LinkAuthorizer } from "../src/host/index.ts";
import { createProof, keyThumbprint, publicKeyOf } from "../src/signing.ts";
import type { PrivateJwk } from "../src/signing.ts";

/**
 * Writes into the store, as renames onto its path: one can be held before it
 * lands, as a slow disk would, and every landing is counted.
 */
const disk = vi.hoisted(() => {
  const state: {
    hold:
      | { readonly path: string; readonly reached: () => void; readonly release: Promise<void> }
      | undefined;
    readonly landed: string[];
  } = { hold: undefined, landed: [] };

  return state;
});

vi.mock("node:fs/promises", async (importOriginal) => {
  const actual = await importOriginal<{
    readonly rename: (from: string, to: string) => Promise<void>;
  }>();

  return {
    ...actual,
    rename: async (from: string, to: string) => {
      const hold = disk.hold;

      if (hold !== undefined && to === hold.path) {
        disk.hold = undefined;
        hold.reached();
        await hold.release;
      }

      await actual.rename(from, to);
      disk.landed.push(to);
    },
  };
});

/** Hold the next write to `path` until `release`; `reached` resolves once it is waiting. */
function holdNextWrite(path: string) {
  const reached = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  disk.hold = { path, reached: reached.resolve, release: release.promise };

  return { reached: reached.promise, release: release.resolve };
}

/** Whether `promise` is still unsettled after the event loop has had a turn. */
async function stillPending(promise: Promise<unknown>): Promise<boolean> {
  let settled = false;
  void promise.then(
    () => {
      settled = true;
    },
    () => {
      settled = true;
    },
  );
  await new Promise((resolve) => setTimeout(resolve, 50));

  return !settled;
}

let workerd: WorkerdBroker;
const cleanups: (() => Promise<void>)[] = [];

beforeAll(async () => {
  workerd = await startWorkerdBroker();
});

afterAll(async () => {
  await workerd.close();
});

beforeEach(async () => {
  await workerd.reset();
  workerd.clerk.users.set("user_alice", {
    banned: false,
    locked: false,
    updated_at: 1,
    email: "alice@example.com",
  });
});

afterEach(async () => {
  disk.hold = undefined;

  for (const cleanup of cleanups.splice(0).reverse()) await cleanup();
  vi.unstubAllEnvs();
});

type Awaiting = Extract<ConnectLinking, { kind: "awaiting_approval" }>;

/** Answers the broker commits but this host never receives: the request goes through, the reply is dropped. */
interface Faults {
  /** `METHOD /path` prefixes whose next answer is lost. Each match consumes one entry. */
  readonly drop: string[];
  /** `METHOD /path` prefixes whose next request never leaves this host. Each match consumes one entry. */
  readonly block: string[];
  /** A prefix whose next answer is committed, then held until `release`, then lost. */
  held:
    | { readonly prefix: string; readonly reached: () => void; readonly release: Promise<void> }
    | undefined;
  /** Every request this host sent, `METHOD /path`. */
  readonly sent: string[];
}

async function fixture() {
  const root = await mkdtemp(join(tmpdir(), "nyte-link-"));
  cleanups.push(() => rm(root, { recursive: true, force: true }));
  const storePath = join(root, "connect.json");
  const opened: Awaiting[] = [];
  const views: ConnectView["kind"][] = [];
  const faults: Faults = { drop: [], block: [], held: undefined, sent: [] };
  let runtime: ConnectRuntime | undefined;

  const start = (
    authorizer?: LinkAuthorizer,
    origin = workerd.origin,
    name = "Build box",
  ): ConnectRuntime => {
    const created = new ConnectRuntime({
      config: { origin },
      home: root,
      storePath,
      authorizer: authorizer ?? {
        kind: "transaction",
        onOpened: (awaiting) => opened.push(awaiting),
      },
      onChange: () => {
        void created.view().then((view) => views.push(view.kind));
      },
      name,
      fetch: async (input, init) => {
        const line = `${init.method ?? "GET"} ${new URL(input).pathname}`;
        const blocked = faults.block.findIndex((prefix) => line.startsWith(prefix));

        if (blocked !== -1) {
          faults.block.splice(blocked, 1);
          throw new TypeError(`unreachable: ${line}`);
        }

        faults.sent.push(line);
        const response = await workerd.fetch(input, init);
        const held = faults.held;

        if (held !== undefined && line.startsWith(held.prefix)) {
          faults.held = undefined;
          await response.body?.cancel();
          held.reached();
          await held.release;
          throw new TypeError(`answer lost: ${line}`);
        }

        const dropped = faults.drop.findIndex((prefix) => line.startsWith(prefix));

        if (dropped === -1) return response;
        faults.drop.splice(dropped, 1);
        await response.body?.cancel();
        throw new TypeError(`answer lost: ${line}`);
      },
      timing: { linkPollMs: 50 },
    });
    cleanups.push(() => created.close().catch(() => undefined));
    runtime = created;

    return created;
  };

  const file = async (): Promise<ConnectFile> => {
    const parsed: unknown = JSON.parse(await readFile(storePath, "utf8"));

    if (typeof parsed !== "object" || parsed === null) throw new Error("not a file");

    return Object.assign(Object.create(null), parsed);
  };

  return { root, storePath, opened, views, faults, start, file, runtime: () => runtime };
}

/** The owner at app.nyte.sh: looks the code up and decides. */
async function browser(input: {
  readonly userId: string;
  readonly userCode: string;
  readonly decision: "approve" | "deny";
  readonly fingerprint?: string;
}): Promise<{ readonly lookup: LinkTransactionLookup; readonly status: number }> {
  const token = await workerd.sessionToken({ userId: input.userId });
  const headers = { authorization: `Bearer ${token}`, "content-type": "application/json" };
  const looked = await workerd.fetch(`${workerd.origin}/v1/link-transactions/lookup`, {
    method: "POST",
    headers,
    body: JSON.stringify({ userCode: input.userCode }),
  });
  const lookup: unknown = await looked.json();

  if (!Value.Check(LinkTransactionLookup, lookup))
    throw new Error(`lookup ${String(looked.status)}`);
  const decided = await workerd.fetch(
    `${workerd.origin}/v1/link-transactions/${lookup.transactionId}/${input.decision}`,
    {
      method: "POST",
      headers,
      body:
        input.decision === "approve"
          ? JSON.stringify({ fingerprint: input.fingerprint ?? lookup.fingerprint })
          : undefined,
    },
  );

  return { lookup, status: decided.status };
}

/** A host's proof-bound call on its own transaction, outside the runtime. */
async function hostCall(
  key: PrivateJwk,
  transactionId: string,
  step: "poll" | "complete" | "cancel",
): Promise<unknown> {
  const method = step === "cancel" ? "DELETE" : "POST";
  const path =
    step === "cancel"
      ? `/v1/link-transactions/${transactionId}`
      : `/v1/link-transactions/${transactionId}/${step}`;
  const proof = await createProof({
    key,
    issuer: await keyThumbprint(publicKeyOf(key)),
    audience: workerd.origin,
    method,
    path,
    body: "",
  });
  const response = await workerd.fetch(`${workerd.origin}${path}`, {
    method,
    headers: { "nyte-proof": proof },
  });

  return response.json();
}

async function transactions(): Promise<unknown[]> {
  return workerd.query("SELECT * FROM link_transactions");
}

function row(value: unknown, key: string): unknown {
  return typeof value === "object" && value !== null && key in value
    ? Object.entries(value).find(([name]) => name === key)?.[1]
    : undefined;
}

test("the owner approves from a browser and the host is linked under the broker it used", async () => {
  const { opened, start, file } = await fixture();
  const runtime = start();
  const linking = runtime.link();
  await vi.waitFor(() => assert.equal(opened.length, 1));
  const [awaiting] = opened;

  if (awaiting === undefined) throw new Error("unreachable");
  assert.equal(awaiting.verifyUrl, "https://app.nyte.sh/link");
  assert.match(awaiting.userCode, /^[0-9BCDFGHJKMNPQRSTVWXZ]{4}-[0-9BCDFGHJKMNPQRSTVWXZ]{4}$/u);
  // The key, operation id and code were on disk before the broker answered.
  const pending = (await file()).linkKey;
  assert.equal(pending?.kind, "transaction");

  if (pending?.kind !== "transaction") return;
  assert.equal(pending.userCode, awaiting.userCode);
  assert.equal(pending.transaction?.verifyUrl, awaiting.verifyUrl);
  assert.equal(awaiting.fingerprint, keyFingerprint(await keyThumbprint(publicKeyOf(pending.key))));
  const { lookup, status } = await browser({
    userId: "user_alice",
    userCode: awaiting.userCode,
    decision: "approve",
  });
  assert.equal(status, 200);
  assert.equal(lookup.hostName, "Build box");
  assert.equal(lookup.fingerprint, awaiting.fingerprint);
  const view = await linking;
  assert.equal(view.kind, "linked");

  if (view.kind !== "linked") return;
  assert.deepEqual(view.owner, { id: "user_alice", label: "alice@example.com" });
  assert.equal(view.environment.name, "Build box");
  assert.equal(view.enabled, false);
  const stored = await file();
  assert.equal(stored.link?.origin, workerd.origin);
  assert.equal(stored.linkKey, null);
  assert.deepEqual(stored.link?.key, pending.key);
  assert.equal(row((await transactions())[0], "state"), "consumed");
});

test("a denied or expired transaction fails the link and leaves no environment", async () => {
  const { opened, start } = await fixture();
  const runtime = start();
  const linking = runtime.link();
  await vi.waitFor(() => assert.equal(opened.length, 1));
  await browser({ userId: "user_alice", userCode: opened[0]!.userCode, decision: "deny" });
  const view = await linking;
  assert.equal(view.kind, "unlinked");

  if (view.kind !== "unlinked") return;
  assert.deepEqual(view.linking, { kind: "failed", reason: "denied" });
  assert.deepEqual(await workerd.query("SELECT id FROM environments"), []);
});

test("cancelling tells the broker and forgets the transaction; a late approval cannot link", async () => {
  const { opened, start, file } = await fixture();
  const runtime = start();
  const linking = runtime.link();
  await vi.waitFor(() => assert.equal(opened.length, 1));
  await runtime.cancel();
  const view = await linking;
  assert.equal(view.kind, "unlinked");

  if (view.kind !== "unlinked") return;
  assert.deepEqual(view.linking, { kind: "failed", reason: "cancelled" });
  await vi.waitFor(async () => assert.equal(row((await transactions())[0], "state"), "cancelled"));
  assert.equal((await file()).linkKey, null);
  const late = await workerd.fetch(`${workerd.origin}/v1/link-transactions/lookup`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${await workerd.sessionToken({ userId: "user_alice" })}`,
      "content-type": "application/json",
    },
    body: JSON.stringify({ userCode: opened[0]!.userCode }),
  });
  assert.equal(late.status, 404);
});

test("a completion answer the host lost is recovered by its next completion, not reopened", async () => {
  const { opened, start, file } = await fixture();
  const runtime = start();
  const linking = runtime.link();
  await vi.waitFor(() => assert.equal(opened.length, 1));
  const kept = (await file()).linkKey;

  if (kept?.kind !== "transaction" || kept.transaction === null) throw new Error("unreachable");
  await browser({ userId: "user_alice", userCode: opened[0]!.userCode, decision: "approve" });
  // The broker already consumed this transaction for this key (an earlier completion whose answer was lost).
  const completion = await hostCall(kept.key, kept.transaction.id, "complete");
  assert.equal(row(completion, "state"), "consumed");
  const view = await linking;
  assert.equal(view.kind, "linked");

  if (view.kind !== "linked") return;
  assert.equal(view.environment.id, row(row(row(completion, "link"), "environment"), "id"));
  assert.equal((await workerd.query("SELECT id FROM environments")).length, 1);
  assert.equal((await transactions()).length, 1);
});

test("a cancel the broker never heard is settled before a new transaction; a completion that won is unlinked and its key retired", async () => {
  const { opened, start, file, faults } = await fixture();
  const first = start();
  const linking = first.link();
  await vi.waitFor(() => assert.equal(opened.length, 1));
  const kept = (await file()).linkKey;

  if (kept?.kind !== "transaction" || kept.transaction === null) throw new Error("unreachable");
  // The user cancels while the broker is unreachable: only the intent is on disk.
  faults.block.push(`DELETE /v1/link-transactions/${kept.transaction.id}`);
  await first.cancel();
  await linking;
  assert.equal(row((await transactions())[0], "state"), "pending");
  // Meanwhile the owner approves and the broker consumes the transaction for this key.
  await browser({ userId: "user_alice", userCode: kept.userCode, decision: "approve" });
  assert.equal(row(await hostCall(kept.key, kept.transaction.id, "complete"), "state"), "consumed");
  await first.close();

  const second = start();
  const again = second.link();
  await vi.waitFor(() => assert.equal(opened.length, 2));
  // The environment the cancelled intent produced is unlinked, and the replacement has a new key.
  await vi.waitFor(async () =>
    assert.deepEqual(await workerd.query("SELECT state FROM environments"), [{ state: "revoked" }]),
  );
  const replacement = (await file()).linkKey;

  if (replacement?.kind !== "transaction") throw new Error("unreachable");
  assert.notEqual(replacement.key.x, kept.key.x);
  await browser({ userId: "user_alice", userCode: opened[1]!.userCode, decision: "approve" });
  const view = await again;
  assert.equal(view.kind, "linked");
  assert.deepEqual(
    (await workerd.query("SELECT state FROM environments ORDER BY created_at")).map((entry) =>
      row(entry, "state"),
    ),
    ["revoked", "active"],
  );
  assert.equal((await file()).link?.key.x, replacement.key.x);
});

test("a lost completion answer keeps the intent: the retry recovers the same link and nothing is unlinked", async () => {
  const { opened, start, faults, file } = await fixture();
  const first = start();
  const linking = first.link();
  await vi.waitFor(() => assert.equal(opened.length, 1));
  const kept = (await file()).linkKey;

  if (kept?.kind !== "transaction" || kept.transaction === null) throw new Error("unreachable");
  faults.drop.push(`POST /v1/link-transactions/${kept.transaction.id}/complete`);
  await browser({ userId: "user_alice", userCode: opened[0]!.userCode, decision: "approve" });
  const failed = await linking;
  assert.equal(failed.kind, "unlinked");

  if (failed.kind !== "unlinked") return;
  assert.deepEqual(failed.linking, { kind: "failed", reason: "network" });
  // The broker consumed it; this host still holds the same intent, not an abandonment.
  assert.equal(row((await transactions())[0], "state"), "consumed");
  assert.ok(!faults.sent.some((line) => line.startsWith("DELETE ")));

  const recovered = await first.link();
  assert.equal(recovered.kind, "linked");
  assert.equal(opened.length, 1);
  assert.deepEqual((await file()).unlinks, []);
  assert.deepEqual(await workerd.query("SELECT state FROM environments"), [{ state: "active" }]);
});

test("a lost open answer replays the same operation and code instead of opening another", async () => {
  const { opened, start, faults } = await fixture();
  faults.drop.push("POST /v1/link-transactions");
  const runtime = start();
  const failed = await runtime.link();
  assert.equal(failed.kind === "unlinked" && failed.linking.kind, "failed");
  assert.equal((await transactions()).length, 1);

  const linking = runtime.link();
  await vi.waitFor(() => assert.equal(opened.length, 1));
  // The code shown now names the transaction the lost open made.
  await browser({ userId: "user_alice", userCode: opened[0]!.userCode, decision: "approve" });
  assert.equal((await linking).kind, "linked");
  assert.equal((await transactions()).length, 1);
});

test("closing joins the attempt: nothing is written after close resolves, and the intent survives for the next run", async () => {
  const { opened, start, file } = await fixture();
  const runtime = start();
  let settled = false;
  const linking = runtime.link().then(() => {
    settled = true;
  });
  await vi.waitFor(() => assert.equal(opened.length, 1));
  await runtime.close();
  assert.equal(settled, true);
  await linking;
  const snapshot = JSON.stringify(await file());
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(JSON.stringify(await file()), snapshot);
  // A close is not a cancellation: the transaction stays open for the next attempt.
  assert.equal(row((await transactions())[0], "state"), "pending");
});

test("a link or pending intent made with another broker is unavailable here, never reinterpreted or overwritten", async () => {
  const { opened, start, file, faults } = await fixture();
  const runtime = start();
  const linking = runtime.link();
  await vi.waitFor(() => assert.equal(opened.length, 1));
  // A pending intent under this broker: another build must leave it alone.
  await runtime.close();
  await linking;
  const intent = JSON.stringify((await file()).linkKey);
  const elsewhere = start(undefined, "https://other.connect.example");
  assert.deepEqual(await elsewhere.view(), { kind: "unavailable", reason: "origin_changed" });
  await assert.rejects(elsewhere.link(), { name: "ConnectError" });
  assert.equal(JSON.stringify((await file()).linkKey), intent);
  await elsewhere.close();

  // Finish the link here, queue a device revoke, then switch brokers: no proof of this link reaches the other one.
  const resumed = start();
  const again = resumed.link();
  await browser({ userId: "user_alice", userCode: opened[0]!.userCode, decision: "approve" });
  assert.equal((await again).kind, "linked");
  const link = (await file()).link;

  if (link === null) throw new Error("unreachable");
  const device = await workerd.fetch(
    `${workerd.origin}/v1/environments/${link.environment.id}/devices`,
    {
      method: "POST",
      headers: {
        authorization: `Bearer ${await workerd.sessionToken({ userId: "user_alice", sessionId: "sess_phone" })}`,
        "content-type": "application/json",
      },
      body: JSON.stringify({
        clientId: "phone-install-0001",
        clientName: "Phone",
        digest: "A".repeat(43),
      }),
    },
  );
  // The relay is not serving, so enrollment cannot complete; the queued revoke below is local only.
  assert.notEqual(device.status, 201);
  await resumed.close();
  const other = start(undefined, "https://other.connect.example");
  const sentBefore = faults.sent.length;
  await assert.rejects(other.revokeDevice({ deviceId: link.environment.id }), {
    name: "ConnectError",
  });
  assert.deepEqual(await other.view(), { kind: "unavailable", reason: "origin_changed" });
  assert.equal(faults.sent.length, sentBefore);
  assert.equal((await file()).link?.origin, workerd.origin);
});

/** Hold the next answer to a request starting with `prefix`: committed at the broker, then lost on release. */
function holdAnswer(faults: Faults, prefix: string) {
  const reached = Promise.withResolvers<void>();
  const release = Promise.withResolvers<void>();
  faults.held = { prefix, reached: reached.resolve, release: release.promise };

  return { reached: reached.promise, release: release.resolve };
}

function landedOn(path: string): number {
  return disk.landed.filter((landed) => landed === path).length;
}

test("every close waits for one teardown that joins a cancellation still writing; nothing lands after it", async () => {
  const { opened, start, file, storePath } = await fixture();
  const runtime = start();
  const linking = runtime.link();
  await vi.waitFor(() => assert.equal(opened.length, 1));
  const write = holdNextWrite(storePath);
  const cancelling = runtime.cancel();
  // The abandonment is on its way to disk.
  await write.reached;
  const first = runtime.close();
  const second = runtime.close();
  assert.equal(await stillPending(first), true);
  assert.equal(await stillPending(second), true);
  write.release();
  await Promise.all([first, second, cancelling, linking]);
  const landed = landedOn(storePath);
  const snapshot = JSON.stringify(await file());
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(landedOn(storePath), landed);
  assert.equal(JSON.stringify(await file()), snapshot);
  assert.equal((await file()).linkKey, null);
  assert.equal(row((await transactions())[0], "state"), "cancelled");
});

test("close joins an unlink acknowledgement already being written", async () => {
  const { opened, start, file, storePath } = await fixture();
  const runtime = start();
  const linking = runtime.link();
  await vi.waitFor(() => assert.equal(opened.length, 1));
  await browser({ userId: "user_alice", userCode: opened[0]!.userCode, decision: "approve" });
  assert.equal((await linking).kind, "linked");
  const queued = holdNextWrite(storePath);
  const unlinking = runtime.unlink();
  await queued.reached;
  // The next write is the broker's acknowledgement leaving the queue.
  const acknowledged = holdNextWrite(storePath);
  queued.release();
  await acknowledged.reached;
  const first = runtime.close();
  const second = runtime.close();
  assert.equal(await stillPending(first), true);
  assert.equal(await stillPending(second), true);
  acknowledged.release();
  await Promise.all([first, second, unlinking]);
  const landed = landedOn(storePath);
  assert.deepEqual((await file()).unlinks, []);
  await new Promise((resolve) => setTimeout(resolve, 150));
  assert.equal(landedOn(storePath), landed);
  assert.deepEqual(await workerd.query("SELECT state FROM environments"), [{ state: "revoked" }]);
});

test("a teardown that fails rejects every close caller with the same failure", async () => {
  const { start } = await fixture();
  const failure = new Error("the account would not close");

  const runtime = start({
    kind: "session",
    account: {
      requestSessionToken: () => Promise.reject(new Error("not asked")),
      focus: () => undefined,
      state: () => ({ kind: "signed_out" }),
      signOut: async () => undefined,
      close: () => Promise.reject(failure),
    },
  });

  const first = runtime.close();
  const second = runtime.close();
  await assert.rejects(first, failure);
  await assert.rejects(second, failure);
  await assert.rejects(runtime.close(), failure);
});

test("a cancel while the completed link is being written still wins: the link is queued for unlinking before cancel resolves", async () => {
  const { opened, start, file, storePath, faults } = await fixture();
  const runtime = start();
  const linking = runtime.link();
  await vi.waitFor(() => assert.equal(opened.length, 1));
  const write = holdNextWrite(storePath);
  await browser({ userId: "user_alice", userCode: opened[0]!.userCode, decision: "approve" });
  // The broker consumed the transaction and the link is on its way to disk.
  await write.reached;
  faults.block.push("DELETE /v1/environments/");
  const cancelling = runtime.cancel();
  assert.equal(await stillPending(cancelling), true);
  write.release();
  await cancelling;
  const stored = await file();
  const [environment] = await workerd.query("SELECT id FROM environments");
  assert.equal(stored.link, null);
  assert.deepEqual(
    stored.unlinks.map((entry) => entry.environmentId),
    [row(environment, "id")],
  );
  const view = await linking;
  assert.equal(
    view.kind === "unlinked" && view.linking.kind === "failed" && view.linking.reason,
    "cancelled",
  );
});

test("a cancel while a recovered completion is being written queues that link for unlinking too", async () => {
  const { opened, start, file, storePath, faults } = await fixture();
  const first = start();
  const linking = first.link();
  await vi.waitFor(() => assert.equal(opened.length, 1));
  await first.close();
  await linking;
  const kept = (await file()).linkKey;

  if (kept?.kind !== "transaction" || kept.transaction === null) throw new Error("unreachable");
  await browser({ userId: "user_alice", userCode: kept.userCode, decision: "approve" });
  assert.equal(row(await hostCall(kept.key, kept.transaction.id, "complete"), "state"), "consumed");

  const second = start();
  const write = holdNextWrite(storePath);
  const recovering = second.link();
  await write.reached;
  faults.block.push("DELETE /v1/environments/");
  const cancelling = second.cancel();
  assert.equal(await stillPending(cancelling), true);
  write.release();
  await cancelling;
  const stored = await file();
  assert.equal(stored.link, null);
  assert.equal(stored.unlinks.length, 1);
  const view = await recovering;
  assert.equal(
    view.kind === "unlinked" && view.linking.kind === "failed" && view.linking.reason,
    "cancelled",
  );
});

/**
 * The open reaches the broker, its answer is held while the user cancels,
 * and the broker cannot be reached again during that cancel: the broker's
 * transaction stays pending and only this host knows it was given up.
 */
async function cancelBeforeOpenAnswer(context: Awaited<ReturnType<typeof fixture>>) {
  const { start, file, faults } = context;
  const answer = holdAnswer(faults, "POST /v1/link-transactions");
  const first = start();
  const linking = first.link();
  await answer.reached;
  faults.block.push("POST /v1/link-transactions");
  const cancelling = first.cancel();
  answer.release();
  await cancelling;
  await linking;
  await first.close();
  const [given] = await transactions();
  assert.equal(row(given, "state"), "pending");
  // The key and code are read only to play the owner and an earlier completion below.
  const intent = (await file()).linkKey;

  if (intent?.kind !== "transaction") throw new Error("unreachable");

  return { intent, transactionId: String(row(given, "id")), thumbprint: row(given, "thumbprint") };
}

test("a cancel before the open's answer is kept on disk; the next run recovers that operation and cancels it before opening another", async () => {
  const context = await fixture();
  const { opened, start } = context;
  const { transactionId } = await cancelBeforeOpenAnswer(context);
  const second = start();
  const linking = second.link();
  await vi.waitFor(() => assert.equal(opened.length, 1));

  const rows = await workerd.query("SELECT id, state FROM link_transactions ORDER BY created_at");

  assert.deepEqual(
    rows.map((entry) => [row(entry, "id"), row(entry, "state")]),
    [
      [transactionId, "cancelled"],
      [row(rows[1], "id"), "pending"],
    ],
  );
  await second.cancel();
  await linking;
});

test("a cancel before the open's answer whose transaction was completed anyway unlinks that environment and retires its key", async () => {
  const context = await fixture();
  const { opened, start } = context;
  const { intent, transactionId, thumbprint } = await cancelBeforeOpenAnswer(context);
  await browser({ userId: "user_alice", userCode: intent.userCode, decision: "approve" });
  assert.equal(row(await hostCall(intent.key, transactionId, "complete"), "state"), "consumed");

  const second = start();
  const linking = second.link();
  await vi.waitFor(() => assert.equal(opened.length, 1));
  await vi.waitFor(async () =>
    assert.deepEqual(await workerd.query("SELECT state FROM environments"), [{ state: "revoked" }]),
  );
  // The replacement is opened under another key than the one now unlinked.
  const [, replacement] = await workerd.query(
    "SELECT thumbprint FROM link_transactions ORDER BY created_at",
  );
  assert.notEqual(row(replacement, "thumbprint"), thumbprint);
  await second.cancel();
  await linking;
});

test("an open answer lost until its transaction expired is recovered as expired, never reopened; the next operation carries the host's current name", async () => {
  const { opened, start, faults } = await fixture();
  faults.drop.push("POST /v1/link-transactions");
  const first = start();
  assert.equal((await first.link()).kind, "unlinked");
  const [lost] = await transactions();
  await first.close();
  // Past the deadline and swept, as the cron leaves it.
  await workerd.query(
    "UPDATE link_transactions SET expires_at = ?1, state = 'expired' WHERE state = 'pending'",
    Date.now() - 1,
  );

  const second = start(undefined, workerd.origin, "Renamed box");
  const linking = second.link();
  await vi.waitFor(() => assert.equal(opened.length, 1));

  const rows = await workerd.query(
    "SELECT id, name, state FROM link_transactions ORDER BY created_at",
  );

  assert.deepEqual(
    rows.map((entry) => [row(entry, "id"), row(entry, "name"), row(entry, "state")]),
    [
      [row(lost, "id"), "Build box", "expired"],
      [row(rows[1], "id"), "Renamed box", "pending"],
    ],
  );
  await second.cancel();
  await linking;
});

test("an open answer lost after the owner approved it is recovered and completed, not reopened", async () => {
  const { start, file, faults } = await fixture();
  faults.drop.push("POST /v1/link-transactions");
  const runtime = start();
  assert.equal((await runtime.link()).kind, "unlinked");
  const [lost] = await transactions();
  // The code is read only to play the owner, who could have typed it before the answer was lost.
  const intent = (await file()).linkKey;

  if (intent?.kind !== "transaction") throw new Error("unreachable");
  await browser({ userId: "user_alice", userCode: intent.userCode, decision: "approve" });
  const view = await runtime.link();
  assert.equal(view.kind, "linked");
  assert.deepEqual(
    (await transactions()).map((entry) => [row(entry, "id"), row(entry, "state")]),
    [[row(lost, "id"), "consumed"]],
  );
});
