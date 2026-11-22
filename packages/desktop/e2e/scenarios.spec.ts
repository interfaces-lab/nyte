import { readFile } from "node:fs/promises";
import { join } from "node:path";
import type { Locator, Page } from "@playwright/test";
import { WARM_REPLY } from "../src/host/fixtures/e2e-models.ts";
import {
  board,
  boardStill,
  caretStatus,
  closeWindow,
  editor,
  expect,
  goTo,
  openFile,
  CAPTION,
  CONTINUE,
  NOT_TONIGHT,
  RADIUS_END,
  test,
  wheelTo,
  workbench,
} from "./desk.ts";
import { messages, send } from "./ui.ts";

const WARM = /^rgb\((180, 83, 42|255, 207, 154)\)$/u;

const WARM_DAY_LINE = 13;

const WARM_NIGHT_LINE = 30;

function accent(page: Page): Promise<string> {
  return board(page)
    .locator('[data-frame="Controls"] .button:not(.quiet)')
    .evaluate((node) => getComputedStyle(node).backgroundColor);
}

function tokens(home: string): Promise<string> {
  return readFile(join(home, "design", "tokens.css"), "utf8");
}

async function showChat(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Restore split view" }).click();
  await expect(page.getByRole("combobox", { name: "Message" })).toBeVisible();
}

function composerChip(page: Page, label: string): Locator {
  return page.getByRole("form", { name: "Message", exact: true }).getByRole("button", {
    name: label,
    exact: true,
  });
}

test.describe("a designer's machine", () => {
  test.use({ opened: ["Studio"] });

  test("Studio alone draws the designs and still has the agent, whose change lights the board", async ({
    desk,
  }) => {
    const studio = desk.page("Studio");

    await closeWindow(desk.application, desk.page("Nyte"));
    expect(desk.application.windows()).toEqual([studio]);
    await expect(board(studio).locator('[data-frame="Tonight"]')).toBeVisible();
    await boardStill(studio);
    expect(await accent(studio)).not.toMatch(WARM);

    await showChat(studio);
    await send(studio, "/warm");
    await expect(board(studio).locator('[data-glow="on"]').first()).toBeAttached();
    await expect.poll(() => accent(studio)).toMatch(WARM);
    await expect(messages(studio).getByText(WARM_REPLY)).toBeVisible();
    await expect.poll(() => tokens(desk.home)).toContain("--accent: #b4532a;");
    await desk.capture(studio, "studio-alone");
  });
});

test.describe("a developer's machine", () => {
  test.use({ opened: ["Code"] });

  test("Code alone saves what is typed in it, and shows the agent beside it changing the open file", async ({
    desk,
  }) => {
    const code = desk.page("Code");

    await closeWindow(desk.application, desk.page("Nyte"));
    expect(desk.application.windows()).toEqual([code]);
    await desk.front(code);
    const text = await openFile(code, "design/tokens.css");

    await text.getByText("--radius-control").click();
    await code.keyboard.press("End");
    await expect(caretStatus(code)).toHaveText(
      `Ln ${String(RADIUS_END.line)}, Col ${String(RADIUS_END.column)}`,
    );
    await code.keyboard.type(" /* typed in Code */");
    await code.keyboard.press("ControlOrMeta+s");
    await expect
      .poll(() => tokens(desk.home))
      .toContain("--radius-control: 14px; /* typed in Code */\n");

    await showChat(code);
    await send(code, "/warm");
    await expect(messages(code).getByText(WARM_REPLY)).toBeVisible();
    await expect(text).toContainText("--accent: #b4532a;");
    await expect(text).toContainText("/* typed in Code */");
    await desk.capture(code, "code-alone");
  });
});

