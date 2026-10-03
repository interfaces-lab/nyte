import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { parseArgs } from "node:util";
import { createNyteClient } from "@nyte-ai/client";

const { values } = parseArgs({
  options: {
    url: { type: "string", default: "http://127.0.0.1:8787" },
    prompt: { type: "boolean" },
  },
});
const token = (await readFile(new URL("../.nyte-token.local", import.meta.url), "utf8")).trim();
const signal = AbortSignal.timeout(90_000);
const client = createNyteClient({
  baseUrl: values.url,
  token,
  fetch: (input, init) =>
    fetch(input, { ...init, signal: AbortSignal.any([signal, new Request(input, init).signal]) }),
});
const info = await client.info();
assert.ok(info.host.kind === "described" && info.host.persistence === "durable");
const model = await client.provider.models.default();
assert.ok(model);
console.log(`Connected: ${info.version}, ${model.provider}/${model.id}`);
if (values.prompt) {
  const { sessionId } = await client.sessions.create({ name: "Wrangler local test" });
  const before = await client.sessions.snapshot({ sessionId });
  assert.ok(before);
  const input = {
    sessionId,
    content: "What is 47 × 19? Answer in one sentence.",
    key: crypto.randomUUID(),
  };
  const receipt = await client.messages.send(input);
  const duplicate = await client.messages.send(input);
  assert.equal(duplicate.kind, "duplicate");
  assert.equal(duplicate.change, receipt.change);
  for (;;) {
    const current = await client.sessions.snapshot({ sessionId });
    if (current?.run?.phase.kind === "done") break;
    if (current?.run?.phase.kind === "failed") throw new Error(current.run.phase.failure.message);
    assert.notEqual(current?.run?.phase.kind, "aborted");
    await setTimeout(100, undefined, { signal });
  }
  const controller = new AbortController();
  let replayed = false;
  try {
    for await (const event of client.watch({
      sessionId,
      afterSeq: before.seq,
      signal: AbortSignal.any([signal, controller.signal]),
    })) {
      if (event.kind === "run" && event.run.phase.kind === "done") {
        replayed = true;
        break;
      }
    }
  } finally {
    controller.abort();
  }
  assert.ok(replayed, "SSE replay must include the completed run");
  const snapshot = await client.sessions.snapshot({ sessionId });
  assert.ok(snapshot);
  const parts = snapshot.transcript.flatMap((turn) => (turn.kind === "turn" ? turn.parts : []));
  assert.equal(parts.filter((part) => part.kind === "user").length, 1);
  const replies = parts.flatMap((part) => (part.kind === "assistant" ? [part.text] : []));
  assert.ok(replies.some((text) => text.length > 0));
  console.log(
    `Passed: alarm execution, input deduplication, SSE replay, and SQLite history. Chat: ${sessionId}`,
  );
  console.log(replies.at(-1));
}
