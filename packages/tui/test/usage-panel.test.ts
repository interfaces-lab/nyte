import assert from "node:assert/strict";
import { afterEach, beforeEach, describe, test } from "node:test";
import { createTestRenderer } from "@opentui/core/testing";
import type { TestRendererSetup } from "@opentui/core/testing";
import { appendUser } from "../src/transcript.ts";
import { GROKNIGHT } from "../src/theme.ts";
import { buildUi, openUsageCard, selectChoice } from "../src/tui.ts";
import type { Ui } from "../src/tui.ts";
import type { UsageCard } from "../src/usage.ts";

const CARD: UsageCard = {
  runs: {
    kind: "runs",
    summary: "1 running · 1 interrupted",
    rows: [
      { state: "live", label: "this chat", detail: "run · 2m14s", usage: "32.4k · $0.06" },
      {
        state: "interrupted",
        label: "explore notes",
        detail: "interrupted",
        usage: "1.2k · $0.00",
      },
    ],
    note: "committed below · open requests excluded",
  },
  headroom: {
    kind: "providers",
    summary: "1 of 2 known",
    rows: [
      {
        kind: "known",
        name: "OpenAI Codex",
        meta: "Plus · checking · 18m old",
        stale: true,
        windows: [
          {
            label: "5h     ",
            share: 0.72,
            tone: "ok",
            remaining: " 72%",
            reset: "resets in 1h 42m",
          },
          {
            label: "weekly ",
            share: 0.04,
            tone: "critical",
            remaining: "  4%",
            reset: "resets Tue 09:00",
          },
        ],
      },
      {
        kind: "unknown",
        name: "Claude",
        meta: "checking…",
      },
    ],
  },
  workspace: {
    kind: "usage",
    title: "workspace · 2 chats",
    total: "$12.35",
    rows: [
      {
        label: "big-model",
        system: false,
        share: 1,
        cost: " $12.35",
        tokens: "1.3m",
      },
      {
        label: "mini",
        system: false,
        share: 0.005 / 12.35,
        cost: "$0.0050",
        tokens: "1.0m",
      },
    ],
    breakdown: ["input 1.2m · output 20.9k", "cache read 12.3m · cache write 1.2m"],
    thisChat: "this chat · 32.4k tokens · $0.06",
  },
};

/** The same card once the refresh landed and everything went quiet. */
const QUIET: UsageCard = {
  runs: { kind: "none" },
  headroom: { kind: "none" },
  workspace: CARD.workspace,
};

