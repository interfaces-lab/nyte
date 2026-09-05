import { afterEach, beforeEach, describe, expect, test } from "vitest";
import type { Api, Model } from "@nyte-ai/ai";
import { DEFAULT_LANDING } from "@nyte-ai/core";
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing";
import { laneRoles } from "../src/lanes.ts";
import { ModelPicker, type ModelSelection } from "../src/model-picker.ts";
import { buildShell, closePanel, openPanel, setHints, type Shell } from "../src/shell.ts";
import { DARK_THEME } from "../src/theme.ts";

const terra: Model<Api> = {
  id: "terra",
  name: "GPT Terra",
  provider: "openai",
  api: "openai-responses",
  baseUrl: "https://example.invalid",
  reasoning: true,
  modes: ["fast"],
  thinkingLevelMap: { off: null, minimal: null, xhigh: "xhigh", max: "max" },
  input: ["text"],
  cost: { input: 2, output: 12, cacheRead: 0.2, cacheWrite: 0 },
  contextWindow: 200_000,
  maxTokens: 32_000,
};
const fable: Model<Api> = {
  ...terra,
  id: "fable",
  name: "Claude Fable",
  provider: "anthropic",
  modes: [],
  cost: { input: 10, output: 50, cacheRead: 1, cacheWrite: 0 },
  thinkingLevelMap: { off: null, minimal: null, xhigh: null, max: null },
};
const simple: Model<Api> = { ...terra, id: "simple", name: "Simple", reasoning: false, modes: [] };

