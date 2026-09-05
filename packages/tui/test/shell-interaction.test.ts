import { afterEach, beforeEach, describe, expect, test } from "vitest";
import { DEFAULT_LANDING } from "@nyte-ai/core";
import { CliRenderEvents } from "@opentui/core";
import { createTestRenderer, type TestRendererSetup } from "@opentui/core/testing";
import { laneRoles } from "../src/lanes.ts";
import { closePanel, buildShell, openInlineMenu, openPanel, type Shell } from "../src/shell.ts";
import { DARK_THEME } from "../src/theme.ts";
import { UsagePanel } from "../src/usage-panel.ts";

describe("shell input ownership", () => {
  let setup: TestRendererSetup;
  let shell: Shell;

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
    await setup.waitForVisualIdle();
  });

  afterEach(() => setup.renderer.destroy());

  test("clicking the composer border leaves typing in its textarea", async () => {
    shell.input.blur();
    await setup.mockMouse.click(shell.inputBox.screenX, shell.inputBox.screenY);
    setup.mockInput.pressKey("x");
    expect(shell.input.plainText).toBe("x");
  });

  test("a menu keeps input ownership across composer clicks and terminal focus", async () => {
    const menu = openInlineMenu(
      shell,
      {
        title: "Choose",
        choices: [
          { id: "alpha", label: "alpha" },
          { id: "beta", label: "beta" },
        ],
        onSelect: () => {},
        onCancel: () => closePanel(shell, menu),
      },
      (cause) => {
        throw cause;
      },
    );
    await setup.waitForVisualIdle();
    await setup.mockMouse.click(shell.input.screenX, shell.input.screenY);
    setup.mockInput.pressKey("a");
    expect(shell.input.plainText).toBe("");
    expect(menu.queryInput.value).toBe("a");
    setup.renderer.emit(CliRenderEvents.BLUR);
    setup.renderer.emit(CliRenderEvents.FOCUS);
    setup.mockInput.pressKey("l");
    expect(menu.queryInput.value).toBe("al");
    setup.mockInput.pressEscape();
    setup.mockInput.pressEscape();
    setup.mockInput.pressKey("x");
    expect(shell.input.plainText).toBe("x");
  });

  test("a read-only panel does not edit the draft behind it", async () => {
    const panel = new UsagePanel(
      {
        renderer: setup.renderer,
        theme: DARK_THEME,
        nextId: shell.nextId,
        onRows: (rows) => shell.ephemeral.setRows(rows),
        onClose: () => closePanel(shell, panel),
      },
      {
        runs: { kind: "none" },
        headroom: { kind: "none" },
        workspace: { kind: "empty", title: "Usage", message: "No usage yet" },
      },
    );
    openPanel(shell, panel);
    setup.mockInput.pressKey("x");
    expect(shell.input.plainText).toBe("");
    setup.mockInput.pressEscape();
    setup.mockInput.pressKey("y");
    expect(shell.input.plainText).toBe("y");
  });

  test("menu mouse selection follows the visible row after scrolling and resizing", async () => {
    let picked: string | undefined;
    const menu = openInlineMenu(
      shell,
      {
        title: "Choose",
        choices: Array.from({ length: 30 }, (_, index) => ({
          id: String(index),
          label: `choice-${index}`,
        })),
        selectedId: "20",
        onSelect: (id) => {
          picked = id;
        },
        onCancel: () => closePanel(shell, menu),
      },
      (cause) => {
        throw cause;
      },
    );
    setup.resize(44, 16);
    await setup.waitForVisualIdle();
    const frame = setup.captureCharFrame().split("\n");
    const y = frame.findIndex((row) => row.includes("choice-20"));
    expect(y).toBeGreaterThanOrEqual(0);
    const x = frame[y]?.indexOf("choice-20");
    if (x === undefined) throw new Error("Missing visible row");
    await setup.mockMouse.click(x, y);
    expect(picked).toBe("20");
  });

  test("Escape dismisses a menu while its selected action is pending", async () => {
    const pending = Promise.withResolvers<void>();
    const menu = openInlineMenu(
      shell,
      {
        title: "Choose",
        choices: [{ id: "slow", label: "Slow action" }],
        onSelect: () => pending.promise,
        onCancel: () => closePanel(shell, menu),
      },
      (cause) => {
        throw cause;
      },
    );
    setup.mockInput.pressEnter();
    setup.mockInput.pressEscape();
    setup.mockInput.pressKey("x");
    expect(shell.input.plainText).toBe("x");
    await setup.renderOnce();
    expect(setup.captureCharFrame()).not.toContain("Slow action");
    pending.resolve();
    await pending.promise;
  });
});
