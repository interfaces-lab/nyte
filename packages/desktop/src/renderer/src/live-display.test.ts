import assert from "node:assert/strict";
import { afterAll, afterEach, test, vi } from "vitest";
import { QueryObserver } from "@tanstack/react-query";
import { sessionId } from "@nyte-ai/protocol";
import type {
  SessionEvent,
  SessionInfo,
  SessionMetadata,
  SessionSnapshot,
  TurnPart,
} from "@nyte-ai/protocol";
import type { AssistantMessage } from "@nyte-ai/schema";
import { transcriptFromCommits } from "@nyte-ai/client";
import type { NyteBridge, WorkspaceSessionDirectory } from "../../shared/ipc.ts";
import {
  loadThread,
  readSessionSnapshot,
  refreshThread,
  sessionSelection,
  warmThread,
  watchSessionLive,
} from "./live.ts";
import { livePartKey } from "./live-fold.ts";
import { keys, queryClient } from "./queries.ts";
import type { SessionPage } from "./session-directory.ts";
import { presentTool } from "./conversation/tool-detail.ts";
import { displayTranscriptParts } from "./conversation/transcript-presentation.ts";

// Only the external preload and browser clock boundaries are scripted.
const bridge = vi.hoisted(() => {
  const snapshot = vi.fn<NyteBridge["sessions"]["snapshot"]>();
  const metadata = vi.fn<NyteBridge["sessions"]["metadata"]>();
  const watch = vi.fn<NyteBridge["watch"]>();
  const frames = new Map<number, FrameRequestCallback>();
  let nextFrame = 0;
  vi.stubGlobal("window", {
    nyte: { sessions: { snapshot, metadata }, watch },
    requestAnimationFrame: (callback: FrameRequestCallback) => {
      nextFrame += 1;
      frames.set(nextFrame, callback);
      return nextFrame;
    },
    cancelAnimationFrame: (id: number) => frames.delete(id),
    setTimeout: (callback: () => void, delay: number) => Number(setTimeout(callback, delay)),
    clearTimeout: (timer: number) => clearTimeout(timer),
  });
  // The trust prompt dismisses a toast, and sonner schedules that on the bare
  // global rather than on the window the renderer reads.
  vi.stubGlobal("requestAnimationFrame", (callback: FrameRequestCallback) => {
    callback(0);
    return 0;
  });
  return { snapshot, metadata, watch, frames };
});

type CommitEvent = Extract<SessionEvent, { kind: "commit" }>;
const ID = sessionId("live-display");
/** The observer's own wait before it reads again after a failure. */
const RETRY_MS = 1_000;
const cleanups: (() => void)[] = [];

function frame(): void {
  const callbacks = [...bridge.frames.values()];
  bridge.frames.clear();
  for (const callback of callbacks) callback(0);
}

