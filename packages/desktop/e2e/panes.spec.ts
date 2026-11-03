import type { Locator, Page } from "@playwright/test";
import { collectErrors } from "@nyte-ai/app/e2e/errors";
import { FIXTURES } from "./baseline.ts";
import { expect, test } from "./fixtures.ts";
import { chatTab, openChat, revealChat, sidebar } from "./ui.ts";

test.use({ chapter: "panes" });

interface Point {
  readonly x: number;
  readonly y: number;
}

type Region = "center" | "left" | "right" | "top" | "bottom";

/** Panes in reading order: the leading pane first. */
function panes(page: Page): Locator {
  return page.getByRole("region", { name: /^(Active )?chat pane$/u });
}

function transcript(pane: Locator): Locator {
  return pane.getByRole("region", { name: "Messages", exact: true });
}

function dropPreview(page: Page): Locator {
  return page.locator("[data-nyte-drop-preview]");
}

async function box(
  locator: Locator,
): Promise<{ x: number; y: number; width: number; height: number }> {
  const found = await locator.boundingBox();

  if (found === null) throw new Error("Expected a visible element");

  return found;
}

async function center(locator: Locator): Promise<Point> {
  const { x, y, width, height } = await box(locator);

  return { x: x + width / 2, y: y + height / 2 };
}

async function pointIn(locator: Locator, region: Region): Promise<Point> {
  const { x, y, width, height } = await box(locator);
  const inset = 12;

  switch (region) {
    case "center":
      return { x: x + width / 2, y: y + height / 2 };
    case "left":
      return { x: x + inset, y: y + height / 2 };
    case "right":
      return { x: x + width - inset, y: y + height / 2 };
    case "top":
      return { x: x + width / 2, y: y + inset };
    case "bottom":
      return { x: x + width / 2, y: y + height - inset };
  }
}

/** Presses at `from` and moves to `to` in steps, so every listener sees the pointer travel. */
async function press(page: Page, from: Point, to: Point): Promise<void> {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(to.x, to.y, { steps: 12 });
}

async function drag(page: Page, from: Point, to: Point): Promise<void> {
  await press(page, from, to);
  await page.mouse.up();
}

/** Tags an element so a later check can tell the same node from a remounted copy. */
async function tag(locator: Locator, name: string): Promise<void> {
  await locator.evaluate((element, value) => element.setAttribute("data-e2e-tag", value), name);
}

async function hasTag(locator: Locator, name: string): Promise<boolean> {
  return locator.evaluate((element, value) => element.getAttribute("data-e2e-tag") === value, name);
}

async function leadingShare(page: Page): Promise<number> {
  const leading = await box(panes(page).nth(0));
  const trailing = await box(panes(page).nth(1));

  return leading.width / (leading.width + trailing.width);
}

const TAB_TYPE = "application/x-nyte-tab";

const SESSION_TYPE = "application/x-nyte-session";

/**
 * One window's half of a native tab drag, as the browser sends it: press, pick up, then end with
 * `dropEffect` set by whoever took the drop. Returns the tab the drag carried. A real drag hands
 * the same events across windows; Playwright can't carry one there, so each half is sent itself.
 */
async function dragTabOut(
  tab: Locator,
  end: { readonly dropEffect: "move" | "none"; readonly screenX: number; readonly screenY: number },
): Promise<string> {
  return tab.evaluate(
    (element, { type, dropEffect, screenX, screenY }) => {
      const item = element.closest('[draggable="true"]');

      if (item === null) throw new Error("The tab can't be dragged");
      const rect = element.getBoundingClientRect();
      const point = { clientX: rect.left + rect.width / 2, clientY: rect.top + rect.height / 2 };
      const dataTransfer = new DataTransfer();
      element.dispatchEvent(
        new PointerEvent("pointerdown", { bubbles: true, isPrimary: true, button: 0, ...point }),
      );
      item.dispatchEvent(
        new DragEvent("dragstart", { bubbles: true, cancelable: true, dataTransfer, ...point }),
      );
      const carried = dataTransfer.getData(type);
      dataTransfer.dropEffect = dropEffect;
      item.dispatchEvent(
        new DragEvent("dragend", { bubbles: true, dataTransfer, ...point, screenX, screenY }),
      );

      return carried;
    },
    { type: TAB_TYPE, ...end },
  );
}

