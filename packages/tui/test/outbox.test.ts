/**
 * The outbox by value: one key per Enter, retried until the store answers,
 * with `queued` and `duplicate` both meaning durable.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import type { SendReceipt } from "@nyte-ai/core";
import { Outbox, retryDelay, type OutboxEntry } from "../src/outbox.ts";

interface Attempt {
  readonly key: string;
  readonly lane: string;
}

function scripted(answers: readonly (SendReceipt | Error)[]) {
  const attempts: Attempt[] = [];
  const send = async (input: { key: string; lane: string }): Promise<SendReceipt> => {
    attempts.push({ key: input.key, lane: input.lane });
    const answer = answers[Math.min(attempts.length - 1, answers.length - 1)];
    if (answer === undefined) throw new Error("no script");
    if (answer instanceof Error) throw answer;
    return answer;
  };
  return { attempts, send };
}

const immediately = async (): Promise<void> => undefined;

test("a send that fails twice is retried with the same key and settles on the receipt", async () => {
  const script = scripted([
    new Error("disk full"),
    new Error("connection lost"),
    { kind: "queued", change: "c1" },
  ]);
  const changes: (readonly OutboxEntry[])[] = [];
  const outbox = new Outbox({
    send: script.send,
    sleep: immediately,
    mintKey: () => "k1",
    onChange: (entries) => changes.push(entries),
  });
  const outcome = await outbox.submit({ content: "hello", lane: "steer" });
  assert.deepEqual(outcome, { kind: "durable", change: "c1", key: "k1" });
  assert.deepEqual(
    script.attempts.map((attempt) => attempt.key),
    ["k1", "k1", "k1"],
  );
  assert.deepEqual(outbox.entries, []);
  // The row was visible while sending, carried its error, and left on the receipt.
  const sending = changes.filter((entries) => entries.length === 1);
  assert.ok(sending.length >= 3);
  assert.equal(sending.at(-1)?.[0]?.lastError, "connection lost");
  assert.deepEqual(changes.at(-1), []);
});

test("a duplicate receipt is durable too: a retry after a lost response never sends twice", async () => {
  const script = scripted([new Error("timeout"), { kind: "duplicate", change: "first" }]);
  const outbox = new Outbox({ send: script.send, sleep: immediately });
  const outcome = await outbox.submit({ content: "once", lane: "queue" });
  assert.equal(outcome.kind, "durable");
  if (outcome.kind === "durable") assert.equal(outcome.change, "first");
  assert.equal(script.attempts.length, 2);
  assert.ok(script.attempts.every((attempt) => attempt.lane === "queue"));
});

test("withdrawing a sending message stops its retries and reports it withdrawn", async () => {
  const script = scripted([new Error("offline")]);
  let release: (() => void) | undefined;
  const outbox = new Outbox({
    send: script.send,
    mintKey: () => "k2",
    sleep: (_ms, signal) =>
      new Promise((resolve) => {
        release = resolve;
        signal.addEventListener("abort", () => resolve(), { once: true });
      }),
  });
  const pending = outbox.submit({ content: "never", lane: "steer" });
  // Let the first attempt fail and park in the backoff.
  await new Promise((resolve) => setTimeout(resolve, 0));
  assert.equal(outbox.entries.length, 1);
  assert.equal(outbox.withdraw("k2"), true);
  const outcome = await pending;
  assert.deepEqual(outcome, { kind: "withdrawn", key: "k2" });
  assert.equal(script.attempts.length, 1);
  assert.equal(outbox.withdraw("k2"), false);
  release?.();
});

test("backoff doubles from a quarter second and stops at ten", () => {
  assert.deepEqual([1, 2, 3, 4, 10].map(retryDelay), [250, 500, 1000, 2000, 10_000]);
});