/** Events cross the push-to-pull adapter on the microtask queue; let the fold catch up. */
function folded(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

afterEach(async () => {
  for (const cleanup of cleanups.splice(0)) cleanup();
  vi.useRealTimers();
  await queryClient.cancelQueries();
  queryClient.clear();
  frame();
  bridge.snapshot.mockReset();
  bridge.metadata.mockReset();
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

function metadataOf(current: SessionSnapshot): SessionMetadata {
  return {
    session: current.session,
    head: current.head,
    config: current.config,
    context: current.context,
  };
}

function text(delta: string, runId = "r1"): Extract<SessionEvent, { kind: "text_delta" }> {
  return { kind: "text_delta", seq: 2, runId, attempt: 1, index: 0, delta };
}

function progress(callId: string, value: string): SessionEvent {
  return { kind: "tool_progress", seq: 2, runId: "r1", callId, progress: { text: value } };
}

function running(phase: Extract<SessionEvent, { kind: "run" }>["run"]["phase"], seq: number) {
  return {
    kind: "run",
    seq,
    head: "main",
    run: { runId: "r1", head: "main", phase, config: {}, attempts: 1, startedAt: 1 },
  } satisfies SessionEvent;
}

function durable(): SessionSnapshot {
  const cached = queryClient.getQueryData<SessionSnapshot>(keys.snapshot(ID));
  assert.ok(cached);
  return cached;
}

/** The observer reads `initial`, then the watch it opens from that seq takes the scripted events. */
async function open(initial: SessionSnapshot) {
  bridge.snapshot.mockResolvedValueOnce(initial);
  bridge.metadata.mockResolvedValue(metadataOf(initial));
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
  // The snapshot query reads through the same observer the live view holds.
  const observer = new QueryObserver<SessionSnapshot>(queryClient, {
    queryKey: keys.snapshot(ID),
    queryFn: ({ signal }) => readSessionSnapshot(ID, signal),
  });
  cleanups.push(observer.subscribe(() => {}));
  const live = watchSessionLive(ID);
  let displayed = live.getSnapshot();
  cleanups.push(
    live.dispose,
    live.subscribe(() => {
      displayed = live.getSnapshot();
    }),
  );
  await vi.waitFor(() => assert.equal(connections.length, 1));

  return {
    live,
    stop,
    connections,
    /** Several events at once arrive as the projection yields a batch: back to back, one fold behind them. */
    enqueue: async (...events: readonly SessionEvent[]) => {
      const connection = connections.at(-1);
      assert.ok(connection);
      for (const event of events) connection.event(event);
      await folded();
    },
    emit: async (...events: readonly SessionEvent[]) => {
      const connection = connections.at(-1);
      assert.ok(connection);
      for (const event of events) connection.event(event);
      await folded();
      frame();
    },
    disconnect: () => {
      const connection = connections.at(-1);
      assert.ok(connection);
      connection.end?.(new Error("watch disconnected"));
    },
    view: () => {
      frame();
      const parts = durable().transcript.flatMap((turn) =>
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

function observeRefreshes(queryKey: readonly unknown[]) {
  const read = vi.fn(async () => "refreshed");
  const observer = new QueryObserver(queryClient, {
    queryKey,
    queryFn: read,
    initialData: "cached",
  });
  cleanups.push(observer.subscribe(() => {}));
  return read;
}

test("queue, name, and run events fold locally and reread only session metadata", async () => {
  const initial = snapshot([], 0);
  const view = await open(initial);
  const vcs = observeRefreshes(keys.vcsSnapshot);
  const mentions = observeRefreshes(keys.mentionFiles);
  await view.emit({
    kind: "queued",
    seq: 1,
    head: "main",
    item: { change: "queued", lane: "steer", content: "hello", at: 1 },
  });
  assert.deepEqual(
    durable().pending.map((item) => item.change),
    ["queued"],
  );
  await view.emit({ kind: "fact", seq: 2, key: "name", value: "Renamed" });
  await view.emit(running({ kind: "respond" }, 3));
  assert.equal(durable().run?.phase.kind, "respond");
  await view.emit({ kind: "queue_cancelled", seq: 4, change: "queued" });
  assert.deepEqual(durable().pending, []);
  await vi.waitFor(() => assert.equal(queryClient.isFetching(), 0));
  assert.equal(bridge.snapshot.mock.calls.length, 1);
  assert.ok(bridge.metadata.mock.calls.length >= 1);
  assert.equal(vcs.mock.calls.length, 0);
  assert.equal(mentions.mock.calls.length, 0);
});

test("tool progress does not refetch every delegated child's snapshot", async () => {
  const view = await open(snapshot([], 0));
  const children = observeRefreshes(keys.children(ID));
  for (let index = 0; index < 100; index += 1) await view.enqueue(progress("c1", String(index)));
  frame();
  assert.equal(children.mock.calls.length, 0);
  assert.equal(bridge.snapshot.mock.calls.length, 1);
  assert.equal(bridge.metadata.mock.calls.length, 0);
  assert.equal(view.live.getSnapshot().tools.get("c1")?.progress.text, "99");
});

test("plugin facts refresh settings while effect intents only refresh child discovery", async () => {
  const view = await open(snapshot([], 0));
  const settings = observeRefreshes(keys.pluginSettings(ID));
  const children = observeRefreshes(keys.children(ID));
  await view.emit({ kind: "fact", seq: 1, key: "plugin/settings/theme", value: "dark" });
  await view.emit({
    kind: "effect",
    seq: 2,
    runId: "r1",
    callId: "c1",
    state: "intent",
    tool: "task",
    args: {},
  });
  await vi.waitFor(() => assert.equal(queryClient.isFetching(), 0));
  assert.equal(bridge.snapshot.mock.calls.length, 1);
  assert.equal(settings.mock.calls.length, 1);
  assert.equal(children.mock.calls.length, 1);
});

test("failed tool results and terminal runs still refresh files they may have written", async () => {
  const view = await open(snapshot([calls], 1));
  const vcs = observeRefreshes(keys.vcsSnapshot);
  const mentions = observeRefreshes(keys.mentionFiles);
  const failed = commit(
    "failed-tool",
    calls.item.oid,
    {
      kind: "message",
      message: {
        role: "toolResult",
        toolCallId: "c1",
        toolName: "bash",
        content: [{ type: "text", text: "wrote a file then failed" }],
        isError: true,
        timestamp: 2,
      },
    },
    2,
  );
  await view.emit({
    kind: "head_moved",
    seq: 2,
    head: "main",
    from: calls.item.oid,
    to: failed.item.oid,
    reason: "tools",
  });
  await view.emit(failed);
  await vi.waitFor(() => assert.equal(queryClient.isFetching(), 0));
  assert.equal(vcs.mock.calls.length, 1);
  assert.equal(mentions.mock.calls.length, 1);
  assert.deepEqual(view.view().tools, ["wrote a file then failed", ""]);

  let seq = 2;
  for (const phase of [
    { kind: "done" },
    { kind: "aborted" },
    { kind: "failed", error: "process failed" },
  ] as const) {
    seq += 1;
    await view.emit(running(phase, seq));
    await vi.waitFor(() => assert.equal(queryClient.isFetching(), 0));
  }
  assert.equal(vcs.mock.calls.length, 4);
  assert.equal(mentions.mock.calls.length, 4);
  assert.equal(bridge.snapshot.mock.calls.length, 1);
});

test("rewinding a head takes a fresh snapshot, which carries its changed files", async () => {
  const view = await open(snapshot([calls], 1));
  bridge.snapshot.mockResolvedValue(snapshot([], 2));
  await view.emit({
    kind: "head_moved",
    seq: 2,
    head: "main",
    from: calls.item.oid,
    to: null,
    reason: "reset",
  });
  await vi.waitFor(() => assert.deepEqual(durable().transcript, []));
  await vi.waitFor(() => assert.equal(queryClient.isFetching(), 0));
  assert.equal(bridge.snapshot.mock.calls.length, 2);
  await vi.waitFor(() => assert.equal(view.connections.length, 2));
  const resumed = bridge.watch.mock.calls[1]?.[0];
  assert.ok(resumed !== undefined && "afterSeq" in resumed);
  assert.equal(resumed.afterSeq, 2);
});

test("a head move followed by its commits needs no snapshot, and a replayed tip is a no-op", async () => {
  const view = await open(snapshot([calls], 1));
  const one = result("c1", calls.item.oid, 2);
  const two = result("c2", one.item.oid, 2);
  await view.emit(
    {
      kind: "head_moved",
      seq: 2,
      head: "main",
      from: calls.item.oid,
      to: two.item.oid,
      reason: "tools",
    },
    one,
    two,
  );
  await vi.waitFor(() => assert.equal(queryClient.isFetching(), 0));
  assert.equal(bridge.snapshot.mock.calls.length, 1);
  assert.deepEqual(view.view().tools, ["c1 finished", "c2 finished"]);
  await view.emit(two);
  assert.equal(bridge.snapshot.mock.calls.length, 1);
  assert.equal(durable().tip, two.item.oid);
});

test("a snapshot whose transcript is ahead of its cursor accepts the replayed commit", async () => {
  const answer = commit("answer", null, assistant([{ type: "text", text: "answer" }]), 3);
  const view = await open({ ...snapshot([answer], 3), seq: 0 });
  await view.emit(answer);
  assert.equal(view.view().text, "answer");
  assert.equal(bridge.snapshot.mock.calls.length, 1);
  await view.emit({ ...text(" more"), seq: 4, attempt: 2 });
  assert.equal(view.view().text, "answer more");
});

test("manual refreshes reread workspace changes and take one fresh snapshot", async () => {
  const initial = snapshot([], 1);
  await open(initial);
  const vcs = observeRefreshes(keys.vcsSnapshot);
  const mentions = observeRefreshes(keys.mentionFiles);
  bridge.snapshot.mockResolvedValue({ ...initial, seq: 3 });
  refreshThread(ID);
  await vi.waitFor(() => assert.equal(durable().seq, 3));
  await vi.waitFor(() => assert.equal(queryClient.isFetching(), 0));
  assert.equal(bridge.snapshot.mock.calls.length, 2);
  // Once for the command that had no event, once for the rebase its read forces.
  assert.equal(vcs.mock.calls.length, 2);
  assert.equal(mentions.mock.calls.length, 2);
});

test("an assistant commit settles its streamed text and the transcript row in one update", async () => {
  const view = await open(snapshot([], 0));
  await view.emit(text("answer"));
  assert.equal(view.view().text, "answer");
  assert.equal(view.live.getSnapshot().text.size, 1);
  const answer = commit("answer", null, assistant([{ type: "text", text: "answer" }]), 3);
  await view.enqueue(answer);
  // The cache already holds the row while the overlay, read from the same state, no longer does.
  assert.equal(durable().tip, "answer");
  assert.equal(view.live.getSnapshot().text.size, 0);
  assert.equal(view.view().text, "answer");
  await view.emit({ ...text(" continues"), seq: 4, attempt: 2 });
  assert.equal(view.view().text, "answer continues");
  assert.equal(bridge.snapshot.mock.calls.length, 1);
});

test("a commit the transcript cannot append keeps the overlay until the fresh snapshot lands", async () => {
  const view = await open(snapshot([calls], 1));
  const read = Promise.withResolvers<SessionSnapshot>();
  bridge.snapshot.mockReturnValueOnce(read.promise);
  await view.emit(progress("c1", "still working"));
  await view.emit(progress("c2", "second working"));
  const one = result("c1", calls.item.oid, 3);
  const two = result("c2", one.item.oid, 3);
  // The second result arrived without the first: only a snapshot can place it.
  await view.emit(two);
  assert.deepEqual(view.view().tools, ["still working", "second working"]);
  await vi.waitFor(() => assert.equal(bridge.snapshot.mock.calls.length, 2));
  assert.equal(view.stop.mock.calls.length, 1);
  assert.deepEqual(view.view().tools, ["still working", "second working"]);
  read.resolve(snapshot([calls, one, two], 3));
  await vi.waitFor(() =>
    assert.deepEqual(view.view(), { text: "", tools: ["c1 finished", "c2 finished"] }),
  );
  await vi.waitFor(() => assert.equal(view.connections.length, 2));
  const resumed = bridge.watch.mock.calls[1]?.[0];
  assert.ok(resumed !== undefined && "afterSeq" in resumed);
  assert.equal(resumed.afterSeq, 3);
  await view.emit({ ...text("next response"), seq: 4, attempt: 2 });
  assert.equal(view.view().text, "next response");
});

test("a fold-forced rebase reconciles what its dropped events would have, and bootstrap does not", async () => {
  const vcs = observeRefreshes(keys.vcsSnapshot);
  const mentions = observeRefreshes(keys.mentionFiles);
  const jobs = observeRefreshes(keys.jobs(ID));
  const children = observeRefreshes(keys.children(ID));
  const settings = observeRefreshes(keys.pluginSettings(ID));
  const customize = observeRefreshes(["customize", ID]);
  const catalog = observeRefreshes(keys.pluginCatalog);
  const reconciled = () =>
    [vcs, mentions, jobs, children, settings, customize, catalog].map(
      (read) => read.mock.calls.length,
    );

  const view = await open(snapshot([calls], 1));
  await vi.waitFor(() => assert.equal(queryClient.isFetching(), 0));
  // The read that starts the observation changed nothing under a reader.
  assert.deepEqual(reconciled(), [0, 0, 0, 0, 0, 0, 0]);

  const one = result("c1", calls.item.oid, 3);
  const two = result("c2", one.item.oid, 3);
  const repaired = snapshot([calls, one, two], 3);
  // The folder lost trust meanwhile: only this read carries the activation,
  // and a prompt that throws would take the invalidations below with it.
  bridge.snapshot.mockResolvedValueOnce({
    ...repaired,
    session: {
      ...repaired.session,
      activation: { kind: "requires", requirement: { kind: "workspace_trust", cwd: "/repo" } },
    },
  });
  // The second result arrives without the first: the fold gives up and the
  // watch goes with it, so nothing reports the tool that wrote files, the
  // settings a reply changed, or the children a commit spawned.
  await view.emit(two);
  await vi.waitFor(() => assert.deepEqual(reconciled(), [1, 1, 1, 1, 1, 1, 1]));
  assert.equal(bridge.snapshot.mock.calls.length, 2);
  assert.deepEqual(view.view().tools, ["c1 finished", "c2 finished"]);
});

test("a failed snapshot keeps the output on screen and is retried until it lands", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const view = await open(snapshot([calls], 1));
  bridge.snapshot.mockRejectedValueOnce(new Error("snapshot unavailable"));
  await view.emit(progress("c1", "still working"));
  const one = result("c1", calls.item.oid, 3);
  const two = result("c2", one.item.oid, 3);
  await view.emit(two);
  await vi.waitFor(() => assert.equal(bridge.snapshot.mock.calls.length, 2));
  assert.deepEqual(view.view().tools, ["still working", ""]);
  bridge.snapshot.mockResolvedValue(snapshot([calls, one, two], 3));
  await vi.advanceTimersByTimeAsync(RETRY_MS);
  await vi.waitFor(() => assert.deepEqual(view.view().tools, ["c1 finished", "c2 finished"]));
  assert.equal(bridge.snapshot.mock.calls.length, 3);
  await vi.waitFor(() => assert.equal(view.connections.length, 2));
});

test("a watch that ends resumes from a fresh snapshot's cursor and discards uncommitted output", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const view = await open(snapshot([calls], 1));
  await view.emit(progress("c1", "stale progress"));
  await view.emit({ ...text("stale text"), seq: 4, attempt: 2 });
  assert.equal(view.view().text, "stale text");
  bridge.snapshot.mockResolvedValue(snapshot([calls], 5));
  view.disconnect();
  // The failed subscription is released before the next one opens.
  await vi.waitFor(() => assert.equal(view.stop.mock.calls.length, 1));
  await vi.advanceTimersByTimeAsync(RETRY_MS);
  await vi.waitFor(() => assert.equal(view.connections.length, 2));
  const resumed = bridge.watch.mock.calls[1]?.[0];
  assert.ok(resumed !== undefined && "afterSeq" in resumed);
  assert.equal(resumed.afterSeq, 5);
  assert.deepEqual(view.view(), { text: "", tools: ["", ""] });
  await view.emit({ ...text("fresh"), seq: 6, attempt: 2 });
  assert.equal(view.view().text, "fresh");
});

test("a watch that dies and resumes on the same cursor reconciles nothing", async () => {
  vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
  const vcs = observeRefreshes(keys.vcsSnapshot);
  const mentions = observeRefreshes(keys.mentionFiles);
  const settled = snapshot([calls], 1);
  const view = await open(settled);
  await vi.waitFor(() => assert.equal(queryClient.isFetching(), 0));
  assert.deepEqual([vcs.mock.calls.length, mentions.mock.calls.length], [0, 0]);

  // The stream drops with no work behind it, so every retry re-reads the same
  // cursor. Reacting to those would rescan the workspace once a second for as
  // long as the stream stays down, and each scan cancels the one before it.
  bridge.snapshot.mockResolvedValue(settled);
  for (let attempt = 1; attempt <= 3; attempt += 1) {
    view.disconnect();
    await vi.advanceTimersByTimeAsync(RETRY_MS);
    await vi.waitFor(() => assert.equal(view.connections.length, attempt + 1));
  }
  assert.deepEqual([vcs.mock.calls.length, mentions.mock.calls.length], [0, 0]);

  // Work that landed while the stream was down did go unseen, and is owed.
  const landed = result("c1", calls.item.oid, 2);
  bridge.snapshot.mockResolvedValue(snapshot([calls, landed], 2));
  view.disconnect();
  await vi.advanceTimersByTimeAsync(RETRY_MS);
  await vi.waitFor(() =>
    assert.deepEqual([vcs.mock.calls.length, mentions.mock.calls.length], [1, 1]),
  );
});

test("a metadata read after a run event updates the session's phase in the sidebar directory", async () => {
  const initial = snapshot([calls], 1);
  queryClient.setQueryData<readonly WorkspaceSessionDirectory[]>(keys.sessionDirectory, [
    { environment: "local", workspacePath: "/repo", sessions: [initial.session] },
  ]);
  const view = await open(initial);
  const busy: SessionSnapshot = {
    ...initial,
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
  bridge.metadata.mockResolvedValue(metadataOf(busy));
  await view.emit(running({ kind: "tools" }, 2));
  await vi.waitFor(() =>
    assert.equal(
      queryClient.getQueryData<readonly WorkspaceSessionDirectory[]>(keys.sessionDirectory)?.[0]
        ?.sessions[0]?.heads[0]?.run?.phase.kind,
      "tools",
    ),
  );
  assert.equal(bridge.snapshot.mock.calls.length, 1);
});

test("a fresh session row repairs stale rows in the directory and preview", async () => {
  const initial = snapshot([calls], 1);
  const current = { ...initial.session, name: "New title" };
  const view = await open(initial);
  queryClient.setQueryData(keys.sessionPreview, { items: [initial.session] });
  queryClient.setQueryData<readonly WorkspaceSessionDirectory[]>(keys.sessionDirectory, [
    { environment: "local", workspacePath: "/repo", sessions: [initial.session] },
  ]);
  bridge.metadata.mockResolvedValue(metadataOf({ ...initial, session: current }));
  await view.emit({ kind: "fact", seq: 2, key: "name", value: "New title" });
  assert.equal(
    queryClient.getQueryData<readonly WorkspaceSessionDirectory[]>(keys.sessionDirectory)?.[0]
      ?.sessions[0]?.name,
    "New title",
  );
  assert.equal(
    queryClient.getQueryData<SessionPage>(keys.sessionPreview)?.items[0]?.name,
    "New title",
  );
  await vi.waitFor(() => assert.equal(queryClient.isFetching(), 0));
  assert.equal(queryClient.getQueryData<SessionInfo>(keys.session(ID))?.name, "New title");
});

test("a same-seq burst publishes once without losing deltas or changing tool/order identities", async () => {
  const view = await open(snapshot([], 0));
  await view.emit(progress("c1", "working"));
  await view.emit(text("start"));
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
  for (let index = 0; index < 100; index += 1) await view.enqueue(text("x"));
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

test("synchronous reads are coherent and cached before frame notification", async () => {
  const view = await open(snapshot([], 0));
  await view.enqueue(text("one"));
  const first = view.live.getSnapshot();
  assert.equal(first.text.get(livePartKey("r1", 1, 0)), "one");
  assert.equal(view.live.getSnapshot(), first);
  await view.enqueue(text("two"));
  assert.equal(view.live.getSnapshot().text.get(livePartKey("r1", 1, 0)), "onetwo");
  assert.equal(first.text.get(livePartKey("r1", 1, 0)), "one");
  frame();
  assert.equal(view.view().text, "onetwo");
});

test("shared consumers share one observer and only the last disposal stops the watch", async () => {
  const view = await open(snapshot([], 0));
  const second = watchSessionLive(ID);
  cleanups.push(second.dispose);
  assert.equal(bridge.watch.mock.calls.length, 1);
  assert.equal(bridge.snapshot.mock.calls.length, 1);
  await view.enqueue(text("one"));
  await view.enqueue(text("two"));
  frame();
  assert.equal(second.getSnapshot().text.get(livePartKey("r1", 1, 0)), "onetwo");
  view.live.dispose();
  view.live.dispose();
  assert.equal(view.stop.mock.calls.length, 0);
  await view.enqueue(text("three"));
  frame();
  assert.equal(second.getSnapshot().text.get(livePartKey("r1", 1, 0)), "onetwothree");
  await view.enqueue(text("pending"));
  assert.equal(bridge.frames.size, 1);
  second.dispose();
  assert.equal(view.stop.mock.calls.length, 1);
  assert.equal(bridge.frames.size, 0);
  assert.equal(second.getSnapshot().text.size, 0);
  await view.enqueue(text("late event"));
  frame();
  assert.equal(second.getSnapshot().text.size, 0);
  bridge.snapshot.mockResolvedValueOnce(snapshot([], 10));
  const reopened = watchSessionLive(ID);
  cleanups.push(reopened.dispose);
  await vi.waitFor(() => assert.equal(view.connections.length, 2));
  const resumed = bridge.watch.mock.calls[1]?.[0];
  assert.ok(resumed !== undefined && "afterSeq" in resumed);
  assert.equal(resumed.afterSeq, 10);
  await view.enqueue(text("fresh"));
  frame();
  assert.equal(reopened.getSnapshot().text.get(livePartKey("r1", 1, 0)), "fresh");
});

test("disposal clears the overlay and ignores a read that lands afterwards", async () => {
  const view = await open(snapshot([calls], 1));
  const read = Promise.withResolvers<SessionSnapshot>();
  bridge.snapshot.mockReturnValueOnce(read.promise);
  await view.emit(text("retained"));
  const one = result("c1", calls.item.oid, 3);
  await view.enqueue(result("c2", one.item.oid, 3));
  await vi.waitFor(() => assert.equal(bridge.snapshot.mock.calls.length, 2));
  assert.equal(view.live.getSnapshot().text.get(livePartKey("r1", 1, 0)), "retained");
  view.live.dispose();
  assert.equal(bridge.frames.size, 0);
  assert.equal(view.live.getSnapshot().parts.length, 0);
  read.resolve(snapshot([calls, one], 3));
  await vi.waitFor(() => assert.equal(queryClient.isFetching(), 0));
  assert.equal(bridge.frames.size, 0);
  assert.equal(view.live.getSnapshot().parts.length, 0);
  assert.equal(view.connections.length, 1);
});

test("a query read answers from the running observer, and a failed first read is the query's own", async () => {
  const view = await open(snapshot([], 0));
  const read = await readSessionSnapshot(ID, new AbortController().signal);
  assert.equal(read.seq, 0);
  assert.equal(bridge.snapshot.mock.calls.length, 1);
  view.live.dispose();
  await vi.waitFor(() => assert.equal(queryClient.isFetching(), 0));
  bridge.snapshot.mockRejectedValueOnce(new Error("offline"));
  await assert.rejects(readSessionSnapshot(ID, new AbortController().signal), /offline/u);
  // Nothing observes the session after the failed read, so no stale watch and no retry.
  assert.equal(bridge.watch.mock.calls.length, 1);
  assert.equal(bridge.snapshot.mock.calls.length, 2);
});

test("cancelling a query read releases the observation before its slow read lands", async () => {
  const read = Promise.withResolvers<SessionSnapshot>();
  bridge.snapshot.mockReturnValueOnce(read.promise);
  const observer = new QueryObserver<SessionSnapshot>(queryClient, {
    queryKey: keys.snapshot(ID),
    queryFn: ({ signal }) => readSessionSnapshot(ID, signal),
  });
  cleanups.push(observer.subscribe(() => {}));
  await vi.waitFor(() => assert.equal(bridge.snapshot.mock.calls.length, 1));
  // The session is closed or deleted: its query goes, and the read with it.
  queryClient.removeQueries({ queryKey: keys.snapshot(ID), exact: true });
  read.resolve(snapshot([calls], 3));
  await vi.waitFor(() => assert.equal(queryClient.isFetching(), 0));
  assert.equal(queryClient.getQueryData(keys.snapshot(ID)), undefined);
  assert.equal(bridge.watch.mock.calls.length, 0);
});

test("warming a thread is one passive read that opens no watch", async () => {
  bridge.snapshot.mockResolvedValueOnce(snapshot([calls], 4));
  await warmThread(ID);
  assert.equal(durable().seq, 4);
  await vi.waitFor(() => assert.equal(queryClient.isFetching(), 0));
  assert.equal(bridge.snapshot.mock.calls.length, 1);
  assert.equal(bridge.watch.mock.calls.length, 0);
});

test("warming reads nothing while the directory row still matches the cached snapshot", async () => {
  const cached = snapshot([calls], 4);
  bridge.snapshot.mockResolvedValueOnce(cached);
  await warmThread(ID);
  vi.useFakeTimers();
  vi.advanceTimersByTime(60_000);
  queryClient.setQueryData(keys.session(ID), cached.session);
  await warmThread(ID);
  assert.equal(bridge.snapshot.mock.calls.length, 1);

  // Activity elsewhere moved the tip: the row disagrees, so the next intent reads again.
  const moved = snapshot([calls, result("c1", "calls", 5)], 5);
  queryClient.setQueryData(keys.session(ID), { ...moved.session, lastActivityAt: 5 });
  bridge.snapshot.mockResolvedValueOnce(moved);
  await warmThread(ID);
  assert.equal(bridge.snapshot.mock.calls.length, 2);
  assert.equal(durable().seq, 5);
});

test("loadThread forces one fresh read whose result the cache holds when it resolves", async () => {
  const view = await open(snapshot([], 0));
  bridge.snapshot.mockResolvedValueOnce(snapshot([calls], 7));
  const fresh = await loadThread(ID);
  assert.equal(fresh.seq, 7);
  assert.equal(durable().seq, 7);
  assert.equal(bridge.snapshot.mock.calls.length, 2);
  await vi.waitFor(() => assert.equal(view.connections.length, 2));
});

test("acknowledging a selection waits for a read at that version before releasing the choice", async () => {
  const initial = snapshot([], 0);
  await open(initial);
  const selection = sessionSelection(ID);
  selection.request();
  const chosen: SessionSnapshot = {
    ...initial,
    session: { ...initial.session, config: { thinkingLevel: "high" } },
  };
  const read = Promise.withResolvers<SessionMetadata>();
  bridge.metadata.mockReturnValueOnce(read.promise);
  let acknowledged = false;
  const acknowledging = selection.acknowledge().then(() => {
    acknowledged = true;
  });
  await vi.waitFor(() => assert.equal(bridge.metadata.mock.calls.length, 1));
  assert.equal(acknowledged, false);
  read.resolve(metadataOf(chosen));
  await acknowledging;
  assert.deepEqual(durable().session.config, { thinkingLevel: "high" });
  assert.equal(bridge.snapshot.mock.calls.length, 1);
});
