import { FIXTURES } from "./baseline.ts";
import { expect, test } from "./fixtures.ts";
import { chatPane, openChat, primaryKey } from "./ui.ts";
import type { Locator, Page } from "@playwright/test";

test.use({ chapter: "workbench" });

function workbench(page: Page): Locator {
  return page.getByRole("complementary", { name: "Workbench" });
}

function workbenchTabs(page: Page): Locator {
  return page.getByRole("tablist", { name: "Workbench tabs" });
}

async function closeTab(tabs: Locator, tab: Locator): Promise<void> {
  const label = await tab.getAttribute("aria-label");
  const count = await tabs.getByRole("tab").count();
  await tab.hover({ position: { x: 8, y: 8 } });
  await tabs.getByRole("button", { name: `Close ${label} tab` }).click();
  await expect(tabs.getByRole("tab")).toHaveCount(count - 1);
}

async function openWorkbenchTab(page: Page, kind: string): Promise<void> {
  await page.getByRole("button", { name: "New workbench tab" }).click();
  await page
    .getByRole("menu", { name: "New workbench tab" })
    .getByRole("menuitem", { name: kind })
    .click();
}

test("the workbench journey", async ({ desktop }) => {
  const { page } = desktop;

  await test.step("the rail opens into a panel with an empty tab strip", async () => {
    await openChat(page, FIXTURES.beta);
    const rail = workbench(page).getByRole("navigation", { name: "Workbench navigation" });
    await expect(rail.getByRole("button")).toContainText([
      "Files",
      "Changes",
      "Browser",
      "Terminal",
    ]);
    await page.getByRole("button", { name: "Open workbench panel" }).click();
    await expect(page.getByRole("button", { name: "Close workbench panel" })).toHaveAttribute(
      "aria-pressed",
      "true",
    );
    await expect(workbenchTabs(page).getByRole("tab")).toHaveCount(0);
    await expect(
      workbench(page).getByRole("separator", { name: "Resize workbench" }),
    ).toBeVisible();
  });

  await test.step("New workbench tab offers Files, Changes, Browser and Terminal", async () => {
    await page.getByRole("button", { name: "New workbench tab" }).click();
    await expect(
      page.getByRole("menu", { name: "New workbench tab" }).getByRole("menuitem"),
    ).toHaveText(["Files", "Changes", "Browser", "Terminal"]);
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu", { name: "New workbench tab" })).toBeHidden();
  });

  await test.step("Files opens on the Start page over the home folder", async () => {
    await openWorkbenchTab(page, "Files");
    await expect(workbenchTabs(page).getByRole("tab", { name: "Files" })).toHaveAttribute(
      "aria-selected",
      "true",
    );

    const files = workbench(page)
      .getByRole("tabpanel", { name: "Files" })
      .getByRole("region", { name: "Files" });

    await expect(files.getByRole("navigation", { name: "File path" })).toHaveText("Files");
    await expect(files.getByRole("combobox", { name: "Go to file" })).toBeVisible();
    const start = files.getByRole("region", { name: "Start" });
    await expect(start.getByRole("button", { name: "Show Explorer" })).toBeVisible();
    await expect(
      start.getByRole("button", { name: `Search in Files ${primaryKey} F` }),
    ).toBeVisible();
  });

  await test.step("Changes reports that the home folder is not a repository", async () => {
    await openWorkbenchTab(page, "Changes");

    const changes = workbench(page)
      .getByRole("tabpanel", { name: "Changes" })
      .getByRole("region", { name: "Workspace changes" });

    await expect(changes.getByRole("button", { name: "Uncommitted 0 files" })).toBeVisible();
    await expect(changes.getByRole("status")).toHaveText(
      "Couldn't read changes. Check that this folder is a Git repository.",
    );
    await expect(workbenchTabs(page).getByRole("tab")).toHaveText(["Files", "Changes"]);
  });

  await test.step("Terminal opens a shell tab with a focused input", async () => {
    await openWorkbenchTab(page, "Terminal");
    const tab = workbenchTabs(page).getByRole("tab", { selected: true });
    await expect(tab).not.toHaveText(/^(Files|Changes|Browser)$/u);

    const terminal = workbench(page)
      .getByRole("tabpanel")
      .getByRole("region", { name: "Terminal" });

    await expect(terminal.getByRole("textbox", { name: "Terminal input" })).toBeVisible();
    await expect(terminal.getByRole("status")).toHaveCount(0);
    await terminal.getByRole("textbox", { name: "Terminal input" }).focus();
    await page.keyboard.type("exit\r");
    await expect(terminal.getByRole("status")).toHaveText(/Shell exited/u);
  });

  await test.step("Browser opens empty with its navigation disabled", async () => {
    await openWorkbenchTab(page, "Browser");

    const browser = workbench(page)
      .getByRole("tabpanel", { name: "Browser" })
      .getByRole("region", { name: "Browser" });

    await expect(browser.getByRole("button", { name: "Go back" })).toBeDisabled();
    await expect(browser.getByRole("button", { name: "Go forward" })).toBeDisabled();
    await expect(browser.getByRole("button", { name: "Reload page" })).toBeDisabled();
    await expect(browser.getByRole("combobox", { name: "Address" })).toBeVisible();
    await expect(browser.getByText("Type an address or a search")).toBeVisible();
    await expect(workbenchTabs(page).getByRole("tab")).toHaveCount(4);
  });

  await test.step("Expand workbench hides the chat into a tab panel and restores the split", async () => {
    await page.getByRole("button", { name: "Expand workbench" }).click();
    const restore = page.getByRole("button", { name: "Restore split view" });
    await expect(restore).toBeVisible();
    const chatTab = workbenchTabs(page).getByRole("tab", { name: FIXTURES.beta });
    const resize = workbench(page).getByRole("separator", { name: "Resize workbench" });
    await expect(chatTab).toBeVisible();
    await expect(resize).toBeHidden();
    await restore.click();
    await expect(page.getByRole("button", { name: "Expand workbench" })).toBeVisible();
    await expect(chatTab).toHaveCount(0);
    await expect(resize).toBeVisible();
    await expect(chatPane(page)).toBeVisible();
  });

  await test.step("closing every tab collapses the panel and brings the rail back", async () => {
    const tabs = workbenchTabs(page);

    for (const name of ["Browser", "Changes", "Files"]) {
      await closeTab(tabs, tabs.getByRole("tab", { name, exact: true }));
    }

    await closeTab(tabs, tabs.getByRole("tab").first());
    await expect(tabs.getByRole("tab")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open workbench panel" })).toBeVisible();
    await expect(
      workbench(page)
        .getByRole("navigation", { name: "Workbench navigation" })
        .getByRole("button", { name: "Files" }),
    ).toBeVisible();
  });
});
