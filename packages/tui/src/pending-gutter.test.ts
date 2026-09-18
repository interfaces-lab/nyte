import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_LANDING, MAIN, sessionId } from "@nyte-ai/core";
import type { RunInfo } from "@nyte-ai/core";
import type { SessionState } from "@nyte-ai/client";
import { CliRenderEvents } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import type { TestRendererSetup } from "@opentui/core/testing";
import { mountShell } from "./app/App.tsx";
import type { Shell } from "./app/ui.ts";
import { laneRoles } from "./lanes.ts";
import type { GutterRow } from "./pending-gutter.ts";
import { DARK_THEME } from "./theme.ts";

type TranscriptTurn = Extract<
  SessionState["transcript"]["items"][number],
  { readonly kind: "turn" }
>;

const roles = laneRoles(DEFAULT_LANDING);
const request = "Review the settings panel";
const answer = "The heading sits too close to the first control.";
const correction = "Only change the spacing, not the colors.";

const mounted: TestRendererSetup[] = [];
afterEach(() => {
  for (const setup of mounted.splice(0)) setup.renderer.destroy();
});

/** The first turn, answered; the run is still on it until the correction is admitted. */
const reviewTurn: TranscriptTurn = {
  kind: "turn",
  id: "turn-review",
  parts: [
    { kind: "user", commit: "user-review", parent: null, content: request },
    { kind: "assistant", commit: "assistant-review", contentIndex: 0, text: answer },
  ],
  outcome: "completed",
  startedAt: 1_000,
  durationMs: 1_100,
};

/** A finished review long enough to scroll: the tail is pinned, so a shorter tail shifts everything. */
const longReviewTurn: TranscriptTurn = {
  ...reviewTurn,
  parts: [
    { kind: "user", commit: "user-review", parent: null, content: request },
    {
      kind: "assistant",
      commit: "assistant-review",
      contentIndex: 0,
      text: Array.from(
        { length: 20 },
        (_, index) => `Finding ${String(index + 1)}: ${answer}`,
      ).join("\n\n"),
    },
  ],
};

/** The admitted correction: a request the run has not answered yet. */
function correctionTurn(content: string = correction): TranscriptTurn {
  return {
    kind: "turn",
    id: "turn-correction",
    parts: [{ kind: "user", commit: "user-correction", parent: "assistant-review", content }],
    outcome: "completed",
    startedAt: 3_000,
    durationMs: 0,
  };
}

function run(startedAt: number): RunInfo {
  return {
    runId: "run-1",
    head: MAIN,
    phase: { kind: "respond" },
    startedAt,
    attempts: 1,
    config: {},
  };
}

function state(items: readonly TranscriptTurn[], running: RunInfo | undefined): SessionState {
  const id = sessionId("steer-handoff");
  return {
    sessionId: id,
    head: MAIN,
    seq: 1,
    info: {
      sessionId: id,
      activation: { kind: "active" },
      createdAt: 0,
      lastActivityAt: 0,
      pinned: false,
      archived: false,
      heads: [{ head: MAIN, tip: items.at(-1)?.id ?? null }],
      config: {},
    },
    config: {},
    transcript: { items, tip: items.at(-1)?.id ?? null },
    pending: [],
    run: running,
    compaction: undefined,
    overlay: [],
    parked: [],
    context: { estimatedTokens: 0, usageTokens: 0, trailingTokens: 0, contextWindow: 128_000 },
    expectedTip: undefined,
  };
}

async function mount(
  width = 80,
  height = 24,
): Promise<{ readonly setup: TestRendererSetup; readonly shell: Shell }> {
  const setup = await createTestRenderer({ width, height });
  mounted.push(setup);
  const shell = await mountShell({
    renderer: setup.renderer,
    initialTheme: DARK_THEME,
    roles,
    openPath: () => undefined,
  });
  return { setup, shell };
}

async function settle(setup: TestRendererSetup): Promise<void> {
  await setup.flush();
  await setup.waitForVisualIdle();
}

const lines = (setup: TestRendererSetup): string[] => setup.captureCharFrame().split("\n");

/** Rows holding the text, one-based like a terminal. */
const rowsWith = (frame: readonly string[], text: string): number[] =>
  frame.flatMap((line, index) => (line.includes(text) ? [index + 1] : []));

