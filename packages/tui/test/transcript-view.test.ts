import { afterEach, beforeEach, describe, expect, test, vi } from "vitest";
import { DEFAULT_LANDING, sessionId } from "@nyte-ai/core";
import type { RunInfo, SessionEvent, SessionSnapshot } from "@nyte-ai/core";
import { createTestRenderer } from "@opentui/core/testing";
import type { TestRendererSetup } from "@opentui/core/testing";
import { laneRoles } from "../src/lanes.ts";
import { foldEvent, stateFromSnapshot, type SessionState } from "../src/session-state.ts";
import { buildShell, notice, type Shell } from "../src/shell.ts";
import { DARK_THEME } from "../src/theme.ts";

type Commit = Extract<SessionEvent, { kind: "commit" }>["item"]["commit"];
type Message = Extract<Commit["body"], { kind: "message" }>["message"];
type AssistantContent = Extract<Message, { role: "assistant" }>["content"];

const RUN = "r1";

function snapshot(): SessionSnapshot {
  return {
    seq: 10,
    session: {
      sessionId: sessionId("s"),
      createdAt: 1,
      lastActivityAt: 1,
      pinned: false,
      archived: false,
      heads: [{ head: "main", tip: null }],
      config: {},
    },
    head: "main",
    tip: null,
    config: {},
    transcript: [],
    pending: [],
    context: { estimatedTokens: 0, usageTokens: 0, trailingTokens: 0, contextWindow: 1000 },
  };
}

function userSaid(text: string): Commit["body"] {
  return { kind: "message", message: { role: "user", content: text, timestamp: 1 } };
}

function assistantSaid(content: AssistantContent): Commit["body"] {
  return {
    kind: "message",
    message: {
      role: "assistant",
      content,
      api: "openai-responses",
      provider: "openai",
      model: "m",
      usage: {
        input: 1,
        output: 1,
        cacheRead: 0,
        cacheWrite: 0,
        totalTokens: 2,
        cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0, total: 0 },
      },
      stopReason: "stop",
      timestamp: 2,
    },
  };
}

/** Events in the order the store publishes them; `seq` follows the array. */
class Feed {
  state: SessionState;
  private seq = 10;
  private tip: string | null = null;

  constructor() {
    this.state = stateFromSnapshot(snapshot());
  }

  private apply(event: SessionEvent): void {
    const outcome = foldEvent(this.state, event);
    if (outcome.kind === "resnapshot") throw new Error(`resnapshot on ${event.kind}`);
    this.state = outcome.state;
  }

  private next(): number {
    this.seq += 1;
    return this.seq;
  }

  /** A commit the run landed, or one the user made when `byRun` is false. */
  commit(oid: string, body: Commit["body"], byRun = true): void {
    const seq = this.next();
    const base: Commit = { kind: "commit", parent: this.tip, body, at: seq };
    const commit = byRun ? { ...base, run: RUN } : base;
    this.apply({ seq, kind: "head_moved", head: "main", from: this.tip, to: oid, reason: "land" });
    this.apply({ seq, kind: "commit", head: "main", item: { oid, commit } });
    this.tip = oid;
  }

  run(phase: RunInfo["phase"]): void {
    const seq = this.next();
    this.apply({
      seq,
      kind: "run",
      head: "main",
      run: { runId: RUN, head: "main", phase, startedAt: seq, attempts: 1, config: {} },
    });
  }

  text(delta: string, index = 0): void {
    this.apply({ seq: this.next(), kind: "text_delta", runId: RUN, attempt: 1, index, delta });
  }

  thought(delta: string, index = 0): void {
    this.apply({
      seq: this.next(),
      kind: "reasoning_delta",
      runId: RUN,
      attempt: 1,
      index,
      delta,
    });
  }
}