/** The other half: a drag from another window hovers `target` at `point` and drops there. */
async function dropFromAnotherWindow(
  page: Page,
  target: Locator,
  point: Point,
  data: { readonly type: string; readonly value: string },
): Promise<void> {
  await target.evaluate(
    (_element, { x, y, type, value }) => {
      const dataTransfer = new DataTransfer();
      dataTransfer.setData(type, value);
      const under = document.elementFromPoint(x, y);

      if (under === null) throw new Error("Nothing is under the drop point");
      const init = { bubbles: true, cancelable: true, dataTransfer, clientX: x, clientY: y };
      under.dispatchEvent(new DragEvent("dragenter", init));
      under.dispatchEvent(new DragEvent("dragover", init));
      under.dispatchEvent(new DragEvent("drop", init));
    },
    { ...point, ...data },
  );
  await page.evaluate(
    () => new Promise((done) => requestAnimationFrame(() => requestAnimationFrame(done))),
  );
}

function tabs(page: Page): Locator {
  return page.getByRole("tablist", { name: "Tabs" }).getByRole("tab");
}

/** Each pane's floor in the app's pane layout. */
const PANE_WIDTH_MIN = 256;

test("the panes journey", async ({ desktop }) => {
  const { page } = desktop;
  const sash = page.getByRole("separator", { name: "Resize chat panes" });

  await desktop.application.evaluate(({ BrowserWindow }) => {
    BrowserWindow.getAllWindows()[0]?.setSize(1440, 900);
  });
  await expect.poll(() => page.evaluate(() => innerWidth)).toBe(1440);

  await test.step("hovering a chat over a pane's edge previews the half it would take", async () => {
    await openChat(page, FIXTURES.alpha);
    await chatTab(page, FIXTURES.alpha).dblclick();
    await expect(panes(page)).toHaveCount(1);
    await expect(transcript(panes(page))).toContainText("Hello from alpha");
    await tag(transcript(panes(page)), "alpha");

    const pane = await box(panes(page));
    await press(
      page,
      await center(await revealChat(page, FIXTURES.beta)),
      await pointIn(panes(page), "right"),
    );
    const preview = await box(dropPreview(page));
    expect(preview.x).toBeCloseTo(pane.x + pane.width / 2, -1);
    expect(preview.width).toBeCloseTo(pane.width / 2, -1);
    await page.mouse.up();
  });

  await test.step("dropping on the edge splits, and the pane already open keeps its transcript", async () => {
    await expect(dropPreview(page)).toHaveCount(0);
    await expect(panes(page)).toHaveCount(2);
    await expect(transcript(panes(page).nth(0))).toContainText("Hello from alpha");
    await expect(transcript(panes(page).nth(1))).toContainText("Second beta turn");
    await expect(page.getByRole("region", { name: "Active chat pane" })).toHaveCount(1);
    await expect(panes(page).nth(1)).toHaveAccessibleName("Active chat pane");
    expect(
      await hasTag(transcript(panes(page).nth(0)), "alpha"),
      "the alpha pane didn't remount",
    ).toBe(true);
    expect(await leadingShare(page)).toBeCloseTo(0.5, 1);
  });

  await test.step("Escape cancels a drag without changing the panes", async () => {
    await press(
      page,
      await center(await revealChat(page, FIXTURES.sidebar)),
      await pointIn(panes(page).nth(0), "center"),
    );
    await expect(dropPreview(page)).toHaveCount(1);
    await page.keyboard.press("Escape");
    await expect(dropPreview(page)).toHaveCount(0);
    await page.mouse.up();
    await expect(transcript(panes(page).nth(0))).toContainText("Hello from alpha");
    expect(await hasTag(transcript(panes(page).nth(0)), "alpha")).toBe(true);
  });

  await test.step("the sash follows the pointer and stops at each pane's minimum", async () => {
    const leading = await box(panes(page).nth(0));
    const trailing = await box(panes(page).nth(1));
    const width = leading.width + trailing.width;
    const floor = PANE_WIDTH_MIN / width;
    expect(floor, "the window leaves room to resize").toBeLessThan(0.42);
    const target = (floor + 0.5) / 2;
    const handle = await center(sash);

    await drag(page, handle, { x: leading.x + width * target, y: handle.y });
    expect(await leadingShare(page)).toBeCloseTo(target, 1);
    expect(Number(await sash.getAttribute("aria-valuenow"))).toBeCloseTo(target * 100, -0.5);

    await drag(page, await center(sash), { x: leading.x + 10, y: handle.y });
    const clamped = await box(panes(page).nth(0));
    expect(clamped.width, "a pane never drops below its minimum").toBeGreaterThanOrEqual(
      PANE_WIDTH_MIN - 1,
    );
    expect(clamped.width).toBeLessThan(PANE_WIDTH_MIN + 4);
  });

  await test.step("double-clicking the sash resets an even split, and arrows step it by 2%", async () => {
    await sash.dblclick();
    await expect(sash).toHaveAttribute("aria-valuenow", "50");
    expect(await leadingShare(page)).toBeCloseTo(0.5, 1);

    await sash.focus();
    await page.keyboard.press("ArrowRight");
    await expect(sash).toHaveAttribute("aria-valuenow", "52");
    await page.keyboard.press("ArrowLeft");
    await expect(sash).toHaveAttribute("aria-valuenow", "50");
  });

  await test.step("the split ratio survives a reload", async () => {
    await sash.focus();
    await page.keyboard.press("ArrowLeft");
    await page.keyboard.press("ArrowLeft");
    await expect(sash).toHaveAttribute("aria-valuenow", "46");
    await page.reload();
    await expect(panes(page)).toHaveCount(2);
    await expect(sash).toHaveAttribute("aria-valuenow", "46");
    await sash.dblclick();
  });

  await test.step("dropping in a pane's center shows the chat there and leaves the other pane alone", async () => {
    await tag(transcript(panes(page).nth(1)), "beta");
    await drag(
      page,
      await center(await revealChat(page, FIXTURES.sidebar)),
      await pointIn(panes(page).nth(0), "center"),
    );
    await expect(transcript(panes(page).nth(0))).toContainText("Hello from the sidebar chat");
    await expect(transcript(panes(page).nth(1))).toContainText("Second beta turn");
    expect(
      await hasTag(transcript(panes(page).nth(1)), "beta"),
      "the beta pane didn't remount",
    ).toBe(true);
    await expect(panes(page).nth(0)).toHaveAccessibleName("Active chat pane");
  });

  await test.step("dropping on the top edge restacks the panes", async () => {
    await drag(
      page,
      await center(await revealChat(page, FIXTURES.beta)),
      await pointIn(panes(page).nth(0), "top"),
    );
    await expect(page.getByRole("separator", { name: "Resize chat panes" })).toHaveAttribute(
      "aria-orientation",
      "horizontal",
    );
    const top = await box(panes(page).nth(0));
    const bottom = await box(panes(page).nth(1));
    expect(top.y).toBeLessThan(bottom.y);
    await expect(transcript(panes(page).nth(0))).toContainText("Second beta turn");
    expect(
      await hasTag(transcript(panes(page).nth(0)), "beta"),
      "a moved pane keeps its transcript",
    ).toBe(true);
  });

  await test.step("the sidebar's handle resizes it and clamps to its range", async () => {
    const handle = page.getByRole("separator", { name: "Resize sidebar" });
    const before = await box(sidebar(page));
    const start = await center(handle);

    await drag(page, start, { x: start.x + 40, y: start.y });
    expect((await box(sidebar(page))).width).toBeCloseTo(before.width + 40, -1);

    await drag(page, await center(handle), { x: start.x + 600, y: start.y });
    await expect(handle).toHaveAttribute("aria-valuenow", "400");
    await handle.focus();
    await page.keyboard.press("Home");
    await expect(handle).toHaveAttribute("aria-valuenow", "210");
  });

  await test.step("the workbench's handle resizes it and the title bar follows", async () => {
    const workbench = page.getByRole("complementary", { name: "Workbench" });
    await page.getByRole("button", { name: "Open workbench panel" }).click();
    const handle = workbench.getByRole("separator", { name: "Resize workbench" });
    await expect(handle).toBeVisible();

    const panel = workbench
      .locator("section")
      .filter({ has: page.getByRole("separator", { name: "Resize workbench" }) });

    const before = await box(panel);
    const start = await center(handle);
    await drag(page, start, { x: start.x - 80, y: start.y });

    const after = await box(panel);
    expect(after.width).toBeCloseTo(before.width + 80, -1);

    const active = await page
      .getByRole("button", { name: "Close workbench panel" })
      .evaluate((button) => {
        const slot = button.closest("[style*='--nyte-active-workbench-width']");

        return slot === null
          ? ""
          : getComputedStyle(slot).getPropertyValue("--nyte-active-workbench-width");
      });

    expect(Number.parseFloat(active)).toBeCloseTo(after.width, 0);
    await page.getByRole("button", { name: "Close workbench panel" }).click();
  });

  await test.step("a tab dropped where no window is opens in a new window and leaves this one", async () => {
    await openChat(page, FIXTURES.composer);
    await chatTab(page, FIXTURES.composer).dblclick();
    await expect(tabs(page)).toHaveCount(2);

    const opened = desktop.application.waitForEvent("window");

    const bounds = await desktop.application.evaluate(({ BrowserWindow }) =>
      BrowserWindow.getAllWindows()[0]?.getBounds(),
    );

    if (bounds === undefined) throw new Error("The window has no bounds");
    await dragTabOut(chatTab(page, FIXTURES.composer), {
      dropEffect: "none",
      screenX: bounds.x + bounds.width + 400,
      screenY: bounds.y + 40,
    });

    const torn = await opened;
    const tornErrors = collectErrors(torn);
    await expect(chatTab(torn, FIXTURES.composer)).toHaveAttribute("aria-selected", "true");
    await expect(transcript(panes(torn))).toContainText("A first draft");
    await expect(tabs(page)).toHaveCount(1);
    await expect(chatTab(page, FIXTURES.composer)).toHaveCount(0);

    await test.step("a tab dropped on another window's strip moves there", async () => {
      const carried = await dragTabOut(chatTab(torn, FIXTURES.composer), {
        dropEffect: "move",
        screenX: 0,
        screenY: 0,
      });

      expect(JSON.parse(carried)).toMatchObject({ view: { kind: "panes" } });
      await expect(
        chatTab(torn, FIXTURES.composer),
        "the tab left the window it moved from",
      ).toHaveCount(0);

      const first = await box(tabs(page).first());
      await dropFromAnotherWindow(
        page,
        tabs(page).first(),
        { x: first.x + first.width - 2, y: first.y + first.height / 2 },
        { type: TAB_TYPE, value: carried },
      );
      await expect(tabs(page)).toHaveCount(2);
      await expect(chatTab(page, FIXTURES.composer)).toHaveAttribute("aria-selected", "true");
      await expect(tabs(page).nth(1)).toHaveAccessibleName(FIXTURES.composer);
    });

    await test.step("a chat dragged from another window lands on a pane's edge there", async () => {
      await dropFromAnotherWindow(torn, panes(torn), await pointIn(panes(torn), "right"), {
        type: SESSION_TYPE,
        value: desktop.sessions.alpha,
      });
      await expect(panes(torn)).toHaveCount(2);
      await expect(transcript(panes(torn).nth(1))).toContainText("Hello from alpha");
    });

    expect(tornErrors.pageErrors).toEqual([]);
    expect(tornErrors.consoleErrors.filter((text) => !text.startsWith("DEV:"))).toEqual([]);
    await torn.close();
  });
});
