import { afterEach, describe, expect, test } from "bun:test";
import { DEFAULT_LANDING, MAIN, sessionId } from "@nyte-ai/core";
import type { SessionState } from "@nyte-ai/client";
import {
  BoxRenderable,
  CliRenderEvents,
  TextBufferRenderable,
  TextRenderable,
} from "@opentui/core";
import type { Renderable } from "@opentui/core";
import { createTestRenderer } from "@opentui/core/testing";
import type { TestRendererSetup } from "@opentui/core/testing";
import { clearNotice, closePanel, holdSlot, notice, openPanel, releaseSlot } from "./app/ui.ts";
import { mountShell } from "./app/App.tsx";
import type { EphemeralPanel, Shell } from "./app/ui.ts";
import { laneRoles } from "./lanes.ts";
import { DARK_THEME } from "./theme.ts";

type TranscriptTurn = Extract<
  SessionState["transcript"]["items"][number],
  { readonly kind: "turn" }
>;

const mounted: TestRendererSetup[] = [];
afterEach(() => {
  for (const setup of mounted.splice(0)) setup.renderer.destroy();
});

function turn(index: number, responseLines = 1): TranscriptTurn {
  const request = `request-${String(index)}`;
  const response = Array.from(
    { length: responseLines },
    (_, line) => `response-${String(index)}-${String(line)}`,
  ).join("\n");
  return {
    kind: "turn",
    id: `turn-${String(index)}`,
    parts: [
      {
        kind: "user",
        commit: `user-${String(index)}`,
        parent: index === 0 ? null : `assistant-${String(index - 1)}`,
        content: request,
      },
      {
        kind: "assistant",
        commit: `assistant-${String(index)}`,
        contentIndex: 0,
        text: response,
      },
    ],
    outcome: "completed",
    startedAt: index * 1_000,
    durationMs: 500,
  };
}

function richTurn(index: number): TranscriptTurn {
  const suffix = String(index).padStart(3, "0");
  return {
    kind: "turn",
    id: `rich-turn-${suffix}`,
    parts: [
      {
        kind: "user",
        commit: `rich-user-${suffix}`,
        parent: index === 0 ? null : `rich-tail-${String(index - 1).padStart(3, "0")}`,
        content: `explain rich fixture ${suffix}`,
      },
      {
        kind: "assistant",
        commit: `rich-assistant-${suffix}`,
        contentIndex: 0,
        text: [
          `## Markdown fixture ${suffix}`,
          "",
          `A deliberately long paragraph before the tool carries 東京, naïve, é, and 👩🏽‍💻 through width reflow for fixture ${suffix}.`,
          "",
          "```ts",
          `const unicode_${suffix} = "東京 👩🏽‍💻 café";`,
          `console.log(unicode_${suffix}.repeat(4));`,
          "```",
        ].join("\n"),
      },
      {
        kind: "tool",
        callId: `rich-tool-${suffix}`,
        toolName: "bash",
        args: { command: `printf rich-${suffix}` },
        result: {
          commit: `rich-result-${suffix}`,
          output: Array.from(
            { length: 24 },
            (_, line) => `tool-${suffix}-row-${String(line).padStart(2, "0")} λ`,
          ).join("\n"),
          title: `rich-${suffix}`,
          isError: false,
        },
      },
      {
        kind: "assistant",
        commit: `rich-tail-${suffix}`,
        contentIndex: 1,
        text: `RICH-ANCHOR-${suffix} survives Markdown, tool disclosure, and Unicode reflow.`,
      },
    ],
    outcome: "completed",
    startedAt: index * 1_000,
    durationMs: 500,
  };
}

function findText(root: Renderable, text: string): TextBufferRenderable | undefined {
  if (root instanceof TextBufferRenderable && root.plainText.includes(text)) return root;
  for (const child of root.getChildren()) {
    const found = findText(child, text);
    if (found !== undefined) return found;
  }
  return undefined;
}