void describe("the /usage card", () => {
  let setup: TestRendererSetup;
  let ui: Ui;

  async function open(width: number): Promise<void> {
    // A bare ESC waits in the parser for a possible sequence; kitty keyboard
    // reports it straight away, which is what the panel is listening for.
    setup = await createTestRenderer({
      width,
      height: 30,
      kittyKeyboard: true,
      openConsoleOnError: false,
    });
    ui = buildUi(setup.renderer, GROKNIGHT);
    for (let index = 0; index < 40; index++) {
      appendUser(ui.transcript, `prompt ${String(index)}`);
    }
    await setup.renderOnce();
  }

  beforeEach(async () => {
    await open(72);
  });

  afterEach(() => {
    setup.renderer.destroy();
  });

  void test("frames runs, headroom, and totals", async () => {
    openUsageCard(ui, CARD);
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    assert.match(frame, /╭/);
    assert.match(frame, /usage/);
    assert.match(frame, /in progress\s+1 running · 1 interrupted/);
    assert.match(frame, /● this chat\s+run · 2m14s\s+32\.4k · \$0\.06/);
    assert.match(frame, /○ explore notes\s+interrupted\s+1\.2k · \$0\.00/);
    assert.match(frame, /committed below · open requests excluded/);
    assert.match(frame, /account headroom\s+1 of 2 known/);
    assert.match(frame, /OpenAI Codex\s+Plus · checking · 18m old/);
    assert.match(frame, /5h\s+━{14}─{6}\s+72%\s+resets in 1h 42m/);
    assert.match(frame, /weekly\s+━─{19}\s+4%\s+resets Tue 09:00/);
    assert.match(frame, /Claude\s+checking…/);
    assert.match(frame, /workspace · 2 chats\s+\$12\.35/);
    assert.match(frame, /big-model {2}━{20} {3}\$12\.35 {2}1\.3m/);
    assert.match(frame, /mini {7}━─{19} {2}\$0\.0050 {2}1\.0m/);
    assert.match(frame, /input 1\.2m · output 20\.9k/);
    assert.match(frame, /cache read 12\.3m · cache write 1\.2m/);
    assert.match(frame, /this chat · 32\.4k tokens · \$0\.06/);
    assert.match(frame, /estimates exclude subscription billing/);
  });

  void test("declares exactly the rows it draws, and the composer rides up by that many", async () => {
    const panel = openUsageCard(ui, CARD);
    await setup.renderOnce();
    assert.equal(panel.container.height, panel.rows);
    assert.equal(ui.inputBox.y, ui.scroll.height - panel.rows);
  });

  void test("a second card replaces the first without leaving its listeners behind", async () => {
    const first = openUsageCard(ui, CARD);
    await setup.renderOnce();

    const second = openUsageCard(ui, QUIET);
    await setup.renderOnce();
    assert.equal(first.destroyed, true);
    assert.equal(second.destroyed, false);
    assert.match(setup.captureCharFrame(), /account headroom\s+not in use/);
  });

  void test("yields the slot when a prompt needs an answer", async () => {
    const panel = openUsageCard(ui, CARD);
    await setup.renderOnce();

    const answer = selectChoice(ui, "Allow this tool?", [
      { id: "yes", label: "Yes" },
      { id: "no", label: "No" },
    ]);
    await setup.renderOnce();
    assert.equal(panel.destroyed, true);
    assert.match(setup.captureCharFrame(), /Allow this tool\?/);

    const rejected = assert.rejects(answer);
    setup.mockInput.pressEscape();
    await setup.renderOnce();
    await rejected;
  });

  void test("a refresh swaps the card in place and re-declares the rows", async () => {
    const panel = openUsageCard(ui, CARD);
    await setup.renderOnce();
    const before = panel.rows;
    const viewport = ui.scroll.viewport.height;

    panel.show(QUIET);
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    assert.match(frame, /in progress\s+none/);
    assert.match(frame, /account headroom\s+not in use/);
    assert.doesNotMatch(frame, /OpenAI Codex/);
    assert.ok(panel.rows < before, "fewer sections take fewer rows");
    assert.equal(panel.container.height, panel.rows);
    assert.equal(ui.inputBox.y, ui.scroll.height - panel.rows);
    // Still borrowed, not taken: the transcript viewport did not move.
    assert.equal(ui.scroll.viewport.height, viewport);
    assert.equal(ui.selecting, true);
  });

  void test("escape gives the rows back and leaves nothing in the record", async () => {
    const before = setup.captureCharFrame();
    const viewport = ui.scroll.viewport.height;
    const scrollTop = ui.scroll.scrollTop;

    const panel = openUsageCard(ui, CARD);
    await setup.renderOnce();
    assert.match(setup.captureCharFrame(), /workspace · 2 chats/);
    assert.equal(ui.scroll.viewport.height, viewport);
    assert.equal(ui.scroll.scrollTop, scrollTop);
    assert.equal(ui.selecting, true);

    setup.mockInput.pressEscape();
    await setup.renderOnce();
    assert.equal(panel.destroyed, true);
    assert.equal(panel.container.isDestroyed, true);
    assert.equal(ui.selecting, false);
    assert.equal(setup.captureCharFrame(), before);

    // A refresh that lands after the close is dropped, not drawn.
    panel.show(QUIET);
    await setup.renderOnce();
    assert.equal(setup.captureCharFrame(), before);
  });

  void test("reflows bars without crossing the frame at narrow widths", async () => {
    const panel = openUsageCard(ui, CARD);
    await setup.renderOnce();

    setup.resize(52, 30);
    await setup.renderOnce();
    const frame = setup.captureCharFrame();
    assert.match(frame, /resets in 1h 42m/);
    assert.match(frame, /big-model\s+━+\s+\$12\.35\s+1\.3m/);
    assert.match(frame, /cache read 12\.3m · cache write 1\.2m/);
    for (const line of frame.split("\n").filter((value) => value.includes("│"))) {
      assert.match(line, /│\s*$/u, line);
    }
    assert.equal(panel.container.height, panel.rows);
    assert.equal(ui.inputBox.y, ui.scroll.height - panel.rows);
  });
});
