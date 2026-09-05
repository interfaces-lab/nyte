/**
 * The question tool through the TUI's own state: the model parks on
 * `question`, the follower sees the parked call, and the composer's reply
 * path wakes the run. Nothing here is a mock; the provider is scripted.
 */
import assert from "node:assert/strict";
import { test } from "vitest";
import { createAssistantMessageEventStream } from "@nyte-ai/ai";
import type { SessionId, StreamFn } from "@nyte-ai/core";
import { inlinePlugin } from "@nyte-ai/core/plugins";
import { questionPlugin } from "@nyte-ai/plugin/examples/question";
import type { AssistantMessage } from "@nyte-ai/schema";
import { laneRoles } from "../src/lanes.ts";
import { Outbox } from "../src/outbox.ts";
import { SessionFollower } from "../src/session-follow.ts";
import type { SessionState } from "../src/session-state.ts";
import { model, openHost, untilState } from "./helpers.ts";

const usage = {
  input: 10,
  output: 5,
  cacheRead: 0,
  cacheWrite: 0,
  totalTokens: 15,
  cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
};

/** Asks once, then answers with whatever the tool result said. */
function asker(): StreamFn {
  return (_model, context) => {
    const results = context.messages.filter((item) => item.role === "toolResult");
    const message: AssistantMessage =
      results.length === 0
        ? {
            role: "assistant",
            content: [
              {
                type: "toolCall",
                id: "ask-1",
                name: "question",
                arguments: {
                  question: "Which one?",
                  options: [{ label: "Small patch" }, { label: "Rewrite" }],
                },
              },
            ],
            api: "openai-responses",
            provider: "openai",
            model: model.id,
            usage,
            stopReason: "toolUse",
            timestamp: 1_000,
          }
        : {
            role: "assistant",
            content: [
              {
                type: "text",
                text: `you said ${results
                  .flatMap((item) => (item.role === "toolResult" ? item.content : []))
                  .map((part) => (part.type === "text" ? part.text : ""))
                  .join("")}`,
              },
            ],
            api: "openai-responses",
            provider: "openai",
            model: model.id,
            usage,
            stopReason: "stop",
            timestamp: 1_000,
          };
    const stream = createAssistantMessageEventStream();
    stream.push({ type: "start", partial: { ...message, content: [] } });
    stream.push({
      type: "done",
      reason: message.stopReason === "toolUse" ? "toolUse" : "stop",
      message,
    });
    return stream;
  };
}

interface Followed {
  readonly follower: SessionFollower;
  readonly current: () => SessionState | undefined;
  readonly subscribe: (listener: (state: SessionState) => void) => () => void;
}

function follow(host: Awaited<ReturnType<typeof openHost>>, sessionId: SessionId): Followed {
  const listeners = new Set<(state: SessionState) => void>();
  const follower = new SessionFollower(host.nyte, {
    sessionId,
    onUpdate: ({ state }) => {
      for (const listener of listeners) listener(state);
    },
    retryMs: 10,
  });
  return {
    follower,
    current: () => follower.state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function answerText(state: SessionState): string | undefined {
  for (const item of state.transcript.items) {
    if (item.kind !== "turn") continue;
    for (const part of item.parts) {
      if (part.kind === "assistant" && part.text.startsWith("you said")) return part.text;
    }
  }
  return undefined;
}

test("a parked question is answered from the follower's state and the run goes on", async () => {
  const host = await openHost(asker(), [inlinePlugin(questionPlugin)]);
  const { sessionId } = await host.nyte.sessions.create({ name: "ask" });
  const detach = host.attach();
  const followed = follow(host, sessionId);
  const outbox = new Outbox({
    send: (input) => host.nyte.messages.send({ sessionId, ...input }),
    sleep: async () => undefined,
  });
  try {
    await followed.follower.start();
    await outbox.submit({ content: "go", lane: laneRoles(host.nyte.landing).steer });
    const parked = await untilState(
      followed,
      (state) => state.waiting !== undefined && state.run?.phase.kind === "waiting",
    );
    assert.equal(parked.waiting?.tool, "question");

    const waiting = parked.waiting;
    if (waiting === undefined) throw new Error("no parked call");
    const replied = await host.nyte.runs.reply({
      sessionId,
      runId: waiting.runId,
      callId: waiting.callId,
      reply: "2",
    });
    assert.equal(replied.kind, "signalled");
    const done = await untilState(followed, (state) => answerText(state) !== undefined);
    assert.equal(answerText(done), "you said Rewrite");
    assert.equal(done.waiting, undefined);
  } finally {
    followed.follower.close();
    detach();
  }
});

test("a follower that snapshots while the run is parked still sees the parked call", async () => {
  const host = await openHost(asker(), [inlinePlugin(questionPlugin)]);
  const { sessionId } = await host.nyte.sessions.create({ name: "ask" });
  const detach = host.attach();
  const first = follow(host, sessionId);
  const outbox = new Outbox({
    send: (input) => host.nyte.messages.send({ sessionId, ...input }),
    sleep: async () => undefined,
  });
  try {
    await first.follower.start();
    await outbox.submit({ content: "go", lane: laneRoles(host.nyte.landing).steer });
    await untilState(
      first,
      (state) => state.waiting !== undefined && state.run?.phase.kind === "waiting",
    );
    first.follower.close();

    // A client that opens the session now, or one that had to resync.
    const late = follow(host, sessionId);
    try {
      const state = await late.follower.start();
      assert.equal(state.run?.phase.kind, "waiting");
      assert.equal(state.waiting?.tool, "question");
      assert.equal(state.waiting?.callId, "ask-1");
    } finally {
      late.follower.close();
    }
  } finally {
    detach();
  }
});
