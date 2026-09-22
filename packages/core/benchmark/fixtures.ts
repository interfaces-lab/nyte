import assert from "node:assert/strict";
import type { AssistantMessage, UserMessage, Model, Api } from "@nyte-ai/schema";
import type { FileChange, TurnPart } from "@nyte-ai/protocol";
import type { Commit, CommitBody } from "../src/kernel/model.ts";
import { hashObject } from "../src/kernel/hash.ts";
import { changesFromTurns, transcriptFromCommits } from "@nyte-ai/client";

export const SEED = "nyte-core-j-v1";

export const EPOCH = 1_700_000_000_000;

export const TEXT = `${SEED}:`.padEnd(256, "x");

export const MODEL: Model<Api> = {
  id: "synthetic",
  name: "Synthetic",
  api: "openai-responses",
  provider: "synthetic",
  baseUrl: "https://invalid.invalid",
  reasoning: false,
  input: ["text"],
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
  contextWindow: 128_000,
  maxTokens: 1024,
};

type FixtureBody = Extract<CommitBody, { readonly kind: "message" | "checkpoint" }>;

function chain(bodies: readonly FixtureBody[], patches = new Map<number, string>()) {
  let parent: string | null = null;

  return bodies.map((body, index) => {
    const base = { kind: "commit", parent, at: EPOCH + index } as const;

    const commit = ((): Commit => {
      if (body.kind === "checkpoint") return { ...base, body };
      const message = body.message;

      switch (message.role) {
        case "user":
          return { ...base, body: { ...body, message }, start: { kind: "none" } };
        case "assistant":
          return {
            ...base,
            body: { ...body, message },
            calls: Object.fromEntries(
              message.content.flatMap((part) =>
                part.type === "toolCall"
                  ? [[part.id, { kind: "custom", label: part.name }] as const]
                  : [],
              ),
            ),
            outcome: { kind: "ok" },
          };
        case "toolResult": {
          const path = patches.get(index);
          assert.ok(path);

          return {
            ...base,
            body: { ...body, message },
            call: {
              kind: "file_patch",
              op: "edit",
              path,
              added: 2,
              removed: 1,
              patch: `--- a/${path}\n+++ b/${path}\n@@ -1 +1,2 @@\n-old\n+new\n+extra\n`,
            },
            tree: null,
          };
        }

        default: {
          const exhaustive: never = message;

          return exhaustive;
        }
      }
    })();

    const oid = hashObject(commit);
    parent = oid;

    return { oid, commit };
  });
}

export type Workload = "many-turns" | "tool-heavy";

export function projectionFixture(count: number, workload: Workload) {
  const width = workload === "many-turns" ? 4 : 20;
  assert.equal(count % width, 0);
  const pairs = (width - 2) / 2;
  const bodies: FixtureBody[] = [];
  const expectedFiles = new Map<string, FileChange>();
  const resultPaths = new Map<number, string>();

  const assistant = (
    content: AssistantMessage["content"],
    stopReason: AssistantMessage["stopReason"],
  ): AssistantMessage => ({
    role: "assistant",
    content,
    stopReason,
    provider: MODEL.provider,
    api: MODEL.api,
    model: MODEL.id,
    timestamp: EPOCH + bodies.length,
    usage: {
      input: 10,
      output: 5,
      cacheRead: 0,
      cacheWrite: 0,
      totalTokens: 15,
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
    },
  });

  for (let turn = 0; turn < count / width; turn++) {
    bodies.push({
      kind: "message",
      message: { role: "user", content: TEXT, timestamp: EPOCH + bodies.length },
    });

    for (let pair = 0; pair < pairs; pair++) {
      const id = `${SEED}-${turn}-${pair}`;
      const path = `fixture-${(turn * pairs + pair) % 8}.txt`;
      bodies.push({
        kind: "message",
        message: assistant(
          [
            { type: "text", text: TEXT },
            {
              type: "toolCall",
              id,
              name: "edit",
              arguments: { path, oldText: "old", newText: "new\nextra" },
            },
          ],
          "toolUse",
        ),
      });
      resultPaths.set(bodies.length, path);
      bodies.push({
        kind: "message",
        message: {
          role: "toolResult",
          toolCallId: id,
          toolName: "edit",
          isError: false,
          content: [{ type: "text", text: TEXT }],
          timestamp: EPOCH + bodies.length,
        },
      });
    }

    bodies.push({ kind: "message", message: assistant([{ type: "text", text: TEXT }], "stop") });
  }

  const items = chain(bodies, resultPaths);

  for (const [index, path] of resultPaths) {
    const item = items[index];
    assert.ok(item);
    const previous = expectedFiles.get(path);
    expectedFiles.set(path, {
      path,
      added: (previous?.added ?? 0) + 2,
      removed: (previous?.removed ?? 0) + 1,
    });
  }

  return {
    items,
    expectedFiles: [...expectedFiles.values()],
    metadata: {
      workload,
      commits: count,
      turns: count / width,
      pairsPerTurn: pairs,
      toolPairs: (count / width) * pairs,
      textCharacters: TEXT.length,
      seed: SEED,
      epochMs: EPOCH,
      patchFiles: expectedFiles.size,
      addedLines: (count / width) * pairs * 2,
      removedLines: (count / width) * pairs,
    },
  };
}