function state(
  items: readonly TranscriptTurn[],
  options: { readonly id?: string; readonly liveText?: string } = {},
): SessionState {
  const activeSession = sessionId(options.id ?? "transcript-view");
  const running = options.liveText !== undefined;
  return {
    sessionId: activeSession,
    head: MAIN,
    seq: 1,
    info: {
      sessionId: activeSession,
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
    run: running
      ? {
          runId: "live-run",
          head: MAIN,
          phase: { kind: "respond" },
          startedAt: items.at(-1)?.startedAt ?? 0,
          attempts: 1,
          config: {},
        }
      : undefined,
    compaction: undefined,
    overlay:
      options.liveText === undefined
        ? []
        : [
            {
              kind: "text",
              runId: "live-run",
              attempt: 1,
              index: 0,
              text: options.liveText,
            },
          ],
    parked: [],
    context: { estimatedTokens: 0, usageTokens: 0, trailingTokens: 0, contextWindow: 128_000 },
    expectedTip: undefined,
  };
}

async function mount(
  width = 80,
  height = 36,
): Promise<{ readonly setup: TestRendererSetup; readonly shell: Shell }> {
  const setup = await createTestRenderer({ width, height });
  mounted.push(setup);
  const shell = await mountShell({
    renderer: setup.renderer,
    initialTheme: DARK_THEME,
    roles: laneRoles(DEFAULT_LANDING),
    openPath: () => undefined,
  });
  return { setup, shell };
}

async function settle(setup: TestRendererSetup): Promise<void> {
  await setup.flush();
  await setup.waitForVisualIdle();
}

function lines(setup: TestRendererSetup): string[] {
  return setup.captureCharFrame().split("\n");
}

function rowOf(setup: TestRendererSetup, text: string): number {
  return lines(setup).findIndex((line) => line.includes(text));
}

/** Every frame the renderer paints for one action, first to settled; settle() alone would hide a wrong first frame. */
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

function topRequest(frame: readonly string[]): { readonly text: string; readonly row: number } {
  for (const [row, line] of frame.entries()) {
    const match = /request-\d+/u.exec(line);
    if (match?.[0] !== undefined) return { text: match[0], row };
  }
  throw new Error("No request line is visible");
}

function visibleResponse(setup: TestRendererSetup): {
  readonly text: string;
  readonly row: number;
} {
  for (const [row, line] of lines(setup).entries()) {
    const match = /response-\d+-\d+/u.exec(line);
    if (match?.[0] !== undefined) return { text: match[0], row };
  }
  throw new Error("No response line is visible");
}

async function alignTextAtViewportTop(
  setup: TestRendererSetup,
  shell: Shell,
  text: string,
): Promise<number> {
  for (let page = 0; page < 40 && rowOf(setup, text) < 0; page++) {
    shell.view.scrollBy(-0.75, "viewport");
    await settle(setup);
  }
  const row = rowOf(setup, text);
  if (
    row < shell.scroll.viewport.y ||
    row >= shell.scroll.viewport.y + shell.scroll.viewport.height
  )
    throw new Error(`Could not reach ${text}`);
  shell.view.scrollBy(row - shell.scroll.viewport.y);
  await settle(setup);
  const aligned = rowOf(setup, text);
  if (aligned < 0) throw new Error(`${text} left the viewport while aligning it`);
  return aligned;
}

function panel(shell: Shell, label: string, rows: number): EphemeralPanel {
  const container = new BoxRenderable(shell.renderer, { id: `panel-${label}`, height: rows });
  container.add(new TextRenderable(shell.renderer, { content: label }));
  return {
    container,
    rows,
    hints: "esc close",
    focus: () => undefined,
    blur: () => undefined,
    destroy: () => container.destroyRecursively(),
  };
}

describe("TranscriptView message navigation", () => {
  test("visits every turn in a transcript shorter than the viewport, then stops", async () => {
    const { setup, shell } = await mount();
    shell.view.sync(state([turn(0), turn(1), turn(2)]));
    await settle(setup);

    const positions: number[] = [];
    for (let index = 0; index < 3; index++) {
      expect(shell.view.jumpTurn("next")).toBe(true);
      await settle(setup);
      positions.push(shell.scroll.scrollTop);
    }
    expect(positions[0]).toBeGreaterThanOrEqual(0);
    expect(positions[1]).toBeGreaterThan(positions[0] ?? 0);
    expect(positions[2]).toBeGreaterThan(positions[1] ?? 0);
    expect(shell.view.jumpTurn("next")).toBe(false);

    for (let index = 0; index < 2; index++) {
      const before = shell.scroll.scrollTop;
      expect(shell.view.jumpTurn("previous")).toBe(true);
      await settle(setup);
      expect(shell.scroll.scrollTop).toBeLessThan(before);
    }
    expect(shell.view.jumpTurn("previous")).toBe(false);
  });

  test("advances through distinct tail turns when physical scrolling starts clamped", async () => {
    const { setup, shell } = await mount(80, 36);
    shell.view.sync(state(Array.from({ length: 10 }, (_, index) => turn(index))));
    await settle(setup);
    shell.scroll.scrollTo(Infinity);
    await settle(setup);

    const visited = new Set<number>();
    const visibleTurns = new Set<string>();
    for (let presses = 0; presses < 10; presses++) {
      if (!shell.view.jumpTurn("next")) break;
      await settle(setup);
      visited.add(shell.scroll.scrollTop);
      visibleTurns.add(visibleResponse(setup).text);
    }
    expect(visited.size).toBeGreaterThan(1);
    expect(visibleTurns.size).toBeGreaterThan(1);
    expect(shell.view.jumpTurn("next")).toBe(false);
    expect(shell.view.jumpTurn("next")).toBe(false);
  });

  test("wheel, page, reset, and latest remove temporary navigation space; resize keeps the turn", async () => {
    const { setup, shell } = await mount(60, 16);
    const turns = Array.from({ length: 8 }, (_, index) => turn(index));
    shell.view.sync(state(turns));
    await settle(setup);

    expect(shell.view.jumpTurn("next")).toBe(true);
    await settle(setup);
    expect(shell.view.navigationSlackRows).toBeGreaterThan(0);
    shell.view.scrollBy(-0.5, "viewport");
    await settle(setup);
    expect(shell.view.navigationSlackRows).toBe(0);
    expect(shell.view.isFollowingLatest).toBe(false);

    expect(shell.view.jumpTurn("next")).toBe(true);
    await settle(setup);
    const resizeAnchor = visibleResponse(setup);
    setup.resize(72, 18);
    await settle(setup);
    expect(rowOf(setup, resizeAnchor.text)).toBe(resizeAnchor.row);
    expect(shell.view.jumpTurn("previous")).toBe(true);
    await settle(setup);
    expect(visibleResponse(setup).text).not.toBe(resizeAnchor.text);
    expect(shell.view.jumpTurn("next")).toBe(true);
    await settle(setup);
    expect(visibleResponse(setup).text).toBe(resizeAnchor.text);
    shell.view.returnToLatest();
    await settle(setup);
    expect(shell.view.navigationSlackRows).toBe(0);
    expect(shell.view.isFollowingLatest).toBe(true);
    expect(lines(setup).join("\n")).toContain("response-7-0");

    while (shell.view.jumpTurn("next")) await settle(setup);
    expect(shell.view.navigationSlackRows).toBeGreaterThan(0);
    await setup.mockMouse.scroll(shell.scroll.viewport.x + 2, shell.scroll.viewport.y + 2, "up");
    await settle(setup);
    expect(shell.view.navigationSlackRows).toBe(0);

    expect(shell.view.jumpTurn("previous")).toBe(true);
    await settle(setup);
    shell.view.sync(state(turns.slice(0, 2), { id: "replacement-session" }), { reset: true });
    await settle(setup);
    expect(shell.view.navigationSlackRows).toBe(0);
    expect(shell.view.isFollowingLatest).toBe(true);
  });

  test("every painted frame of a jump shows the selected turn at its settled row", async () => {
    const { setup, shell } = await mount(80, 36);
    shell.view.sync(state(Array.from({ length: 30 }, (_, index) => turn(index, 2))));
    await settle(setup);
    while (shell.view.jumpTurn("next")) await settle(setup);
    expect(shell.view.navigationSlackRows).toBeGreaterThan(0);

    // Away from the tail, overscan mounts unmeasured turns above the target; back toward it,
    // each press asks for temporary space against the spacer the previous press requested.
    const seen: string[] = [];
    for (let press = 0; press < 12; press++) {
      const frames = await framesOf(setup, () => {
        expect(shell.view.jumpTurn(press < 6 ? "previous" : "next")).toBe(true);
      });
      const settled = topRequest(lines(setup));
      seen.push(settled.text);
      expect(frames.length).toBeGreaterThan(0);
      for (const frame of frames) expect(topRequest(frame)).toEqual(settled);
    }
    expect(seen).toEqual(
      [28, 27, 26, 25, 24, 23, 24, 25, 26, 27, 28, 29].map((index) => `request-${String(index)}`),
    );
    expect(shell.view.jumpTurn("next")).toBe(false);
  });

  test("a wheel step shorter than the tail space lands at the bottom and follows new output", async () => {
    const { setup, shell } = await mount(60, 24);
    const turns = Array.from({ length: 8 }, (_, index) => turn(index));
    shell.view.sync(state(turns));
    await settle(setup);
    const bottomRow = rowOf(setup, "response-7-0");
    while (shell.view.jumpTurn("next")) await settle(setup);
    const slack = shell.view.navigationSlackRows;
    expect(slack).toBeGreaterThan(3);
    const composerRow = () => lines(setup).findIndex((line) => line.includes("│ ❯"));

    shell.view.scrollBy(-(slack + 2));
    await settle(setup);
    expect(shell.view.isFollowingLatest).toBe(false);
    expect(lines(setup).join("\n")).toContain("ctrl+end latest ↓");
    expect(rowOf(setup, "response-7-0")).toBe(bottomRow + 2);

    shell.view.returnToLatest();
    await settle(setup);
    while (shell.view.jumpTurn("next")) await settle(setup);
    expect(shell.view.navigationSlackRows).toBe(slack);
    await setup.mockMouse.scroll(shell.scroll.viewport.x + 2, shell.scroll.viewport.y + 2, "up");
    await settle(setup);

    expect(rowOf(setup, "response-7-0")).toBe(bottomRow);
    expect(lines(setup).join("\n")).not.toContain("ctrl+end latest ↓");
    expect(shell.view.isFollowingLatest).toBe(true);

    shell.view.sync(
      state(turns, {
        liveText: Array.from({ length: 20 }, (_, index) => `stream-after-${String(index)}`).join(
          "\n",
        ),
      }),
    );
    await settle(setup);
    expect(rowOf(setup, "stream-after-19")).toBeGreaterThanOrEqual(0);
    expect(rowOf(setup, "stream-after-19")).toBeLessThan(composerRow());
  });
});

describe("TranscriptView follow ownership", () => {
  test("streaming while reading keeps the same historical text on the same screen row", async () => {
    const { setup, shell } = await mount(64, 18);
    const turns = Array.from({ length: 16 }, (_, index) => turn(index, 3));
    shell.view.sync(state(turns));
    await settle(setup);
    shell.view.scrollBy(-1, "viewport");
    await settle(setup);
    const anchor = visibleResponse(setup);

    shell.view.sync(
      state(turns, {
        liveText: Array.from({ length: 40 }, (_, index) => `stream-away-${String(index)}`).join(
          "\n",
        ),
      }),
    );
    await settle(setup);

    expect(rowOf(setup, anchor.text)).toBe(anchor.row);
    expect(shell.view.isFollowingLatest).toBe(false);
    expect(lines(setup).join("\n")).toContain("ctrl+end latest ↓");
    expect(lines(setup).join("\n")).not.toContain("stream-away-39");
  });

  test("following output keeps its newest row above the composer and latest returns there", async () => {
    const { setup, shell } = await mount(64, 18);
    const turns = Array.from({ length: 12 }, (_, index) => turn(index, 2));
    shell.view.sync(state(turns, { liveText: "stream-pinned-start" }));
    await settle(setup);
    shell.view.sync(
      state(turns, {
        liveText: Array.from({ length: 30 }, (_, index) => `stream-pinned-${String(index)}`).join(
          "\n",
        ),
      }),
    );
    await settle(setup);

    const newestRow = rowOf(setup, "stream-pinned-29");
    const composerRow = lines(setup).findIndex((line) => line.includes("│ ❯"));
    expect(newestRow).toBeGreaterThanOrEqual(0);
    expect(newestRow).toBeLessThan(composerRow);
    expect(shell.view.isFollowingLatest).toBe(true);

    shell.view.scrollBy(-1, "viewport");
    await settle(setup);
    expect(lines(setup).join("\n")).toContain("ctrl+end latest ↓");
    const latest = shell.root.findDescendantById("latest-control");
    if (latest === undefined) throw new Error("The latest control is not mounted");
    await setup.mockMouse.click(latest.x, latest.y);
    await settle(setup);
    expect(rowOf(setup, "stream-pinned-29")).toBeLessThan(
      lines(setup).findIndex((line) => line.includes("│ ❯")),
    );
    expect(lines(setup).join("\n")).not.toContain("ctrl+end latest ↓");
  });

  test("long Markdown, tools, and Unicode keep an exact anchor through disclosure and reflow", async () => {
    const { setup, shell } = await mount(72, 22);
    const turns = Array.from({ length: 14 }, (_, index) => richTurn(index));
    shell.view.sync(state(turns));
    await settle(setup);

    const marker = "RICH-ANCHOR-006";
    const anchorRow = await alignTextAtViewportTop(setup, shell, marker);
    expect(anchorRow).toBe(shell.scroll.viewport.y);
    expect(shell.view.isFollowingLatest).toBe(false);

    shell.transcript.toolOutput.toggle();
    shell.renderer.requestRender();
    await settle(setup);
    expect(rowOf(setup, marker)).toBe(anchorRow);
    expect(findText(shell.scroll.content, "tool-006-row-23 λ")).toBeDefined();

    setup.resize(46, 22);
    await settle(setup);
    expect(rowOf(setup, marker)).toBe(anchorRow);
    expect(findText(shell.scroll.content, "東京 👩🏽‍💻 café")).toBeDefined();

    setup.resize(88, 22);
    await settle(setup);
    expect(rowOf(setup, marker)).toBe(anchorRow);
    shell.transcript.toolOutput.toggle();
    shell.renderer.requestRender();
    await settle(setup);
    expect(rowOf(setup, marker)).toBe(anchorRow);
  });

  test("a selection remains complete while scrolling and resizing across virtual windows", async () => {
    const { setup, shell } = await mount(70, 20);
    const turns = Array.from({ length: 40 }, (_, index) => turn(index));
    shell.view.sync(state(turns));
    await settle(setup);
    shell.view.scrollBy(-1, "content");
    await settle(setup);

    const first = findText(shell.scroll.content, "request-0");
    if (first === undefined) throw new Error("The first selection row is not mounted");
    shell.renderer.startSelection(first, first.x, first.y);
    const bottom = () => shell.scroll.viewport.y + shell.scroll.viewport.height - 1;
    for (let depth = 0; shell.renderer.getSelectionContainer() !== shell.scroll.content; depth++) {
      if (depth > 12) throw new Error("Selection did not reach the transcript container");
      shell.renderer.updateSelection(undefined, shell.scroll.viewport.x, bottom());
    }
    shell.renderer.requestRender();
    await settle(setup);

    let resized = false;
    for (let step = 0; !shell.view.isFollowingLatest; step++) {
      if (step > 300) throw new Error("Selection did not reach the latest turn");
      shell.renderer.updateSelection(shell.scroll.content, shell.scroll.viewport.x + 20, bottom());
      shell.view.scrollBy(3);
      await settle(setup);
      if (!resized && step === 20) {
        setup.resize(56, 22);
        await settle(setup);
        resized = true;
      }
    }

    const last = findText(shell.scroll.content, "response-39-0");
    if (last === undefined) throw new Error("The last selection row is not mounted");
    shell.renderer.updateSelection(shell.scroll.content, last.x + last.width, last.y, {
      finishDragging: true,
    });
    const selected = shell.renderer.getSelection()?.getSelectedText();
    if (selected === undefined) throw new Error("The transcript selection was lost");
    for (let index = 0; index < turns.length; index++) {
      expect(selected).toContain(`request-${String(index)}`);
      expect(selected).toContain(`response-${String(index)}-0`);
    }
    expect(resized).toBe(true);
    expect(shell.view.mountedItemCount).toBe(turns.length);

    shell.renderer.clearSelection();
    shell.renderer.requestRender();
    await settle(setup);
    expect(shell.view.mountedItemCount).toBeLessThan(30);
  });

  test("notice, completion, and picker rows are disjoint and preserve a history anchor", async () => {
    const { setup, shell } = await mount(64, 20);
    const turns = Array.from({ length: 18 }, (_, index) => turn(index, 3));
    shell.view.sync(state(turns));
    await settle(setup);
    shell.view.scrollBy(-1, "viewport");
    await settle(setup);
    const anchor = visibleResponse(setup);

    notice(shell, ["notice-one", "notice-two"]);
    await settle(setup);
    expect(rowOf(setup, anchor.text)).toBe(anchor.row);
    const latest = shell.root.findDescendantById("latest");
    const live = shell.root.findDescendantById("live");
    const composer = shell.root.findDescendantById("composer");
    const ephemeral = shell.root.findDescendantById("ephemeral");
    if (
      latest === undefined ||
      live === undefined ||
      composer === undefined ||
      ephemeral === undefined
    )
      throw new Error("The footer regions are not mounted");
    expect(shell.scroll.viewport.y + shell.scroll.viewport.height).toBeLessThanOrEqual(latest.y);
    expect(latest.y + latest.height).toBeLessThanOrEqual(live.y);
    expect(composer.y + composer.height).toBeLessThanOrEqual(ephemeral.y);
    clearNotice(shell);
    await settle(setup);
    expect(rowOf(setup, anchor.text)).toBe(anchor.row);

    const completion = new BoxRenderable(shell.renderer, { id: "completion", height: 3 });
    completion.add(new TextRenderable(shell.renderer, { content: "completion-choice" }));
    holdSlot(shell, completion, 3);
    await settle(setup);
    expect(rowOf(setup, anchor.text)).toBe(anchor.row);
    expect(completion.y).toBeGreaterThanOrEqual(composer.y + composer.height);
    expect(completion.y + completion.height).toBeLessThanOrEqual(ephemeral.y + ephemeral.height);
    releaseSlot(shell, completion);
    await settle(setup);
    expect(rowOf(setup, anchor.text)).toBe(anchor.row);

    const picker = openPanel(shell, panel(shell, "picker-choice", 3));
    await settle(setup);
    expect(rowOf(setup, anchor.text)).toBe(anchor.row);
    closePanel(shell, picker);
    await settle(setup);
    expect(rowOf(setup, anchor.text)).toBe(anchor.row);

    shell.view.returnToLatest();
    await settle(setup);
    const newest = "response-17-2";
    const newestAboveComposer = (): boolean =>
      rowOf(setup, newest) >= 0 &&
      rowOf(setup, newest) < lines(setup).findIndex((line) => line.includes("│ ❯"));
    expect(newestAboveComposer()).toBe(true);
    notice(shell, ["pinned-notice-one", "pinned-notice-two"]);
    await settle(setup);
    expect(newestAboveComposer()).toBe(true);
    expect(shell.view.isFollowingLatest).toBe(true);
    clearNotice(shell);
    holdSlot(shell, completion, 3);
    await settle(setup);
    expect(newestAboveComposer()).toBe(true);
    expect(shell.view.isFollowingLatest).toBe(true);
    releaseSlot(shell, completion);
    const pinnedPicker = openPanel(shell, panel(shell, "pinned-picker", 3));
    await settle(setup);
    expect(newestAboveComposer()).toBe(true);
    expect(shell.view.isFollowingLatest).toBe(true);
    closePanel(shell, pinnedPicker);
    await settle(setup);
    expect(newestAboveComposer()).toBe(true);
    expect(shell.view.isFollowingLatest).toBe(true);
  });

  test("wheel input moves exactly three transcript rows without taking composer focus", async () => {
    const { setup, shell } = await mount(64, 18);
    shell.view.sync(state(Array.from({ length: 20 }, (_, index) => turn(index, 2))));
    await settle(setup);
    const before = shell.scroll.scrollTop;
    expect(shell.input.focused).toBe(true);

    await setup.mockMouse.scroll(shell.scroll.viewport.x + 2, shell.scroll.viewport.y + 2, "up");
    await settle(setup);

    expect(before - shell.scroll.scrollTop).toBe(3);
    expect(shell.input.focused).toBe(true);
    expect(shell.view.isFollowingLatest).toBe(false);
    expect(lines(setup).join("\n")).toContain("ctrl+end latest ↓");
  });

  test("a large transcript keeps a bounded mounted window while its ends stay reachable", async () => {
    const { setup, shell } = await mount(70, 20);
    const turns = Array.from({ length: 400 }, (_, index) => turn(index, 2));
    shell.view.sync(state(turns));
    await settle(setup);
    expect(lines(setup).join("\n")).toContain("response-399-1");
    expect(shell.view.mountedItemCount).toBeLessThan(50);

    shell.view.scrollBy(-1, "content");
    await settle(setup);
    expect(lines(setup).join("\n")).toContain("request-0");
    expect(shell.view.mountedItemCount).toBeLessThan(50);
    expect(shell.view.cachedHeightCount).toBeLessThanOrEqual(1_024);
  });
});
