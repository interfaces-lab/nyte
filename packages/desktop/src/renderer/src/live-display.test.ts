import assert from "node:assert/strict";
import { afterAll, afterEach, test, vi } from "vitest";
import { QueryObserver } from "@tanstack/react-query";
import { sessionId } from "@nyte-ai/protocol";
import type { SessionEvent, SessionSnapshot, TurnPart } from "@nyte-ai/core";
import type { AssistantMessage } from "@nyte-ai/schema";
import { transcriptFromCommits } from "@nyte-ai/core/views";
import type { NyteBridge, WorkspaceSessionDirectory } from "../../shared/ipc.ts";
import { watchSessionLive } from "./live.ts";
import { livePartKey } from "./live-fold.ts";
import { keys, queryClient, refreshThread } from "./queries.ts";
import { presentTool } from "./conversation/tool-detail.ts";
import { displayTranscriptParts } from "./conversation/transcript-presentation.ts";

// Only the external preload and browser clock boundaries are scripted.
const bridge = vi.hoisted(() => {
  const snapshot = vi.fn<NyteBridge["sessions"]["snapshot"]>();
  const watch = vi.fn<NyteBridge["watch"]>();
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal("window", {
    nyte: { sessions: { snapshot }, watch },
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      nextFrame += 1;
      frames.set(nextFrame, callback);
      return nextFrame;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    setTimeout: (callback: () => void, delay: number) => Number(setTimeout(callback, delay)),
    clearTimeout: (timer: number) => clearTimeout(timer),
  });
  return { snapshot, watch, frames };
});

type CommitEvent = Extract<SessionEvent, { kind: "commit" }>;
const ID = sessionId("live-display");
const cleanups: (() => void)[] = [];

function frame(): void {
  const callbacks = [...bridge.frames.values()];
  bridge.frames.clear();
  for (const callback of callbacks) callback(0);
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  await queryClient.cancelQueries();
  queryClient.clear();
  frame();
  bridge.snapshot.mockReset();
  bridge.watch.mockReset();
});
afterAll(() => vi.unstubAllGlobals());

function commit(
  oid: string,
  parent: string | null,
  body: CommitEvent["item"]["commit"]["body"],
  seq: number,
  run = "r1",
): CommitEvent {
  return {
    kind: "commit",
    head: "main",
    seq,
    item: { oid, commit: { kind: "commit", parent, body, run, at: seq } },
  };
}