export function checkTranscript(
  fixture: ReturnType<typeof projectionFixture>,
  turns: ReturnType<typeof transcriptFromCommits>,
) {
  assert.equal(turns.length, fixture.metadata.turns);

  for (const [index, turn] of turns.entries()) {
    assert.equal(turn.kind, "turn");

    if (turn.kind !== "turn") assert.fail("Expected conversation turn");
    assert.equal(turn.failure, undefined);
    assert.equal(turn.startedAt, EPOCH + index * (fixture.metadata.pairsPerTurn * 2 + 2));
    assert.equal(turn.durationMs, fixture.metadata.pairsPerTurn * 2 + 1);
    assert.equal(turn.parts.length, 2 + fixture.metadata.pairsPerTurn * 2);
    const user = turn.parts[0];
    assert.ok(user?.kind === "user");
    assert.equal(user.content, TEXT);

    for (const part of turn.parts) {
      if (part.kind === "assistant") assert.equal(part.text, TEXT);

      if (part.kind === "tool") {
        assert.ok(part.result);
        assert.equal(part.result.output, TEXT);
        assert.equal(part.result.isError, false);
      }
    }

    for (let pair = 0; pair < fixture.metadata.pairsPerTurn; pair++) {
      const tool: TurnPart | undefined = turn.parts[2 + pair * 2];
      assert.ok(tool?.kind === "tool");
      assert.equal(tool.callId, `${SEED}-${index}-${pair}`);
      const path = `fixture-${(index * fixture.metadata.pairsPerTurn + pair) % 8}.txt`;
      assert.equal(tool.class.kind, "file_patch");
      assert.ok("path" in tool.class && tool.class.path === path);
      const resultIndex = index * (fixture.metadata.pairsPerTurn * 2 + 2) + 2 + pair * 2;
      assert.equal(tool.result?.commit, fixture.items[resultIndex]?.oid);
    }
  }

  assert.deepEqual(changesFromTurns(turns), fixture.expectedFiles);
}

export function historyFixture(count: number, checkpoint: boolean) {
  const messages: UserMessage[] = Array.from({ length: count }, (_, index) => ({
    role: "user",
    content: `${String(index).padStart(6, "0")}:${TEXT}`.slice(0, 256),
    timestamp: EPOCH + index,
  }));

  const boundary = Math.floor(count * 0.8);
  const retained = 4;
  const bodies: FixtureBody[] = [];

  for (const [index, message] of messages.entries()) {
    if (checkpoint && index === boundary)
      bodies.push({
        kind: "checkpoint",
        summary: "Synthetic summary",
        retainedTail: messages.slice(boundary - retained, boundary),
        tokensBefore: boundary * 64,
      });
    bodies.push({ kind: "message", message });
  }

  return {
    items: chain(bodies),
    messages,
    metadata: {
      seed: SEED,
      epochMs: EPOCH,
      messages: count,
      storedCommits: bodies.length,
      checkpoint,
      checkpointAfterMessages: checkpoint ? boundary : null,
      retainedTailStart: checkpoint ? boundary - retained : null,
      retainedTailMessages: checkpoint ? retained : 0,
      laterMessages: checkpoint ? count - boundary : count,
      contextEntries: checkpoint ? count - boundary + 1 : count,
      contextMessages: checkpoint ? count - boundary + retained + 1 : count,
      textCharacters: 256,
    },
  };
}
