import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { setTimeout } from "node:timers/promises";
import { parseArgs } from "node:util";
import { createNyteClient } from "@nyte-ai/client";

const { values } = parseArgs({
  options: { url: { type: "string" }, "token-file": { type: "string" } },
});
if (!values.url) throw new Error("Pass --url with the immutable fixture preview URL.");
const token = values["token-file"]
  ? (await readFile(values["token-file"], "utf8")).trim()
  : process.env.NYTE_TOKEN;
if (!token) throw new Error("Set NYTE_TOKEN or pass --token-file.");
const signal = AbortSignal.timeout(90_000);
const transport: NonNullable<Parameters<typeof createNyteClient>[0]["fetch"]> = (input, init) => {
  const request = new Request(input, init);
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  if (bypass) request.headers.set("x-vercel-protection-bypass", bypass);
  return fetch(request, { signal: AbortSignal.any([signal, request.signal]) });
};
const client = createNyteClient({ baseUrl: values.url, token, fetch: transport });
const info = await client.info();
assert.ok(info.host.kind === "described" && info.host.persistence === "durable");
assert.partialDeepStrictEqual(await client.provider.models.default(), {
  provider: "fixture",
  id: "echo",
});

const { sessionId } = await client.sessions.create({ name: "Deterministic deployment check" });
console.log(`Created fixture chat ${sessionId}`);
const before = await client.sessions.snapshot({ sessionId });
assert.ok(before);
const input = { sessionId, content: "Infrastructure works.", key: crypto.randomUUID() };
const receipt = await client.messages.send(input);
const duplicate = await client.messages.send(input);
assert.equal(duplicate.kind, "duplicate");
assert.equal(duplicate.change, receipt.change);

// Finish without an SSE connection, then replay the events the Workflow already persisted.
for (;;) {
  const current = await client.sessions.snapshot({ sessionId });
  const phase = current?.run?.phase;
  if (phase?.kind === "done") break;
  if (phase?.kind === "failed") throw new Error(phase.error);
  assert.notEqual(phase?.kind, "aborted");
  await setTimeout(250, undefined, { signal });
}
const controller = new AbortController();
let completed = false;
try {
  for await (const event of client.watch({
    sessionId,
    afterSeq: before.seq,
    signal: AbortSignal.any([controller.signal, signal]),
  })) {
    if (event.kind !== "run") continue;
    if (event.run.phase.kind === "failed") throw new Error(event.run.phase.error);
    assert.notEqual(event.run.phase.kind, "aborted");
    if (event.run.phase.kind === "done") {
      completed = true;
      break;
    }
  }
} finally {
  controller.abort();
}
assert.ok(completed, "The fixture stream must report completed work");
// A new client reads PostgreSQL history independently of the streaming connection.
const reader = createNyteClient({ baseUrl: values.url, token, fetch: transport });
const snapshot = await reader.sessions.snapshot({ sessionId });
assert.ok(snapshot);
assert.equal(snapshot.run?.phase.kind, "done");
const parts = snapshot.transcript.flatMap((turn) => (turn.kind === "turn" ? turn.parts : []));
assert.equal(parts.filter((part) => part.kind === "user").length, 1);
assert.deepEqual(
  parts.flatMap((part) => (part.kind === "assistant" ? [part.text] : [])),
  ["Fixture reply: Infrastructure works."],
);
console.log("Passed: fixture boot, dispatch, replay, idempotent admission, and saved reply.");
