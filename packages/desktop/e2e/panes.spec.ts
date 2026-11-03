import type { Locator, Page } from "@playwright/test";
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

/** Each pane's floor in the app's pane layout. */
const PANE_WIDTH_MIN = 320;

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
    const lane = (await box(sash)).width;

    await drag(page, handle, { x: leading.x + width * target + lane / 2, y: handle.y });
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
    await expect(handle).toHaveAttribute("aria-valuenow", "214");
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

    const active = await page.evaluate(() =>
      getComputedStyle(document.documentElement).getPropertyValue("--nyte-active-workbench-width"),
    );

    expect(Number.parseFloat(active)).toBeCloseTo(after.width, 0);
    await page.getByRole("button", { name: "Close workbench panel" }).click();
  });
});