test.describe("one desk, three apps", () => {
  test.use({ opened: ["Code", "Studio"] });

  test("Nyte, Code and Studio share a selection, each other's edits and an agent's change as they happen", async ({
    desk,
  }) => {
    const nyte = desk.page("Nyte");
    const code = desk.page("Code");
    const studio = desk.page("Studio");
    const controls = board(studio).locator('[data-frame="Controls"]');
    const designs = workbench(studio).getByRole("navigation", { name: "Designs" });

    await desk.front(code);
    const source = await openFile(code, "design/controls.jsx");

    await desk.tile();
    await expect(controls).toBeVisible();
    await boardStill(studio);
    const showDesigns = workbench(studio).getByRole("button", { name: "Show designs" });

    if (await showDesigns.isVisible()) await showDesigns.click();
    await boardStill(studio);

    await test.step("a word double-clicked in Code's editor rings its element on Studio's board", async () => {
      const caption = source.getByText("CONTROLS", { exact: true });

      await wheelTo(code, source, caption, 200);
      await caption.dblclick();
      await expect(designs.getByRole("button", { name: "Controls", exact: true })).toHaveAttribute(
        "aria-current",
        "true",
      );
      await expect(board(studio).locator('[data-ring="you"]')).toBeVisible();
      await boardStill(studio);

      const ring = await board(studio).locator('[data-ring="you"]').first().boundingBox();
      const drawn = await controls.getByText("CONTROLS", { exact: true }).boundingBox();

      if (ring === null || drawn === null) throw new Error("The board drew no ring or caption.");
      expect(ring.x).toBeLessThanOrEqual(drawn.x + 1);
      expect(ring.y).toBeLessThanOrEqual(drawn.y + 1);
      expect(ring.x + ring.width).toBeGreaterThanOrEqual(drawn.x + drawn.width - 1);
      expect(ring.y + ring.height).toBeGreaterThanOrEqual(drawn.y + drawn.height - 1);
      await desk.capture(studio, "1-selection-studio");
    });

    await test.step("the selection puts nothing in a composer until Add to Chat adds it", async () => {
      const chip = `controls.jsx:${String(CAPTION.line)}`;

      const codeChip = code
        .getByRole("form", { name: "Message", exact: true, includeHidden: true })
        .getByRole("button", { name: chip, exact: true, includeHidden: true });

      await expect(codeChip).toHaveCount(0);
      await expect(composerChip(nyte, chip)).toHaveCount(0);
      await desk.front(code);
      await code.keyboard.press("ControlOrMeta+Shift+KeyL");
      await expect(codeChip).toHaveCount(1);
      await expect(composerChip(nyte, chip)).toHaveCount(0);
      await desk.capture(nyte, "1-selection-nyte");
    });

    await test.step("an element selected on Studio's board is selected in Code's editor", async () => {
      await desk.front(studio);
      await controls.getByText("Not tonight", { exact: true }).click();
      await expect(board(studio).locator('[data-ring="you"]')).toBeVisible();
      await expect(caretStatus(code)).toHaveText(
        `Ln ${String(NOT_TONIGHT.line)}, Col ${String(NOT_TONIGHT.end)}`,
      );
      await desk.capture(code, "1-selection-code");
    });

    await test.step("words retyped on Studio's board show in Code's open editor", async () => {
      await desk.front(studio);
      await controls.getByText("CONTROLS", { exact: true }).dblclick();
      await studio.keyboard.type("Desk controls");
      await studio.keyboard.press("Enter");
      await expect(source).toContainText(">Desk controls</span>");
      await desk.capture(code, "2-board-edit-code");
    });

    await test.step("an edit saved in Code redraws Studio's board", async () => {
      await desk.front(code);
      await goTo(code, CONTINUE.line, CONTINUE.column);
      await code.keyboard.type("Onward ");
      await expect(source).toContainText('label = "Onward Continue"');
      await code.keyboard.press("ControlOrMeta+s");
      await expect(controls.getByText("Onward Continue", { exact: true })).toBeVisible();
      await boardStill(studio);
      await desk.capture(studio, "3-code-edit-studio");
    });

    await test.step("an agent's change asked for in Nyte lights Studio's board and lands in Code's open editor, marked", async () => {
      const sheet = await openFile(code, "design/tokens.css");

      await desk.front(nyte);
      await send(nyte, "/warm");
      await expect(board(studio).locator('[data-glow="on"]').first()).toBeAttached();
      await expect.poll(() => accent(studio)).toMatch(WARM);
      await desk.capture(studio, "4-agent-studio");
      await expect(sheet).toContainText("--accent: #b4532a;");
      await expect(
        editor(code)
          .getByRole("group", { name: "Show" })
          .getByRole("button", { name: "Changed 1" }),
      ).toBeVisible();

      for (const line of [WARM_DAY_LINE, WARM_NIGHT_LINE]) {
        await expect(
          editor(code)
            .getByRole("tabpanel", { name: "design/tokens.css" })
            .locator(`[data-column-number="${String(line)}"]`)
            .first(),
        ).toHaveCSS("box-shadow", /inset/u);
      }
      await desk.capture(code, "4-agent-code");
      await expect(messages(nyte).getByText(WARM_REPLY)).toBeVisible();
      await desk.capture(nyte, "4-agent-nyte");
    });
  });
});