function assistant(content: AssistantMessage["content"]): CommitEvent["item"]["commit"]["body"] {
  return {
    kind: "message",
    message: {
      role: "assistant",
      content,
      api: "openai-responses",
      provider: "openai",
      model: "test",
      stopReason: content.some((part) => part.type === "toolCall") ? "toolUse" : "stop",
      timestamp: 1,
      usage: {
        input: 0,
        output: 0,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 0,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
    },
  };
}

const calls = commit(
  "calls",
  null,
  assistant([
    { type: "toolCall", id: "c1", name: "bash", arguments: { command: "first" } },
    { type: "toolCall", id: "c2", name: "bash", arguments: { command: "second" } },
  ]),
  1,
);

function result(callId: string, parent: string, seq: number): CommitEvent {
  return commit(
    `result-${callId}`,
    parent,
    {
      kind: "message",
      message: {
        role: "toolResult",
        toolCallId: callId,
        toolName: "bash",
        content: [{ type: "text", text: `${callId} finished` }],
        isError: false,
        timestamp: seq,
      },
    },
    seq,
  );
}

function snapshot(events: readonly CommitEvent[], seq: number): SessionSnapshot {
  const tip = events.at(-1)?.item.oid ?? null;
  return {
    seq,
    head: "main",
    tip,
    config: {},
    pending: [],
    transcript: transcriptFromCommits(events.map((event) => event.item)),
    context: { estimatedTokens: 0, usageTokens: 0, trailingTokens: 0, contextWindow: 1000 },
    session: {
      sessionId: ID,
      createdAt: 0,
      lastActivityAt: 0,
      pinned: false,
      archived: false,
      activation: { kind: "active" },
      config: {},
      heads: [{ head: "main", tip }],
    },
  };
}

function text(delta: string, runId = "r1"): Extract<SessionEvent, { kind: "text_delta" }> {
  return { kind: "text_delta", seq: 2, runId, attempt: 1, index: 0, delta };
}

function progress(callId: string, value: string): SessionEvent {
  return { kind: "tool_progress", seq: 2, runId: "r1", callId, progress: { text: value } };
}

function open(initial: SessionSnapshot) {
  queryClient.setQueryData(keys.snapshot(ID), initial);
  const connections: {
    event: Parameters<NyteBridge["watch"]>[1];
    end: Parameters<NyteBridge["watch"]>[2];
  }[] = [];
  const stop = vi.fn();
  bridge.watch.mockImplementation((_input, event, end) => {
    const connection = { event, end };
    connections.push(connection);
    return stop;
  });
  const observer = new QueryObserver<SessionSnapshot>(queryClient, {
    queryKey: keys.snapshot(ID),
    queryFn: async () => {
      const value = await bridge.snapshot({ sessionId: ID });
      assert.ok(value);
      return value;
    },
  });
  cleanups.push(observer.subscribe(() => {}));
  const live = watchSessionLive(ID, initial.seq);
  let displayed = live.getSnapshot();
  cleanups.push(
    live.dispose,
    live.subscribe(() => {
      displayed = live.getSnapshot();
    }),
  );

  return {
    live,
    stop,
    enqueue: (event: SessionEvent) => {
      const connection = connections.at(-1);
      assert.ok(connection);
      connection.event(event);
    },
    emit: (event: SessionEvent) => {
      const connection = connections.at(-1);
      assert.ok(connection);
      connection.event(event);
      frame();
    },
    disconnect: () => {
      const connection = connections.at(-1);
      assert.ok(connection);
      connection.end?.(new Error("watch disconnected"));
    },
    view: () => {
      frame();
      const durable = observer.getCurrentResult().data;
      assert.ok(durable);
      const parts = durable.transcript.flatMap((turn) =>
        turn.kind === "turn"
          ? displayTranscriptParts(turn.parts).flatMap((group): readonly TurnPart[] =>
              group.kind === "part" ? [group.part] : group.parts,
            )
          : [],
      );
      return {
        text:
          parts
            .flatMap((part) =>
              part.kind === "assistant" || part.kind === "thinking" ? [part.text] : [],
            )
            .join("") +
          displayed.order
            .map(
              (ref) =>
                (ref.kind === "text" ? displayed.text : displayed.thinking).get(
                  livePartKey(ref.runId, ref.attempt, ref.index),
                ) ?? "",
            )
            .join(""),
        tools: parts.flatMap((part) => {
          if (part.kind !== "tool") return [];
          const presented = presentTool(
            part,
            displayed.tools.get(part.callId)?.progress,
            undefined,
          );
          return [presented.body.kind === "output" ? presented.body.text : ""];
        }),
      };
    },
  };
}

test("delayed tool results keep output while same-seq commits and new progress arrive", async () => {
  const view = open(snapshot([calls], 1));
  const first = Promise.withResolvers<SessionSnapshot>();
  const followup = Promise.withResolvers<SessionSnapshot>();
  bridge.snapshot.mockReturnValueOnce(first.promise).mockReturnValueOnce(followup.promise);
  view.emit(progress("c1", "still working"));
  view.emit(progress("c2", "second working"));
  const one = result("c1", "calls", 3);
  const two = result("c2", one.item.oid, 3);
  view.emit({
    kind: "head_moved",
    seq: 3,
    head: "main",
    from: "calls",
    to: two.item.oid,
    reason: "tools",
  });
  view.emit(one);
  view.emit(two);
  assert.deepEqual(view.view().tools, ["still working", "second working"]);
  view.emit({ ...text("next response"), seq: 4, attempt: 2 });
  // A newer generation of the same call cannot be removed by the earlier ack.
  view.emit({ ...progress("c1", "new progress"), seq: 5 });
  assert.deepEqual(view.view(), {
    text: "next response",
    tools: ["new progress", "second working"],
  });
  first.resolve(snapshot([calls], 1));
  await vi.waitFor(() => assert.equal(bridge.snapshot.mock.calls.length, 2));
  assert.deepEqual(view.view().tools, ["new progress", "second working"]);
  followup.resolve(snapshot([calls, one, two], 3));
  await vi.waitFor(() =>
    assert.deepEqual(view.view(), { text: "next response", tools: ["c1 finished", "c2 finished"] }),
  );
});

test("checkpoint acknowledgement removes only its retained text, including reused identities", async () => {
  const view = open(snapshot([], 0));
  const read = Promise.withResolvers<SessionSnapshot>();
  bridge.snapshot.mockReturnValueOnce(read.promise);
  view.emit(text("old partial"));
  const checkpoint = commit(
    "checkpoint",
    null,
    { kind: "checkpoint", summary: "context", retainedTail: [], tokensBefore: 100 },
    3,
  );
  view.emit(checkpoint);
  assert.equal(view.view().text, "old partial");
  view.emit({ ...text("new response"), seq: 4 });
  assert.equal(view.view().text, "old partialnew response");
  read.resolve(snapshot([checkpoint], 3));
  await vi.waitFor(() => assert.equal(view.view().text, "new response"));
  view.emit({ ...text(" continues"), seq: 5 });
  assert.equal(view.view().text, "new response continues");
});

test("multiple assistant responses retain their order and unrelated run while refresh is pending", async () => {
  const view = open(snapshot([], 0));
  const read = Promise.withResolvers<SessionSnapshot>();
  const followup = Promise.withResolvers<SessionSnapshot>();
  bridge.snapshot.mockReturnValueOnce(read.promise).mockReturnValueOnce(followup.promise);
  view.emit(text("first"));
  const first = commit(
    "first",
    null,
    assistant([
      { type: "text", text: "first" },
      { type: "toolCall", id: "c1", name: "bash", arguments: {} },
    ]),
    3,
  );
  view.emit(first);
  view.emit({ ...progress("c1", "first tool working"), seq: 4 });
  const one = result("c1", "first", 5);
  view.emit(one);
  view.emit({ ...text("second"), seq: 6, attempt: 2 });
  const second = commit(
    "second",
    one.item.oid,
    assistant([
      { type: "text", text: "second" },
      { type: "toolCall", id: "c2", name: "bash", arguments: {} },
    ]),
    7,
  );
  view.emit(second);
  view.emit({ ...progress("c2", "second tool working"), seq: 8 });
  const two = result("c2", "second", 9);
  view.emit(two);
  view.emit({ ...text("third"), seq: 10, attempt: 3 });
  view.emit({ ...text("other", "r2"), seq: 11 });
  assert.equal(view.view().text, "firstsecondthirdother");
  read.resolve(snapshot([first], 3));
  await vi.waitFor(() => assert.equal(bridge.snapshot.mock.calls.length, 2));
  assert.equal(view.view().text, "firstsecondthirdother");
  assert.deepEqual(view.view().tools, ["first tool working"]);
  followup.resolve(snapshot([first, one, second, two], 9));
  await vi.waitFor(() => assert.equal(queryClient.isFetching(), 0));
  assert.equal(view.view().text, "firstsecondthirdother");
  assert.deepEqual(view.view().tools, ["c1 finished", "c2 finished"]);
  view.emit({ ...text("!"), seq: 12, attempt: 3 });
  assert.equal(view.view().text, "firstsecondthird!other");
});

test("a snapshot already containing the commit acknowledges it even with an older cursor", async () => {
  const view = open(snapshot([], 0));
  view.emit(text("answer"));
  const answer = commit("answer", null, assistant([{ type: "text", text: "answer" }]), 3);
  const config = commit("config", "answer", { kind: "config", thinkingLevel: "high" }, 4);
  queryClient.setQueryData(keys.snapshot(ID), snapshot([answer, config], 2));
  bridge.snapshot.mockResolvedValue(snapshot([answer, config], 4));
  view.emit(answer);
  assert.equal(view.view().text, "answer");
  await vi.waitFor(() => assert.equal(queryClient.isFetching(), 0));
});

test("failed refresh keeps output and the watch continues through config refresh", async () => {
  const view = open(snapshot([calls], 1));
  const read = Promise.withResolvers<SessionSnapshot>();
  bridge.snapshot.mockReturnValueOnce(read.promise);
  view.emit(progress("c1", "still working"));
  const one = result("c1", "calls", 3);
  view.emit(one);
  read.reject(new Error("snapshot unavailable"));
  await vi.waitFor(() =>
    assert.equal(queryClient.getQueryState(keys.snapshot(ID))?.status, "error"),
  );
  view.emit({ ...text("stream continues"), seq: 4, attempt: 2 });
  assert.deepEqual(view.view(), { text: "stream continues", tools: ["still working", ""] });
  // Let the failed refresh drain release before requesting the next read.
  await vi.waitFor(() => assert.equal(queryClient.isFetching(), 0));
  const config = commit("config", one.item.oid, { kind: "config", thinkingLevel: "high" }, 5);
  bridge.snapshot.mockResolvedValue(snapshot([calls, one, config], 5));
  view.emit(config);
  refreshThread(ID, 5);
  await vi.waitFor(() => assert.deepEqual(view.view().tools, ["c1 finished", ""]));
  view.emit({ ...text(" after config"), seq: 6, attempt: 2 });
  assert.equal(view.view().text, "stream continues after config");
  assert.equal(bridge.watch.mock.calls.length, 1);
});

test("reconnect discards retained and uncommitted output and starts at the refreshed cursor", async () => {
  const view = open(snapshot([calls], 1));
  const failed = Promise.withResolvers<SessionSnapshot>();
  bridge.snapshot.mockReturnValueOnce(failed.promise);
  view.emit(progress("c1", "stale progress"));
  view.emit(result("c1", "calls", 3));
  view.emit({ ...text("stale text"), seq: 4, attempt: 2 });
  failed.reject(new Error("offline"));
  await vi.waitFor(() => assert.equal(queryClient.isFetching(), 0));
  bridge.snapshot.mockResolvedValue(snapshot([calls], 5));
  view.disconnect();
  await vi.waitFor(() => assert.equal(bridge.watch.mock.calls.length, 2));
  const resumed = bridge.watch.mock.calls[1]?.[0];
  assert.ok(resumed !== undefined && "afterSeq" in resumed);
  assert.equal(resumed.afterSeq, 5);
  assert.deepEqual(view.view(), { text: "", tools: ["", ""] });
  view.emit({ ...text("fresh"), seq: 6, attempt: 2 });
  assert.equal(view.view().text, "fresh");
});

test("a refreshed snapshot updates the session's run phase in the sidebar directory", async () => {
  const initial = snapshot([calls], 1);
  queryClient.setQueryData<readonly WorkspaceSessionDirectory[]>(keys.sessionDirectory, [
    { environment: "local", workspacePath: "/repo", sessions: [initial.session] },
  ]);
  open(initial);
  const running: SessionSnapshot = {
    ...initial,
    seq: 2,
    session: {
      ...initial.session,
      heads: [
        {
          head: "main",
          tip: initial.tip,
          run: {
            runId: "r1",
            head: "main",
            phase: { kind: "tools" },
            startedAt: 1_000,
            attempts: 1,
            config: {},
          },
        },
      ],
    },
  };
  bridge.snapshot.mockResolvedValue(running);
  refreshThread(ID, 2);
  await vi.waitFor(() =>
    assert.equal(
      queryClient.getQueryData<readonly WorkspaceSessionDirectory[]>(keys.sessionDirectory)?.[0]
        ?.sessions[0]?.heads[0]?.run?.phase.kind,
      "tools",
    ),
  );
});

test("a same-seq burst publishes once without losing deltas or changing tool/order identities", () => {
  const view = open(snapshot([], 0));
  view.emit(progress("c1", "working"));
  view.emit(text("start"));
  const before = view.live.getSnapshot();
  const tool = before.parts.find((part) => part.kind === "tool");
  assert.ok(tool?.kind === "tool");
  const toolProgress = tool.progress;
  let progressReads = 0;
  // Count display reads without replacing core folding or the renderer projection.
  Object.defineProperty(tool, "progress", {
    get: () => {
      progressReads += 1;
      return toolProgress;
    },
  });
  const published: string[] = [];
  cleanups.push(
    view.live.subscribe(() => {
      published.push(view.live.getSnapshot().text.get(livePartKey("r1", 1, 0)) ?? "");
    }),
  );
  for (let index = 0; index < 100; index += 1) view.enqueue(text("x"));
  assert.deepEqual(published, []);
  assert.equal(progressReads, 0);
  assert.equal(bridge.frames.size, 1);
  frame();
  assert.ok(progressReads > 0);
  assert.deepEqual(published, ["start" + "x".repeat(100)]);
  const after = view.live.getSnapshot();
  assert.equal(after, view.live.getSnapshot());
  assert.equal(after.tools, before.tools);
  assert.equal(after.order, before.order);
  assert.equal(before.text.get(livePartKey("r1", 1, 0)), "start");
});

test("synchronous reads are coherent and cached before frame notification", () => {
  const view = open(snapshot([], 0));
  view.enqueue(text("one"));
  const first = view.live.getSnapshot();
  assert.equal(first.text.get(livePartKey("r1", 1, 0)), "one");
  assert.equal(view.live.getSnapshot(), first);
  view.enqueue(text("two"));
  assert.equal(view.live.getSnapshot().text.get(livePartKey("r1", 1, 0)), "onetwo");
  assert.equal(first.text.get(livePartKey("r1", 1, 0)), "one");
  frame();
  assert.equal(view.view().text, "onetwo");
});

test("shared consumers fold each same-seq event once and only the last disposal stops the watch", () => {
  const view = open(snapshot([], 0));
  const second = watchSessionLive(ID, 99);
  cleanups.push(second.dispose);
  assert.equal(bridge.watch.mock.calls.length, 1);
  view.enqueue(text("one"));
  view.enqueue(text("two"));
  frame();
  assert.equal(second.getSnapshot().text.get(livePartKey("r1", 1, 0)), "onetwo");
  view.live.dispose();
  view.live.dispose();
  assert.equal(view.stop.mock.calls.length, 0);
  view.enqueue(text("three"));
  frame();
  assert.equal(second.getSnapshot().text.get(livePartKey("r1", 1, 0)), "onetwothree");
  view.enqueue(text("pending"));
  assert.equal(bridge.frames.size, 1);
  second.dispose();
  assert.equal(view.stop.mock.calls.length, 1);
  assert.equal(bridge.frames.size, 0);
  assert.equal(second.getSnapshot().text.size, 0);
  view.enqueue(text("late event"));
  frame();
  assert.equal(second.getSnapshot().text.size, 0);
  const reopened = watchSessionLive(ID, 10);
  cleanups.push(reopened.dispose);
  assert.equal(bridge.watch.mock.calls.length, 2);
  view.enqueue(text("fresh"));
  frame();
  assert.equal(reopened.getSnapshot().text.get(livePartKey("r1", 1, 0)), "fresh");
});

test("retained generations survive a burst and a different-head snapshot until acknowledged", async () => {
  const view = open(snapshot([], 0));
  const read = Promise.withResolvers<SessionSnapshot>();
  bridge.snapshot.mockReturnValueOnce(read.promise);
  view.emit(text("old"));
  const checkpoint = commit(
    "checkpoint-burst",
    null,
    { kind: "checkpoint", summary: "context", retainedTail: [], tokensBefore: 100 },
    3,
  );
  view.enqueue(checkpoint);
  view.enqueue(text("new"));
  frame();
  const before = view.live.getSnapshot();
  assert.equal(view.view().text, "oldnew");
  const retained = before.parts[0];
  assert.ok(retained?.kind === "text");
  const retainedText = retained.text;
  let retainedReads = 0;
  Object.defineProperty(retained, "text", {
    get: () => {
      retainedReads += 1;
      return retainedText;
    },
  });
  queryClient.setQueryData(keys.snapshot(ID), { ...snapshot([], 4), head: "other" });
  for (let index = 0; index < 20; index += 1) view.enqueue(text("!"));
  assert.equal(retainedReads, 0);
  frame();
  assert.ok(retainedReads > 0);
  assert.equal(view.view().text, "oldnew" + "!".repeat(20));
  assert.equal(view.live.getSnapshot().order, before.order);
  assert.equal(view.live.getSnapshot().tools, before.tools);
  read.resolve(snapshot([checkpoint], 3));
  await vi.waitFor(() => assert.equal(view.view().text, "new" + "!".repeat(20)));
  assert.equal(view.live.getSnapshot().order, before.order);
});

test("disposal cancels retained publication and ignores a late durable acknowledgement", async () => {
  const view = open(snapshot([], 0));
  const read = Promise.withResolvers<SessionSnapshot>();
  bridge.snapshot.mockReturnValueOnce(read.promise);
  view.emit(text("retained"));
  const answer = commit(
    "disposed-answer",
    null,
    assistant([{ type: "text", text: "retained" }]),
    3,
  );
  view.enqueue(answer);
  view.enqueue(text("successor"));
  assert.equal(view.live.getSnapshot().text.get(livePartKey("r1", 1, 0)), "retainedsuccessor");
  view.live.dispose();
  assert.equal(bridge.frames.size, 0);
  assert.equal(view.live.getSnapshot().parts.length, 0);
  read.resolve(snapshot([answer], 3));
  await vi.waitFor(() => assert.equal(queryClient.isFetching(), 0));
  assert.equal(bridge.frames.size, 0);
  assert.equal(view.live.getSnapshot().parts.length, 0);
});