describe("model picker", () => {
  let setup: TestRendererSetup;
  let shell: Shell;
  let picked: ModelSelection[];
  let failures: unknown[];

  beforeEach(async () => {
    setup = await createTestRenderer({
      width: 100,
      height: 30,
      useThread: false,
      kittyKeyboard: true,
      openConsoleOnError: false,
    });
    shell = buildShell(setup.renderer, DARK_THEME, laneRoles(DEFAULT_LANDING), () => {});
    picked = [];
    failures = [];
    setup.renderer.start();
    await setup.waitForVisualIdle();
  });
  afterEach(() => setup.renderer.destroy());

  function open(
    models: readonly Model<Api>[] = [terra, fable, simple],
    load = async () => models,
    current = terra,
  ): ModelPicker {
    const panel = new ModelPicker({
      renderer: setup.renderer,
      theme: DARK_THEME,
      nextId: shell.nextId,
      models,
      current,
      thinkingLevel: "medium",
      fastModes: new Map([["fast:openai", false]]),
      load,
      onSelect: (selection) => {
        picked.push(selection);
        closePanel(shell, panel);
      },
      onCancel: () => closePanel(shell, panel),
      onRows: (rows) => shell.ephemeral.setRows(rows),
      onHints: (hints) => setHints(shell, hints),
      onError: (cause) => failures.push(cause),
    });
    return openPanel(shell, panel);
  }

  async function frame(): Promise<string> {
    await setup.waitForVisualIdle();
    return setup.captureCharFrame();
  }

  test("edits effort and fast mode in one row, then confirms them together", async () => {
    const panel = open();
    expect(await frame()).toContain("$0.2 / 1M");
    setup.mockInput.pressArrow("right");
    expect(await frame()).toContain("High");
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressArrow("right");
    expect(await frame()).toContain("← Fast mode On →");
    expect(await frame()).toContain("$4 / 1M");
    expect(await frame()).toContain("$24 / 1M");
    expect(panel.queryInput.value).toBe("");
    expect(shell.input.plainText).toBe("");
    expect(picked).toEqual([]);
    setup.mockInput.pressEnter();
    expect(picked).toEqual([
      { model: terra, thinkingLevel: "high", fast: { settingId: "fast:openai", enabled: true } },
    ]);
    expect(shell.input.focused).toBe(true);
  });

  test("keeps row drafts while navigating and only commits the chosen model", async () => {
    open();
    await frame();
    setup.mockInput.pressArrow("right");
    setup.mockInput.pressArrow("down");
    expect(await frame()).toContain("$50 / 1M");
    setup.mockInput.pressArrow("left");
    setup.mockInput.pressArrow("up");
    expect(await frame()).toContain("openai/terra · High");
    setup.mockInput.pressArrow("down");
    setup.mockInput.pressEnter();
    expect(picked).toEqual([{ model: fable, thinkingLevel: "low", fast: undefined }]);
  });

  test("Escape discards edits even with search text and restores composer input", async () => {
    const panel = open();
    await frame();
    setup.mockInput.pressArrow("right");
    await setup.mockInput.typeText("terra");
    expect(panel.queryInput.value).toBe("terra");
    setup.mockInput.pressEscape();
    setup.mockInput.pressKey("x");
    expect(picked).toEqual([]);
    expect(shell.input.plainText).toBe("x");
    open();
    setup.mockInput.pressEnter();
    expect(picked[0]?.thinkingLevel).toBe("medium");
  });

  test("searches by model and provider, and prevents selection with no matches", async () => {
    const panel = open();
    await frame();
    await setup.mockInput.typeText("anthropic fab");
    expect(await frame()).toContain("1/3");
    expect(await frame()).not.toContain("GPT Terra");
    panel.queryInput.value = "missing";
    expect(await frame()).toContain("No matching models");
    setup.mockInput.pressEnter();
    expect(picked).toEqual([]);
    panel.queryInput.value = "simple";
    setup.mockInput.pressArrow("right");
    setup.mockInput.pressKey("TAB");
    expect(panel.hints).not.toContain("←→");
    setup.mockInput.pressEnter();
    expect(picked[0]).toEqual({ model: simple, thinkingLevel: "off", fast: undefined });
  });

  test("bounds effort, skips unsupported levels, and keeps Tab on the row", async () => {
    const panel = open([fable]);
    await frame();
    setup.mockInput.pressArrow("right");
    setup.mockInput.pressArrow("right");
    setup.mockInput.pressKey("TAB");
    setup.mockInput.pressArrow("left");
    expect(panel.hints).toContain("←→ reasoning effort");
    setup.mockInput.pressEnter();
    expect(picked[0]?.thinkingLevel).toBe("medium");
  });

  test("scrolls the current model into view and keeps it selectable after resizing", async () => {
    const models = Array.from({ length: 25 }, (_, index) => ({
      ...terra,
      id: `model-${index}`,
      name: `Model ${index}`,
    }));
    const current = models[20] ?? terra;
    open(models, async () => models, current);
    expect(await frame()).toContain("↑ more above");
    expect(await frame()).toContain("❯ Model 20");
    setup.resize(42, 16);
    expect(await frame()).toContain("❯ Model 20");
    expect(await frame()).toContain("esc");
    setup.mockInput.pressArrow("up");
    setup.mockInput.pressEnter();
    expect(picked[0]?.model.id).toBe("model-19");
  });

  test("selects the current model when the catalog loads", async () => {
    const pending = Promise.withResolvers<readonly Model<Api>[]>();
    const panel = open([], () => pending.promise, fable);
    expect(await frame()).toContain("Loading models");
    pending.resolve([terra, fable]);
    expect(await frame()).toContain("❯ Claude Fable");
    expect(panel.queryInput.value).toBe("");
    setup.mockInput.pressEnter();
    expect(picked[0]?.model).toEqual(fable);
  });

  test("keeps cached choices usable on refresh failure and ignores a late load after close", async () => {
    const failure = new Error("offline");
    open([terra], async () => {
      throw failure;
    });
    expect(await frame()).toContain("GPT Terra");
    expect(failures).toEqual([failure]);
    setup.mockInput.pressEscape();
    const pending = Promise.withResolvers<readonly Model<Api>[]>();
    open([], () => pending.promise);
    setup.mockInput.pressEscape();
    pending.resolve([fable]);
    await frame();
    expect(shell.selecting).toBe(false);
    expect(shell.input.focused).toBe(true);
    expect(picked).toEqual([]);
  });
});
