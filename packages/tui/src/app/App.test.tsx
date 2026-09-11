/**
 * The screen under a test renderer: every state the UI store can hold is
 * driven through the same functions the terminal uses, and each expectation
 * is what a frame shows. Nothing here reaches into a renderable.
 */
import { afterEach, describe, expect, test } from "bun:test";
import { BoxRenderable, TextRenderable } from "@opentui/core";
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing";
import { DEFAULT_LANDING } from "@nyte-ai/core";
import { laneRoles } from "../lanes.ts";
import { DARK_THEME, LIGHT_THEME } from "../theme.ts";
import { mountShell } from "./App.tsx";
import {
  clearNotice,
  closePanel,
  holdSlot,
  notice,
  openPanel,
  patchStatus,
  releaseSlot,
  setHints,
  type EphemeralPanel,
  type Shell,
} from "./ui.ts";

const WIDTH = 60;
const HEIGHT = 16;

async function mount(): Promise<{ readonly setup: TestRendererSetup; readonly shell: Shell }> {
  const setup = await createTestRenderer({ width: WIDTH, height: HEIGHT });
  const shell = await mountShell({
    renderer: setup.renderer,
    initialTheme: DARK_THEME,
    roles: laneRoles(DEFAULT_LANDING),
    openPath: () => undefined,
  });
  return { setup, shell };
}

async function frame(setup: TestRendererSetup): Promise<string> {
  await setup.renderOnce();
  return setup.captureCharFrame();
}

function panel(shell: Shell, text: string, rows: number): EphemeralPanel {
  const container = new BoxRenderable(shell.renderer, { id: `panel-${text}`, height: rows });
  container.add(new TextRenderable(shell.renderer, { id: `panel-text-${text}`, content: text }));
  return {
    container,
    rows,
    hints: `${text.split(" ")[0]?.toLowerCase() ?? "panel"} keys`,
    focus: () => undefined,
    blur: () => undefined,
    destroy: () => container.destroy(),
  };
}

const mounted: TestRendererSetup[] = [];
afterEach(() => {
  for (const setup of mounted.splice(0)) setup.renderer.destroy();
});

describe("screen", () => {
  test("paints the composer, its rule, and the hint row from the store", async () => {
    const { setup, shell } = await mount();
    mounted.push(setup);
    patchStatus(shell, {
      workspace: "nyte",
      branch: "main",
      dirty: false,
      model: "gpt",
      effort: "high",
    });
    setHints(shell, "enter send · esc tree (twice)");
    const shown = await frame(setup);
    expect(shown).toContain("❯");
    expect(shown).toContain("nyte main │ gpt │ high");
    expect(shown).toContain("enter send · esc tree (twice)");
  });

  test("a loading line shows while something loads and leaves when it is done", async () => {
    const { setup, shell } = await mount();
    mounted.push(setup);
    shell.setUi("loading", "Loading session…");
    expect(await frame(setup)).toContain("Loading session…");
    shell.setUi("loading", undefined);
    expect(await frame(setup)).not.toContain("Loading session…");
  });

  test("a notice takes rows under the composer until it is taken back", async () => {
    const { setup, shell } = await mount();
    mounted.push(setup);
    notice(shell, "Model: gpt · high");
    expect(await frame(setup)).toContain("Model: gpt · high");
    clearNotice(shell);
    expect(await frame(setup)).not.toContain("Model: gpt · high");
  });

  test("a notice never takes more than its share of a short screen", async () => {
    const { setup, shell } = await mount();
    mounted.push(setup);
    notice(
      shell,
      Array.from({ length: 12 }, (_, index) => `line ${String(index)}`),
    );
    const shown = await frame(setup);
    expect(shown).toContain("line 0");
    expect(shown).not.toContain("line 11");
    expect(shown).toContain("❯");
  });

  test("a panel holds the slot and the keyboard; a notice said meanwhile waits for it to close", async () => {
    const { setup, shell } = await mount();
    mounted.push(setup);
    const opened = openPanel(shell, panel(shell, "Pick a model", 3));
    let shown = await frame(setup);
    expect(shown).toContain("Pick a model");
    expect(shown).toContain("pick keys");
    expect(shell.ui.selecting).toBe(true);
    notice(shell, "Said while picking");
    expect(await frame(setup)).not.toContain("Said while picking");
    closePanel(shell, opened);
    shown = await frame(setup);
    expect(shown).not.toContain("Pick a model");
    expect(shown).toContain("Said while picking");
    expect(shell.ui.selecting).toBe(false);
  });

  test("a second panel cannot open over the first", async () => {
    const { setup, shell } = await mount();
    mounted.push(setup);
    openPanel(shell, panel(shell, "first", 1));
    expect(() => openPanel(shell, panel(shell, "second", 1))).toThrow(
      "Another panel is already open",
    );
  });

  test("the completion dropdown borrows the slot without taking the keyboard", async () => {
    const { setup, shell } = await mount();
    mounted.push(setup);
    const dropdown = new BoxRenderable(shell.renderer, { id: "dropdown", height: 2 });
    dropdown.add(new TextRenderable(shell.renderer, { id: "dropdown-text", content: "/quit" }));
    holdSlot(shell, dropdown, 2);
    expect(await frame(setup)).toContain("/quit");
    expect(shell.ui.selecting).toBe(false);
    releaseSlot(shell, dropdown);
    expect(await frame(setup)).not.toContain("/quit");
  });

  test("a full screen replaces the chat and composer but keeps the hint row", async () => {
    const { setup, shell } = await mount();
    mounted.push(setup);
    setHints(shell, "esc back");
    const screen = new BoxRenderable(shell.renderer, { id: "inspector" });
    screen.add(
      new TextRenderable(shell.renderer, { id: "inspector-text", content: "Task output" }),
    );
    shell.setUi("screen", screen);
    let shown = await frame(setup);
    expect(shown).toContain("Task output");
    expect(shown).toContain("esc back");
    expect(shown).not.toContain("❯");
    shell.setUi("screen", undefined);
    shown = await frame(setup);
    expect(shown).not.toContain("Task output");
    expect(shown).toContain("❯");
  });

  test("an overlay covers the chat and leaves with its panel", async () => {
    const { setup, shell } = await mount();
    mounted.push(setup);
    const report = panel(shell, "Usage report", 1);
    openPanel(shell, report);
    shell.setUi("overlay", report.container);
    expect(await frame(setup)).toContain("Usage report");
    shell.setUi("overlay", undefined);
    closePanel(shell, report);
    expect(await frame(setup)).not.toContain("Usage report");
  });

  test("a retheme recolors the frame without replacing what it shows", async () => {
    const { setup, shell } = await mount();
    mounted.push(setup);
    setHints(shell, "enter send");
    await frame(setup);
    const before = setup.captureSpans();
    shell.setTheme(LIGHT_THEME);
    const after = await frame(setup);
    expect(after).toContain("enter send");
    expect(setup.captureSpans()).not.toEqual(before);
  });

  test("a resize keeps the composer within the screen", async () => {
    const { setup, shell } = await mount();
    mounted.push(setup);
    setHints(shell, "enter send");
    setup.resize(40, 8);
    const shown = await frame(setup);
    expect(shown).toContain("❯");
    expect(shown).toContain("enter send");
    expect(shown.trimEnd().split("\n").length).toBeLessThanOrEqual(8);
  });
});
