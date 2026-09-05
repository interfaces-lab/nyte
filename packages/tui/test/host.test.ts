/**
 * The host layer end to end: a Nyte over a temp SQLite store with a scripted
 * provider, driven through the same outbox and follower the shell uses. A
 * send, a queued follow-up, a cancel, and a go-back, watched as the shell
 * would watch them.
 */
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "vitest";
import { createNyteModels } from "@nyte-ai/ai";
import { WorkspaceTrustStore } from "@nyte-ai/core";
import type { SessionId } from "@nyte-ai/core";
import type { Host } from "../src/host.ts";
import { laneRoles } from "../src/lanes.ts";
import { Outbox } from "../src/outbox.ts";
import { resolveWorkspacePlugins } from "../src/plugins.ts";
import { printRun } from "../src/print.ts";
import { SessionFollower } from "../src/session-follow.ts";
import type { SessionState } from "../src/session-state.ts";
import { echo, gate, model, openHost, untilState, within } from "./helpers.ts";

interface Followed {
  readonly follower: SessionFollower;
  readonly current: () => SessionState | undefined;
  readonly subscribe: (listener: (state: SessionState) => void) => () => void;
  readonly outbox: Outbox;
}

function follow(host: Host, sessionId: SessionId): Followed {
  const listeners = new Set<(state: SessionState) => void>();
  const follower = new SessionFollower(host.nyte, {
    sessionId,
    onUpdate: ({ state }) => {
      for (const listener of listeners) listener(state);
    },
    retryMs: 10,
  });
  const outbox = new Outbox({
    send: (input) => host.nyte.messages.send({ sessionId, ...input }),
    sleep: async () => undefined,
  });
  return {
    follower,
    outbox,
    current: () => follower.state,
    subscribe: (listener) => {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

function lines(state: SessionState): string[] {
  return state.transcript.items.flatMap((turn) =>
    turn.kind === "turn"
      ? turn.parts.map((part) =>
          part.kind === "user"
            ? `user:${Array.isArray(part.content) ? "…" : part.content}`
            : part.kind === "assistant"
              ? `assistant:${part.text}`
              : part.kind,
        )
      : [turn.kind],
  );
}

test("a send lands, streams into the overlay, and settles into the transcript the follower holds", async () => {
  const host = await openHost();
  const { sessionId } = await host.nyte.sessions.create({ name: "room" });
  const detach = host.attach();
  const followed = follow(host, sessionId);
  const { follower, outbox } = followed;
  try {
    const first = await follower.start();
    assert.equal(first.info.name, "room");
    assert.deepEqual(first.transcript.items, []);

    const streamed = untilState(followed, (state) =>
      state.overlay.some((part) => part.kind === "text"),
    );
    const receipt = await outbox.submit({
      content: "hello",
      lane: laneRoles(host.nyte.landing).steer,
    });
    assert.equal(receipt.kind, "durable");
    assert.equal((await streamed).run?.phase.kind, "respond");

    const settled = await untilState(
      followed,
      (state) => state.run?.phase.kind === "done" && state.overlay.length === 0,
    );
    assert.deepEqual(lines(settled), ["user:hello", "assistant:saw 1"]);
    assert.deepEqual(settled.pending, []);
    assert.deepEqual(outbox.entries, []);
  } finally {
    follower.close();
    detach();
  }
});

test("a follow-up queued during a run waits, can be taken back, and the cancel shows in the gutter", async () => {
  const hold = gate();
  const host = await openHost(echo({ gate: hold }));
  const { sessionId } = await host.nyte.sessions.create();
  const detach = host.attach();
  const followed = follow(host, sessionId);
  const { follower, outbox } = followed;
  const roles = laneRoles(host.nyte.landing);
  try {
    await follower.start();
    await outbox.submit({ content: "first", lane: roles.steer });
    await untilState(followed, (state) => state.overlay.length > 0);

    const later = await outbox.submit({ content: "later", lane: roles.queue });
    const mistake = await outbox.submit({ content: "mistake", lane: roles.queue });
    assert.ok(later.kind === "durable" && mistake.kind === "durable");
    const queued = await untilState(followed, (state) => state.pending.length === 2);
    // Two submissions in one millisecond order by oid, so compare the set, not the order.
    assert.deepEqual(
      queued.pending
        .map((item) => `${item.lane}:${Array.isArray(item.content) ? "…" : item.content}`)
        .toSorted((left, right) => left.localeCompare(right)),
      [`${roles.queue}:later`, `${roles.queue}:mistake`],
    );
    assert.deepEqual(
      queued.pending.map((item) => item.change),
      (await host.nyte.messages.pending({ sessionId })).map((item) => item.change),
      "the fold orders pending the way the store does",
    );

    const cancelled = await host.nyte.messages.cancel({ sessionId, change: mistake.change });
    assert.deepEqual(cancelled, { kind: "cancelled" });
    const one = await untilState(followed, (state) => state.pending.length === 1);
    assert.equal(one.pending[0]?.content, "later");

    hold.release();
    const done = await untilState(
      followed,
      (state) =>
        state.pending.length === 0 &&
        lines(state).filter((line) => line.startsWith("user:")).length === 2 &&
        state.run?.phase.kind === "done",
    );
    assert.deepEqual(
      lines(done).filter((line) => line.startsWith("user:")),
      ["user:first", "user:later"],
    );
  } finally {
    hold.release();
    follower.close();
    detach();
  }
});

test("the follower keeps live inputs and streamed text, then picks up the next idle configuration", async () => {
  const finish = gate();
  const host = await openHost(echo({ gate: finish }));
  const { sessionId } = await host.nyte.sessions.create();
  const detach = host.attach();
  const followed = follow(host, sessionId);
  try {
    await followed.follower.start();
    const streaming = untilState(followed, (state) => state.overlay.length > 0);
    await host.nyte.messages.send({ sessionId, content: "keep going" });
    const live = await streaming;
    assert.deepEqual(live.config, {
      model: { provider: model.provider, id: model.id },
      thinkingLevel: "off",
    });
    assert.equal(live.overlay[0]?.kind, "text");
    await host.nyte.sessions.configure({ sessionId, thinkingLevel: "high" });
    assert.deepEqual(followed.current()?.config, live.config);
    finish.release();
    const idle = await untilState(
      followed,
      (state) =>
        state.run?.phase.kind === "done" &&
        state.config.thinkingLevel === "high" &&
        state.transcript.items.some((item) => item.kind === "config"),
    );
    assert.deepEqual(idle.config, (await host.nyte.sessions.snapshot({ sessionId }))?.config);
    assert.deepEqual(lines(idle), ["user:keep going", "assistant:saw 1", "config"]);
    assert.deepEqual(idle.overlay, []);
  } finally {
    finish.release();
    followed.follower.close();
    detach();
  }
});

test("going back to a sent message refolds the transcript from a fresh snapshot and hands the text back", async () => {
  const host = await openHost();
  const { sessionId } = await host.nyte.sessions.create();
  const detach = host.attach();
  const followed = follow(host, sessionId);
  const { follower, outbox } = followed;
  const roles = laneRoles(host.nyte.landing);
  try {
    await follower.start();
    await outbox.submit({ content: "first", lane: roles.steer });
    await untilState(followed, (state) => state.run?.phase.kind === "done");
    await outbox.submit({ content: "second", lane: roles.steer });
    const two = await untilState(followed, (state) => lines(state).length === 4);
    const second = two.transcript.items[1];
    assert.ok(second?.kind === "turn");
    const sent = second.parts[0];
    assert.ok(sent?.kind === "user");

    const moved = await host.nyte.heads.move({ sessionId, to: sent.commit });
    assert.equal(moved.kind, "moved");
    if (moved.kind === "moved") assert.equal(moved.restored?.content, "second");
    const back = await untilState(
      followed,
      (state) =>
        state.transcript.tip === sent.parent &&
        (state.run === undefined || ["done", "aborted", "failed"].includes(state.run.phase.kind)),
    );
    assert.deepEqual(lines(back), ["user:first", "assistant:saw 1"]);

    // The head is where the user put it; a new message starts a branch there.
    await outbox.submit({ content: "instead", lane: roles.steer });
    const branched = await untilState(followed, (state) => lines(state).length === 4);
    assert.deepEqual(lines(branched).at(-2), "user:instead");
    const commits = await host.sessionCommits(sessionId);
    assert.equal(commits.filter((item) => item.commit.body.kind === "message").length, 6);
  } finally {
    follower.close();
    detach();
  }
});

test("print mode streams the answer, names the tool calls, and reports the run's end", async () => {
  const host = await openHost();
  const { sessionId } = await host.nyte.sessions.create();
  const detach = host.attach();
  const written: string[] = [];
  try {
    const outcome = await within(
      printRun({
        nyte: host.nyte,
        sessionId,
        content: "hello",
        json: false,
        quiet: false,
        output: { write: (text) => void written.push(text), error: () => undefined },
      }),
    );
    assert.deepEqual(outcome, { kind: "completed" });
    assert.equal(written.join(""), "saw 1\n");
    const usage = await host.workspaceUsage(sessionId);
    assert.equal(usage.chats, 1);
    assert.equal(usage.current.total.totalTokens, 15);
    assert.deepEqual(usage.runs, []);
  } finally {
    detach();
  }
});

test("a cancelled print request leaves the session unconfigured and sends no message", async () => {
  const host = await openHost();
  const { sessionId } = await host.nyte.sessions.create();
  const written: string[] = [];
  const outcome = await within(
    printRun({
      nyte: host.nyte,
      sessionId,
      configure: { model: { provider: model.provider, id: model.id }, thinkingLevel: "off" },
      content: "cancelled",
      json: false,
      quiet: false,
      signal: AbortSignal.abort(),
      output: { write: (text) => void written.push(text), error: () => undefined },
    }),
  );
  assert.deepEqual(outcome, { kind: "cancelled" });
  assert.deepEqual(await host.sessionCommits(sessionId), []);
  assert.deepEqual(await host.nyte.messages.pending({ sessionId }), []);
  assert.deepEqual(written, []);
});

test("cancellation while configuring print mode does not submit the prompt", async () => {
  const host = await openHost();
  const { sessionId } = await host.nyte.sessions.create();
  const stop = new AbortController();
  const written: string[] = [];
  const outcome = await within(
    printRun({
      nyte: {
        ...host.nyte,
        sessions: {
          ...host.nyte.sessions,
          configure: async (input) => {
            const configured = await host.nyte.sessions.configure(input);
            stop.abort();
            return configured;
          },
        },
      },
      sessionId,
      configure: { model: { provider: model.provider, id: model.id }, thinkingLevel: "off" },
      content: "cancelled",
      json: true,
      quiet: false,
      signal: stop.signal,
      output: { write: (text) => void written.push(text), error: () => undefined },
    }),
  );
  assert.deepEqual(outcome, { kind: "cancelled" });
  assert.deepEqual(await host.nyte.messages.pending({ sessionId }), []);
  assert.equal(
    (await host.sessionCommits(sessionId)).some((item) => item.commit.body.kind === "message"),
    false,
  );
  assert.equal(await host.nyte.runs.current({ sessionId }), undefined);
  assert.deepEqual(written, []);
});

test("the workspace plugin set carries the question and web-search tools beside the built-ins", async () => {
  const directory = mkdtempSync(join(tmpdir(), "nyte-tui-plugins-"));
  try {
    const workspace = await new WorkspaceTrustStore(join(directory, "trust.json")).trust(directory);
    const resolved = await resolveWorkspacePlugins(workspace, {
      model,
      models: createNyteModels(),
    });
    assert.deepEqual(resolved.failures, []);
    const ids = resolved.plugins.map((plugin) => plugin.id);
    for (const expected of [
      "question",
      "web-search",
      "web-search/exa",
      "web-search/firecrawl",
      "web-search/parallel",
      "web-search/tavily",
      "fast-mode",
      "rename",
      "skills",
      "notifications",
      "warming",
    ]) {
      assert.ok(ids.includes(expected), `${expected} is loaded (${ids.join(", ")})`);
    }
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
