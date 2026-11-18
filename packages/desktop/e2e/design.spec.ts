import { appendFile, cp, readFile } from "node:fs/promises";
import { join } from "node:path";
import { FIXTURES } from "./baseline.ts";
import { expect, test } from "./fixtures.ts";
import { openChat } from "./ui.ts";
import { captureWindow } from "./window-capture.ts";
import type { Locator, Page } from "@playwright/test";

test.use({ chapter: "design" });

const SAMPLE = join(import.meta.dirname, "design-sample");

function workbench(page: Page): Locator {
  return page.getByRole("complementary", { name: "Workbench" });
}

test("the Design tab draws the workspace's JSX designs in a sandbox, selects, retypes and moves them on disk, and keeps its chrome from their styles", async ({
  desktop,
}, testInfo) => {
  const page = desktop.page;
  const designs = join(desktop.home, "design");

  const capture = async (name: string): Promise<void> => {
    await testInfo.attach(name, await captureWindow(desktop, testInfo.outputPath(`${name}.png`)));
  };

  await cp(SAMPLE, designs, { recursive: true });
  await openChat(page, FIXTURES.beta);
  await workbench(page)
    .getByRole("navigation", { name: "Workbench navigation" })
    .getByRole("button", { name: "Design", exact: true })
    .click();

  const board = workbench(page).locator('iframe[title="Design board"]').contentFrame();
  const stage = board.getByRole("application", { name: "Design board" });

  await expect(board.locator('[data-frame="Tonight"]')).toBeVisible();
  await expect(board.locator('[data-label][data-name="Tonight · night"]')).toBeAttached();
  await expect(stage).not.toHaveAttribute("data-moving");
  await capture("design-tab");

  const list = workbench(page).getByRole("navigation", { name: "Designs" });

  await workbench(page).getByRole("button", { name: "Show designs" }).click();
  await expect(list).toBeVisible();
  await board.locator('[data-frame="Controls"]').getByText("Not tonight").click();
  await expect(board.locator('[data-ring="you"]')).toBeVisible();
  await expect(list.getByRole("button", { name: "Controls", exact: true })).toHaveAttribute(
    "aria-current",
    "true",
  );
  await capture("design-selection");

  await board.locator('[data-frame="Controls"]').getByText("Not tonight").dblclick();
  await expect(board.locator("[data-read-only]")).toBeVisible();

  await board.locator('[data-frame="Controls"]').getByText("CONTROLS", { exact: true }).dblclick();
  await page.keyboard.type("Board controls");
  await page.keyboard.press("Enter");
  await expect
    .poll(() => readFile(join(designs, "controls.jsx"), "utf8"))
    .toContain('<span className="caption ink-faint">Board controls</span>');
  await expect(board.locator('[data-frame="Controls"]').getByText("Board controls")).toBeVisible();
  await capture("design-text-edit");

  await expect(stage).not.toHaveAttribute("data-moving");
  await list.getByRole("button", { name: "Phase card", exact: true }).click();
  await expect(stage).not.toHaveAttribute("data-moving");
  const label = board.locator('[data-label][data-name="Phase card"]');
  await expect(label).toBeVisible();
  const box = await label.boundingBox();

  if (box === null) throw new Error("The Phase card label is not on screen.");
  await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width / 2 + 60, box.y + box.height / 2 + 30, { steps: 6 });
  await page.mouse.move(box.x + box.width / 2 + 120, box.y + box.height / 2 + 60, { steps: 6 });
  await expect(board.locator("[data-place]")).toBeVisible();
  await capture("design-frame-moving");
  await page.mouse.up();
  await expect
    .poll(async () => {
      const text = await readFile(join(designs, "blocks", "phase-card.jsx"), "utf8");
      const place = /data-frame="Phase card" data-x="(?<x>-?\d+)" data-y="(?<y>-?\d+)"/u.exec(text);

      return Math.min(Number(place?.groups?.["x"]), Number(place?.groups?.["y"]));
    })
    .toBeGreaterThan(0);
  await capture("design-frame-move");

  await workbench(page)
    .getByRole("button", { name: /^\d+%$/u })
    .click();
  await page.getByRole("menuitem", { name: "Zoom to Fit" }).click();
  await expect(stage).not.toHaveAttribute("data-moving");
  await board.locator('[data-frame="Tonight"]').getByText("Tonight", { exact: true }).click();

  const ring = board.locator('[data-ring="you"]').first();
  const tonight = board.locator('[data-label][data-name="Tonight"]');

  await expect(ring).toBeVisible();
  const chrome = async (): Promise<readonly string[]> => [
    await tonight.evaluate((node) => getComputedStyle(node).color),
    await ring.evaluate((node) => getComputedStyle(node).outlineStyle),
    await ring.evaluate((node) => getComputedStyle(node).outlineColor),
  ];
  const before = await chrome();

  await appendFile(
    join(designs, "tokens.css"),
    [
      "",
      "* { outline: 0 !important; color: red !important; box-shadow: none !important; }",
      ":root, * { --nyte-stroke-accent: red !important; --nyte-content-tertiary: red !important }",
      "",
    ].join("\n"),
  );
  await expect
    .poll(() =>
      board
        .locator('[data-frame="Tonight"]')
        .getByText("Tonight", { exact: true })
        .evaluate((node) => getComputedStyle(node).color),
    )
    .toBe("rgb(255, 0, 0)");
  await expect(board.locator('[data-glow="on"]').first()).toBeAttached();
  await expect(ring).toBeVisible();
  expect(await chrome()).toEqual(before);
  expect(before[1]).toBe("solid");
  expect(before).not.toContain("rgb(255, 0, 0)");
  expect(
    await board
      .locator('[data-glow="on"]')
      .first()
      .evaluate((node) => getComputedStyle(node).outlineColor),
  ).not.toBe("rgb(255, 0, 0)");
  await capture("design-hostile-style");
});