describe("the transcript view", () => {
  let setup: TestRendererSetup;
  let shell: Shell;
  let feed: Feed;

  beforeEach(async () => {
    setup = await createTestRenderer({
      width: 60,
      height: 20,
      useThread: false,
      kittyKeyboard: true,
      openConsoleOnError: false,
    });
    shell = buildShell(setup.renderer, DARK_THEME, laneRoles(DEFAULT_LANDING), () => {});
    setup.renderer.start();
    feed = new Feed();
  });

  afterEach(() => {
    setup.renderer.destroy();
  });

  /** Draw the feed's state and let layout and sticky scroll settle. */
  async function shown(): Promise<string> {
    shell.view.sync(feed.state);
    await setup.waitForVisualIdle();
    return setup.captureCharFrame();
  }

  test("a request no run has answered shows neither Worked nor a spinner", async () => {
    feed.commit("u1", userSaid("hello"), false);
    const frame = await shown();
    expect(frame).toContain("hello");
    expect(frame).not.toMatch(/Worked|Working|⠋/);
  });

  test("a branch snapshot restores an earlier step within the same turn", async () => {
    feed.commit("u1", userSaid("hello"), false);
    feed.commit("a1", assistantSaid([{ type: "text", text: "First step" }]));
    const earlier = feed.state;
    feed.commit("a2", assistantSaid([{ type: "text", text: "Later step" }]));
    await vi.waitFor(async () => expect(await shown()).toContain("Later step"));

    shell.view.sync(earlier, { reset: true });
    await vi.waitFor(async () => {
      await setup.waitForVisualIdle();
      const frame = setup.captureCharFrame();
      expect(frame).toContain("hello");
      expect(frame).toContain("First step");
      expect(frame).not.toContain("Later step");
    });

    shell.view.sync(feed.state, { reset: true });
    await vi.waitFor(async () => {
      await setup.waitForVisualIdle();
      expect(setup.captureCharFrame()).toContain("Later step");
    });
  });

  test("the spinner appears once the run starts, and Worked once it ends", async () => {
    feed.commit("u1", userSaid("hello"), false);
    await shown();
    feed.run({ kind: "respond" });
    expect(await shown()).toContain("Working");
    feed.run({ kind: "done" });
    const frame = await shown();
    expect(frame).toContain("Worked");
    expect(frame).not.toContain("Working");
  });

  test("a running task restores its agent and prompt from durable call arguments", async () => {
    feed.commit("u1", userSaid("delegate"), false);
    feed.run({ kind: "tools" });
    feed.commit(
      "a1",
      assistantSaid([
        {
          type: "toolCall",
          id: "task-1",
          name: "task",
          arguments: { agent: "general", prompt: "Wait for one minute." },
        },
      ]),
    );
    feed.run({ kind: "waiting" });

    const frame = await shown();
    expect(frame).toContain("task general");
    expect(frame).toContain("Wait for one minute.");
  });

  test("the latest text and the status row stay in view while a long answer streams", async () => {
    feed.commit("u1", userSaid("hello"), false);
    feed.run({ kind: "respond" });
    await shown();
    for (let line = 0; line < 25; line += 1) {
      feed.thought(`thought line ${String(line)}\n`);
      const frame = await shown();
      expect(frame).toContain("Thinking");
      expect(frame).toContain(`thought line ${String(line)}`);
    }
    feed.commit("a1", assistantSaid([{ type: "thinking", thinking: "thought" }]));
    const settled = await shown();
    expect(settled).toContain("Thought");
    expect(settled).toContain("Working");
    for (let line = 0; line < 30; line += 1) {
      feed.text(`answer line ${String(line)}\n`);
      const frame = await shown();
      expect(frame).toContain("Working");
      expect(frame).toContain(`answer line ${String(line)}`);
    }
  }, 30_000);

  test("a notice under the composer keeps the newest text and the status row in view", async () => {
    feed.commit("u1", userSaid("hello"), false);
    feed.run({ kind: "respond" });
    for (let line = 0; line < 40; line += 1) feed.text(`answer line ${String(line)}\n`);
    expect(await shown()).toContain("Working");
    notice(shell, [
      "How should it behave?",
      "  1. one",
      "  2. two",
      "  3. three",
      "Reply with a number.",
    ]);
    await setup.waitForVisualIdle();
    feed.text("answer line 40\n");
    const during = await shown();
    expect(during).toContain("answer line 40");
    expect(during).toContain("Working");
    shell.ephemeral.clear();
    await setup.waitForVisualIdle();
    feed.text("answer line 41\n");
    const after = await shown();
    expect(after).toContain("answer line 41");
    expect(after).toContain("Working");
  });

  test("scrolling up unpins the view, and it follows the stream again from the bottom", async () => {
    feed.commit("u1", userSaid("hello"), false);
    feed.run({ kind: "respond" });
    for (let line = 0; line < 40; line += 1) feed.text(`answer line ${String(line)}\n`);
    await shown();
    const { scroll } = shell;
    for (let step = 0; step < 5; step += 1) {
      await setup.mockMouse.scroll(scroll.viewport.x + 2, scroll.viewport.y + 2, "up");
    }
    await setup.waitForVisualIdle();
    const pinnedAbove = scroll.scrollTop;
    feed.text("answer line 40\n");
    const away = await shown();
    expect(scroll.scrollTop).toBe(pinnedAbove);
    expect(away).not.toContain("answer line 40");
    scroll.scrollTo(Infinity);
    await setup.waitForVisualIdle();
    feed.text("answer line 41\n");
    expect(await shown()).toContain("answer line 41");
  });

  test("consecutive config commits collapse into one line with the latest values", async () => {
    feed.commit("c1", { kind: "config", thinkingLevel: "low" }, false);
    expect(await shown()).toContain("Thinking → low");
    feed.commit("c2", { kind: "config", thinkingLevel: "medium" }, false);
    const second = await shown();
    expect(second).not.toContain("low");
    expect(second).toContain("Thinking → medium");
    feed.commit("c3", { kind: "config", model: { provider: "p", id: "m" } }, false);
    const third = await shown();
    expect(third).not.toContain("low");
    expect(third.match(/Thinking →/g)).toHaveLength(1);
    expect(third).toContain("Model → p/m · Thinking → medium");
    // A turn in between starts a new run of config lines.
    feed.commit("u1", userSaid("hi"), false);
    feed.commit("c4", { kind: "config", thinkingLevel: "high" }, false);
    const fourth = await shown();
    expect(fourth).toContain("Thinking → medium");
    expect(fourth).toContain("Thinking → high");
  });
});