/** Every frame the renderer paints for one action; settle() alone would hide a wrong first frame. */
async function framesOf(setup: TestRendererSetup, act: () => void): Promise<string[][]> {
  const frames: string[][] = [];
  const capture = () => frames.push(lines(setup));
  setup.renderer.on(CliRenderEvents.FRAME, capture);
  try {
    act();
    await settle(setup);
  } finally {
    setup.renderer.off(CliRenderEvents.FRAME, capture);
  }
  return frames;
}

const sending = (key: string, lane: string, content: string): GutterRow => ({
  kind: "sending",
  entry: { key, lane, content, at: 2_000, attempts: 1 },
});

const pending = (change: string, lane: string, content: string, key?: string): GutterRow => ({
  kind: "pending",
  item: { change, lane, content, at: 2_000, ...(key === undefined ? {} : { key }) },
});

describe("steer messages at the transcript's tail", () => {
  test("a submitted message keeps its row and its block from sending, through pending, into its turn", async () => {
    const { setup, shell } = await mount();
    shell.view.sync(state([reviewTurn], run(1_000)));
    await settle(setup);
    expect(rowsWith(lines(setup), "Working")).toHaveLength(1);

    const sent = await framesOf(setup, () =>
      shell.pendingTail.sync([sending("key-1", roles.steer, correction)]),
    );
    const row = rowsWith(lines(setup), correction);
    expect(row).toHaveLength(1);
    expect(sent.at(-1)?.some((line) => line.includes("… sending · ctrl+q pending"))).toBe(true);
    // The lane row sits where the turn's activity row will: under the message, above the composer.
    expect(rowsWith(lines(setup), "sending")[0]).toBeGreaterThan(row[0] ?? 0);
    const block = shell.pendingTail.container.getChildren()[0];

    // The receipt names the change; the key it carried keeps the same block.
    const admitted = await framesOf(setup, () =>
      shell.pendingTail.sync([pending("change-1", roles.steer, correction, "key-1")]),
    );
    for (const frame of admitted) expect(rowsWith(frame, correction)).toEqual(row);
    expect(shell.pendingTail.container.getChildren()[0]).toBe(block);
    expect(lines(setup).some((line) => line.includes(`${roles.steer} · ctrl+q pending`))).toBe(
      true,
    );
    // The watch's own item, without the key, is still the same message.
    shell.pendingTail.sync([pending("change-1", roles.steer, correction)]);
    await settle(setup);
    expect(shell.pendingTail.container.getChildren()[0]).toBe(block);
    expect(rowsWith(lines(setup), correction)).toEqual(row);

    const landed = await framesOf(setup, () => {
      shell.view.sync(state([reviewTurn, correctionTurn()], run(1_000)));
      shell.pendingTail.sync([]);
    });
    expect(landed.length).toBeGreaterThan(0);
    for (const frame of landed) expect(rowsWith(frame, correction)).toEqual(row);
    const frame = lines(setup);
    expect(frame.some((line) => line.includes("ctrl+q pending"))).toBe(false);
    expect(rowsWith(frame, "Worked")[0]).toBeLessThan(row[0] ?? 0);
    expect(rowsWith(frame, "Working")[0]).toBeGreaterThan(row[0] ?? 0);
  });

  test("idle admission holds the message's row while its run is still one event away", async () => {
    const { setup, shell } = await mount();
    shell.view.sync(state([longReviewTurn], undefined));
    shell.pendingTail.sync([pending("change-1", roles.steer, correction)]);
    await settle(setup);
    const row = rowsWith(lines(setup), correction);
    expect(row).toHaveLength(1);
    expect(rowsWith(lines(setup), "Finding 1:")).toHaveLength(0);
    const statusRow = rowsWith(lines(setup), `${roles.steer} · ctrl+q pending`);
    expect(statusRow).toHaveLength(1);

    // The commit paints before the run event: no run, no pending, only the request.
    const admitted = await framesOf(setup, () => {
      shell.view.sync(state([longReviewTurn, correctionTurn()], undefined));
      shell.pendingTail.sync([]);
    });
    expect(admitted.length).toBeGreaterThan(0);
    for (const frame of admitted) expect(rowsWith(frame, correction)).toEqual(row);
    const unanswered = lines(setup);
    for (const worked of rowsWith(unanswered, "Worked")) expect(worked).toBeLessThan(row[0] ?? 0);
    expect(rowsWith(unanswered, "Working")).toHaveLength(0);
    expect(unanswered.some((line) => line.includes("ctrl+q pending"))).toBe(false);

    const running = await framesOf(setup, () =>
      shell.view.sync(state([longReviewTurn, correctionTurn()], run(3_000))),
    );
    for (const frame of running) expect(rowsWith(frame, correction)).toEqual(row);
    // The run's status takes the row the lane word held.
    expect(rowsWith(lines(setup), "Working")).toEqual(statusRow);
  });

  test("a long Markdown message keeps every row through admission in a narrow terminal", async () => {
    const { setup, shell } = await mount(50, 24);
    const rich = [
      "Only change the **spacing**, not the colors:",
      "",
      "- keep the accent on the account rows",
      "- align the heading with the first control, and wrap this line at fifty columns",
      "",
      "```css",
      ".panel { gap: 8px; }",
      "```",
    ].join("\n");
    shell.view.sync(state([reviewTurn], run(1_000)));
    shell.pendingTail.sync([sending("key-1", roles.steer, rich)]);
    await settle(setup);
    const before = lines(setup);
    const rows = {
      title: rowsWith(before, "Only change the"),
      wrapped: rowsWith(before, "wrap this line"),
      code: rowsWith(before, ".panel { gap: 8px; }"),
    };
    expect(rows.title).toHaveLength(1);
    expect(rows.wrapped).toHaveLength(1);
    expect(rows.code).toHaveLength(1);

    const frames = await framesOf(setup, () => {
      shell.pendingTail.sync([pending("change-1", roles.steer, rich, "key-1")]);
    });
    const landed = await framesOf(setup, () => {
      shell.view.sync(state([reviewTurn, correctionTurn(rich)], run(1_000)));
      shell.pendingTail.sync([]);
    });
    for (const frame of [...frames, ...landed]) {
      expect(rowsWith(frame, "Only change the")).toEqual(rows.title);
      expect(rowsWith(frame, "wrap this line")).toEqual(rows.wrapped);
      expect(rowsWith(frame, ".panel { gap: 8px; }")).toEqual(rows.code);
    }
    expect(rowsWith(lines(setup), "Working")[0]).toBeGreaterThan(rows.code[0] ?? 0);
  });

  test("a pending message the run has not admitted draws no outcome of its own", async () => {
    const { setup, shell } = await mount();
    shell.view.sync(state([reviewTurn], run(1_000)));
    shell.pendingTail.sync([pending("change-1", roles.steer, correction)]);
    await settle(setup);
    const frame = lines(setup);
    expect(rowsWith(frame, correction)).toHaveLength(1);
    expect(rowsWith(frame, "Worked")).toHaveLength(0);
    expect(rowsWith(frame, "Working")[0]).toBeLessThan(rowsWith(frame, correction)[0] ?? 0);
    expect(frame.some((line) => line.includes(`${roles.steer} · ctrl+q pending`))).toBe(true);
  });
});

