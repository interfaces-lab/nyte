import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { FIXTURES } from "./baseline.ts";
import { expect, test } from "./fixtures.ts";
import { chatTab, composer, openChat } from "./ui.ts";
import type { Locator, Page } from "@playwright/test";

test.use({ chapter: "close-probe" });

const A = "export function first(): number {\n    return 1;\n}\n";
const B = "export function second(): number {\n    return 2;\n}\n";
const C = "export const third = 3;\n";

function workbench(page: Page): Locator {
  return page.getByRole("complementary", { name: "Workbench" });
}

function workbenchTabs(page: Page): Locator {
  return page.getByRole("tablist", { name: "Workbench tabs" });
}

function fileTabs(page: Page): Locator {
  return workbench(page).getByRole("tablist", { name: /^Editor group 1 files/u });
}

function editorPanel(page: Page): Locator {
  return workbench(page).getByRole("region", { name: "Editor", exact: true });
}

async function focusReport(page: Page): Promise<string> {
  return page.evaluate(() => {
    let active = document.activeElement;

    while (active?.shadowRoot?.activeElement) active = active.shadowRoot.activeElement;

    if (active === null) return "null";
    const label = active.getAttribute("aria-label") ?? "";
    const panel = active.closest("[data-editor-panel]") !== null ? " in editor panel" : "";

    return `${active.tagName.toLowerCase()} role=${active.getAttribute("role") ?? ""} label=${label}${panel}`;
  });
}

async function openEditor(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Open workbench panel" }).click();
  await workbench(page).getByRole("button", { name: "Editor", exact: true }).click();
  await expect(workbenchTabs(page).getByRole("tab", { name: "Editor" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

async function keepOpen(page: Page, name: string): Promise<void> {
  await editorPanel(page)
    .getByRole("treeitem", { name: new RegExp(name.replace(".", "\\."), "u") })
    .dblclick();
  await expect(fileTabs(page).getByRole("tab", { name, exact: true })).toHaveAttribute(
    "aria-selected",
    "true",
  );
}

test("⌘W closes what has focus and ⌘[ steps the editor's history", async ({ desktop }) => {
  const { page } = desktop;
  await writeFile(join(desktop.home, "a.ts"), A);
  await writeFile(join(desktop.home, "b.ts"), B);
  await writeFile(join(desktop.home, "c.ts"), C);

  await test.step("open a.ts then b.ts in the Editor", async () => {
    await openChat(page, FIXTURES.beta);
    await openEditor(page);
    await editorPanel(page).getByRole("button", { name: "Show Explorer" }).click();
    await keepOpen(page, "a.ts");
    await keepOpen(page, "b.ts");
  });

  await test.step("⌘[ inside the code editor returns to a.ts, ⌘] goes forward, nothing outdents", async () => {
    await editorPanel(page).getByRole("textbox", { name: "b.ts" }).click();
    console.log(`probe: focus before ⌘[: ${await focusReport(page)}`);
    await page.keyboard.press("Meta+BracketLeft");
    await expect(fileTabs(page).getByRole("tab", { name: "a.ts", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    console.log(`probe: focus after ⌘[: ${await focusReport(page)}`);
    await page.keyboard.press("Meta+BracketRight");
    await expect(fileTabs(page).getByRole("tab", { name: "b.ts", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(fileTabs(page).getByRole("tab", { name: /unsaved/u })).toHaveCount(0);
    expect(await readFile(join(desktop.home, "b.ts"), "utf8")).toBe(B);
  });

  await test.step("⌘W in the editor closes c.ts and the chat tab stays", async () => {
    await keepOpen(page, "c.ts");
    await editorPanel(page).getByRole("textbox", { name: "c.ts" }).click();
    await page.keyboard.press("Meta+w");
    await expect(fileTabs(page).getByRole("tab", { name: "c.ts", exact: true })).toHaveCount(0);
    await expect(fileTabs(page).getByRole("tab", { name: "b.ts", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(chatTab(page, FIXTURES.beta)).toHaveCount(1);
    console.log(`probe: focus after closing c.ts: ${await focusReport(page)}`);
  });

  await test.step("the next ⌘W, with focus where the close left it, closes b.ts", async () => {
    await page.keyboard.press("Meta+w");
    await expect(fileTabs(page).getByRole("tab", { name: "b.ts", exact: true })).toHaveCount(0);
    await expect(fileTabs(page).getByRole("tab", { name: "a.ts", exact: true })).toHaveAttribute(
      "aria-selected",
      "true",
    );
    await expect(chatTab(page, FIXTURES.beta)).toHaveCount(1);
    console.log(`probe: focus after closing b.ts: ${await focusReport(page)}`);
    await page.keyboard.type("zz");
    const typed = await fileTabs(page)
      .getByRole("tab", { name: /unsaved/u })
      .count();
    console.log(
      `probe: typing after the close reached a.ts: ${String(typed === 1)}; focus now: ${await focusReport(page)}`,
    );
  });

  await test.step("⌘W on a dirty a.ts shows the discard prompt", async () => {
    if (
      (await fileTabs(page)
        .getByRole("tab", { name: /unsaved/u })
        .count()) === 0
    ) {
      await editorPanel(page).getByRole("textbox", { name: "a.ts" }).click();
      await page.keyboard.type("zz");
    }
    await expect(
      fileTabs(page).getByRole("tab", { name: "a.ts, unsaved changes", exact: true }),
    ).toBeVisible();
    await page.keyboard.press("Meta+w");
    const prompt = page.getByRole("alertdialog", { name: "Discard Changes" });
    await expect(prompt).toBeVisible();
    await prompt.getByRole("button", { name: "Discard Changes" }).click();
    await expect(prompt).toBeHidden();
    await expect(fileTabs(page).getByRole("tab")).toHaveCount(0);
    expect(await readFile(join(desktop.home, "a.ts"), "utf8")).toBe(A);
    console.log(`probe: focus after discarding: ${await focusReport(page)}`);
  });

  await test.step("Close Tab from the native menu with no files closes the Editor tab", async () => {
    await expect(editorPanel(page).getByRole("region", { name: "Start" })).toBeVisible();
    await desktop.application.evaluate((electron) => {
      const items = (electron.Menu.getApplicationMenu()?.items ?? []).flatMap(
        (item) => item.submenu?.items ?? [],
      );

      items.find((item) => item.label === "Close Tab")?.click();
    });
    await expect(workbenchTabs(page).getByRole("tab")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open workbench panel" })).toBeVisible();
    await expect(chatTab(page, FIXTURES.beta)).toHaveCount(1);
  });

  await test.step("⌘W in the composer closes the chat tab, the workbench stays", async () => {
    await openChat(page, FIXTURES.alpha);
    await openEditor(page);
    await composer(page).click();
    await expect(chatTab(page, FIXTURES.alpha)).toHaveCount(1);
    await page.keyboard.press("Meta+w");
    await expect(chatTab(page, FIXTURES.alpha)).toHaveCount(0);
    await expect(workbenchTabs(page).getByRole("tab", { name: "Editor" })).toBeVisible();
  });
});
