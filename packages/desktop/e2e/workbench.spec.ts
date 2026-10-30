import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
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

const NOTES = `---
title: Field notes
tags: [e2e, markdown]
---

# Field notes

The quick brown fox jumps.

- [x] Render the document
- [ ] Edit in place

See [the guide](guide.md).
`;

test("the workbench journey", async ({ desktop }) => {
  const { page } = desktop;
  const notesPath = join(desktop.home, "notes.md");
  await writeFile(notesPath, NOTES);
  await writeFile(join(desktop.home, "guide.md"), "# Guide\n");

  await test.step("the rail opens into a panel with an empty tab strip", async () => {
    await openChat(page, FIXTURES.beta);
    const rail = workbench(page).getByRole("navigation", { name: "Workbench navigation" });
    await expect(rail.getByRole("button")).toContainText([
      "Files",
      "Changes",
      "New Browser",
      "New Terminal",
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

  await test.step("a markdown file opens as a document, edits in place and saves only the edit", async () => {
    const files = workbench(page).getByRole("region", { name: "Files" });
    await files.getByRole("button", { name: "Show Explorer" }).click();
    await files.getByRole("treeitem", { name: /notes\.md/u }).click();
    const editor = files.getByRole("textbox", { name: "notes.md" });
    await expect(editor.getByRole("heading", { name: "Field notes", level: 1 })).toBeVisible();
    await expect(files.getByRole("definition")).toHaveText(["Field notes", "[e2e, markdown]"]);
    await expect(editor.getByRole("checkbox")).toHaveCount(2);

    const paragraph = editor.getByRole("paragraph").filter({ hasText: "The quick brown fox" });
    const box = await paragraph.boundingBox();
    const caretPlaced = page.evaluate(
      () =>
        new Promise<void>((done) => {
          document.addEventListener("selectionchange", () => done(), { once: true });
        }),
    );
    await paragraph.click({ position: { x: (box?.width ?? 8) - 4, y: (box?.height ?? 8) / 2 } });
    await caretPlaced;
    for (let count = 0; count < "jumps.".length; count += 1) await page.keyboard.press("Backspace");
    await page.keyboard.type("leaps.");
    await page.keyboard.press("ControlOrMeta+s");
    await expect(files.getByText("Saved", { exact: true })).toBeVisible();
    await expect.poll(() => readFile(notesPath, "utf8")).toBe(NOTES.replace("jumps.", "leaps."));

    await files.getByRole("button", { name: "File options" }).click();
    await page.getByRole("menuitem", { name: "View Source" }).click();
    await expect(files.getByText("title: Field notes")).toBeVisible();
    await expect(editor.getByRole("heading")).toHaveCount(0);
    await files.getByRole("button", { name: "File options" }).click();
    await page.getByRole("menuitem", { name: "View Document" }).click();
    await expect(editor.getByRole("heading", { name: "Field notes", level: 1 })).toBeVisible();

    await editor.getByRole("link", { name: "the guide" }).click({ modifiers: ["ControlOrMeta"] });
    await expect(
      files.getByRole("textbox", { name: "guide.md" }).getByRole("heading", { name: "Guide" }),
    ).toBeVisible();

    const tabs = workbenchTabs(page);
    await closeTab(tabs, tabs.getByRole("tab", { name: "guide.md" }));
    await closeTab(tabs, tabs.getByRole("tab", { name: "notes.md" }));
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

  await test.step("the rail lists each open tab once and only the launchers that add one", async () => {
    await page.getByRole("button", { name: "Close workbench panel" }).click();

    const rows = workbench(page)
      .getByRole("navigation", { name: "Workbench navigation" })
      .getByRole("button");

    for (const label of ["Files", "Changes", "Browser", "New Browser", "New Terminal"]) {
      await expect(rows.filter({ hasText: new RegExp(`^${label}$`, "u") })).toHaveCount(1);
    }

    await rows.filter({ hasText: /^New Terminal$/u }).click();
    await expect(workbenchTabs(page).getByRole("tab")).toHaveCount(5);

    const terminal = workbench(page)
      .getByRole("tabpanel")
      .getByRole("region", { name: "Terminal" });

    await terminal.getByRole("textbox", { name: "Terminal input" }).focus();
    await page.keyboard.type("exit\r");
    await expect(terminal.getByRole("status")).toHaveText(/Shell exited/u);
  });

  await test.step("closing every tab collapses the panel and brings the rail back", async () => {
    const tabs = workbenchTabs(page);

    for (const name of ["Browser", "Changes", "Files"]) {
      await closeTab(tabs, tabs.getByRole("tab", { name, exact: true }));
    }

    await tabs.getByRole("tab").first().press("Delete");
    await expect(tabs.getByRole("tab")).toHaveCount(1);
    await tabs.getByRole("tab").first().press("Delete");
    await expect(tabs.getByRole("tab")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open workbench panel" })).toBeVisible();
    await expect(
      workbench(page)
        .getByRole("navigation", { name: "Workbench navigation" })
        .getByRole("button", { name: "Files" }),
    ).toBeVisible();
  });
});