const follow = (index: number) => `Follow-up number ${String(index)} for later`;

describe("follow-ups in the compact gutter", () => {
  test("queued rows stay compact, capped to the terminal's share, and count the hidden rest", async () => {
    const { setup, shell } = await mount(80, 12);
    shell.view.sync(state([reviewTurn], run(1_000)));
    shell.pendingGutter.sync([
      pending("change-1", roles.queue, follow(1)),
      pending("change-2", roles.queue, follow(2)),
      pending("change-3", roles.queue, follow(3)),
      sending("key-4", roles.queue, follow(4)),
    ]);
    await settle(setup);
    const frame = lines(setup);
    // Twelve rows give the gutter three; the fourth is counted, not drawn.
    expect(rowsWith(frame, follow(1))).toHaveLength(1);
    expect(rowsWith(frame, follow(3))).toHaveLength(1);
    expect(rowsWith(frame, follow(4))).toHaveLength(0);
    expect(frame.some((line) => line.includes("+1 more · ctrl+q pending"))).toBe(true);
    // One row each: the message, its lane, and the hint share the line.
    const third = frame[(rowsWith(frame, follow(3))[0] ?? 1) - 1] ?? "";
    expect(third).toContain(`↓ ${follow(3)}`);
    expect(third).toContain(roles.queue);
    expect(rowsWith(frame, "Working")[0]).toBeLessThan(rowsWith(frame, follow(1))[0] ?? 0);

    shell.pendingGutter.sync([pending("change-1", roles.queue, follow(1))]);
    await settle(setup);
    const one = lines(setup);
    expect(one.some((line) => line.includes("+1 more"))).toBe(false);
    expect(one.some((line) => line.includes(`${roles.queue} · ctrl+q pending`))).toBe(true);
  });
});
