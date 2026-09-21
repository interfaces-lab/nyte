/**
 * What a commit records beside its message: the class of each tool call, and
 * why a response failed. The provider is a script; the tools and the store
 * are real.
 */
import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { createAssistantMessageEventStream, type Api, type Model } from "@nyte-ai/ai";
import type { AssistantMessage } from "@nyte-ai/schema";
import { branch } from "../../src/kernel/graph.ts";
import { runRef } from "../../src/kernel/names.ts";
import { submit } from "../../src/kernel/queue.ts";
import { step } from "../../src/kernel/step.ts";
import type { Session } from "../../src/kernel/store.ts";
import { bindTurn } from "../../src/kernel/turn.ts";
import type { StreamFn } from "../../src/kernel/loop/types.ts";
import { createAllTools } from "../../src/tools/index.ts";
import { assistant, call, drain, message, openSession, user } from "./helpers.ts";

const model: Model<Api> = {
  id: "test-model",
  name: "Test model",
  api: "openai-responses",
  provider: "openai",
  baseUrl: "https://example.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 100_000,
  maxTokens: 1_000,
};

function scripted(answers: readonly AssistantMessage[]): StreamFn {
  const queue = [...answers];
  return () => {
    const answer = queue.shift();
    if (answer === undefined) throw new Error("the script ran out of answers");
    const stream = createAssistantMessageEventStream();
    queueMicrotask(() => {
      if (answer.stopReason === "error" || answer.stopReason === "aborted") {
        stream.push({ type: "error", reason: answer.stopReason, error: answer });
        return;
      }
      if (answer.stopReason === "pending") throw new Error("pending is not terminal");
      stream.push({ type: "start", partial: { ...answer, content: [] } });
      stream.push({ type: "done", reason: answer.stopReason, message: answer });
    });
    return stream;
  };
}

async function drive(session: Session, streamFn: StreamFn, cwd: string, steps: number) {
  const turn = bindTurn({
    streamFn,
    model,
    systemPrompt: "system",
    tools: createAllTools(cwd),
    retry: { enabled: true, maxRetries: 2, baseDelayMs: 1 },
  });
  await submit(session, {
    preparation: { kind: "none" },
    head: "main",
    delivery: "steer",
    kind: "user",
    body: message(user("go")),
  });
  for (let index = 0; index < steps; index += 1) {
    await step(session, turn, { head: "main", drain });
  }
  const runOid = await session.refs.read(runRef("main"));
  const run = runOid === null ? undefined : await session.objects.get(runOid);
  const commits = (await branch(session.objects, await session.refs.read("refs/heads/main"))).map(
    (entry) => entry.commit,
  );
  return { commits, run: run?.kind === "run" ? run : undefined };
}

test("an edit call is stamped as file_edit, and its result as the settled patch", async () => {
  const cwd = await mkdtemp(join(tmpdir(), "nyte-provenance-"));
  await writeFile(join(cwd, "note.txt"), "one\ntwo\nthree\n");
  const session = await openSession();
  const edit = call("call-edit", "edit", {
    path: "note.txt",
    edits: [{ oldText: "two\n", newText: "2\n2b\n" }],
  });
  const { commits } = await drive(
    session,
    scripted([assistant("", { calls: [edit] }), assistant("done")]),
    cwd,
    4,
  );
  const [, asked, settled] = commits;
  assert.ok(asked !== undefined && "calls" in asked);
  assert.deepEqual(asked.calls, { "call-edit": { kind: "file_edit", path: "note.txt" } });
  assert.ok(settled !== undefined && "call" in settled);
  const patch = settled.call;
  assert.ok(patch?.kind === "file_patch");
  assert.equal(patch.op, "edit");
  assert.equal(patch.path, "note.txt");
  assert.deepEqual([patch.added, patch.removed], [2, 1]);
  assert.match(patch.patch, /^-two\n\+2\n\+2b$/mu);
  assert.equal(settled.tree === null || typeof settled.tree === "string", true);
});

test("a provider error is classified once, on the commit and on the retry phase", async () => {
  const session = await openSession();
  const { commits, run } = await drive(
    session,
    scripted([assistant("", { stop: "error", error: "429 rate limit exceeded" })]),
    tmpdir(),
    2,
  );
  const failure = { class: "rate_limit", message: "429 rate limit exceeded" };
  const failed = commits.at(-1);
  assert.ok(failed !== undefined && "outcome" in failed);
  assert.deepEqual(failed.outcome, { kind: "failed", failure });
  assert.deepEqual(failed.calls, {});
  assert.ok(run?.phase.kind === "retry");
  assert.equal(run.phase.retries, 1);
  assert.deepEqual(run.phase.failure, failure);
});

test("an unknown tool is custom under its own name", async () => {
  const session = await openSession();
  const { commits } = await drive(
    session,
    scripted([assistant("", { calls: [call("call-x", "mystery", { any: 1 })] }), assistant("ok")]),
    tmpdir(),
    4,
  );
  const [, asked, settled] = commits;
  assert.ok(asked !== undefined && "calls" in asked);
  assert.deepEqual(asked.calls, { "call-x": { kind: "custom", label: "mystery" } });
  assert.ok(settled !== undefined && "call" in settled);
  assert.deepEqual(settled.call, { kind: "custom", label: "mystery" });
});
