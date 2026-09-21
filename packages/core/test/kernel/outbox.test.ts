import assert from "node:assert/strict";
import { test } from "vitest";
import type { EventBody } from "../../src/kernel/model.ts";
import { createOutbox } from "../../src/kernel/outbox.ts";
import { granted, openSession } from "./helpers.ts";

test("full outbox applies backpressure without losing or reordering deltas", async () => {
  const session = await openSession();
  const lease = granted(await session.leases.acquire("outbox", 30_000));
  const outbox = createOutbox(session, { lease, onFenced: () => undefined });

  let pressure = outbox.emit({
    kind: "delta",
    runId: "run",
    attempt: 1,
    index: 0,
    part: "text",
    delta: "0",
  });
  for (let index = 1; index < 128; index += 1) {
    pressure = outbox.emit({
      kind: "delta",
      runId: "run",
      attempt: 1,
      index,
      part: "text",
      delta: String(index),
    });
  }

  assert.ok(pressure instanceof Promise);
  assert.throws(
    () =>
      outbox.emit({
        kind: "delta",
        runId: "run",
        attempt: 1,
        index: 128,
        part: "text",
        delta: "128",
      }),
    /await emit/u,
  );
  await pressure;
  outbox.emit({
    kind: "delta",
    runId: "run",
    attempt: 1,
    index: 128,
    part: "text",
    delta: "128",
  });
  await outbox.flush();

  const deltas = (await session.events.read({ afterSeq: 0 })).flatMap((event) =>
    event.kind === "delta" ? [{ index: event.index, delta: event.delta }] : [],
  );
  assert.deepEqual(
    deltas,
    Array.from({ length: 129 }, (_, index) => ({ index, delta: String(index) })),
  );
});

test("durable deltas keep their order and pending progress keeps its latest value", async () => {
  const session = await openSession();
  const lease = granted(await session.leases.acquire("outbox", 30_000));
  const outbox = createOutbox(session, { lease, onFenced: () => undefined });

  outbox.emit({ kind: "progress", runId: "run", callId: "call", progress: { text: "first" } });
  for (const delta of ["a", "b", "c"]) {
    outbox.emit({ kind: "delta", runId: "run", attempt: 1, index: 0, part: "text", delta });
  }
  for (const text of ["second", "latest"]) {
    outbox.emit({ kind: "progress", runId: "run", callId: "call", progress: { text } });
  }
  await outbox.flush();

  const persisted: EventBody[] = [];
  for (const event of await session.events.read({ afterSeq: 0 })) {
    switch (event.kind) {
      case "delta":
        persisted.push({
          kind: event.kind,
          runId: event.runId,
          attempt: event.attempt,
          index: event.index,
          part: event.part,
          delta: event.delta,
        });
        break;
      case "progress":
        persisted.push({
          kind: event.kind,
          runId: event.runId,
          callId: event.callId,
          progress: event.progress,
        });
        break;
      default:
        break;
    }
  }
  assert.deepEqual(persisted, [
    { kind: "delta", runId: "run", attempt: 1, index: 0, part: "text", delta: "a" },
    { kind: "delta", runId: "run", attempt: 1, index: 0, part: "text", delta: "b" },
    { kind: "delta", runId: "run", attempt: 1, index: 0, part: "text", delta: "c" },
    { kind: "progress", runId: "run", callId: "call", progress: { text: "latest" } },
  ]);
});
