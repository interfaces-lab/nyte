import type { Locator, Page } from "@playwright/test";
import { FIXTURES } from "./baseline.ts";
import { expect, test } from "./fixtures.ts";
import {
  chatPane,
  chatRow,
  chatTab,
  menuShortcut,
  openChat,
  primaryKey,
  revealChat,
  shiftKey,
  sidebar,
} from "./ui.ts";

test.use({ chapter: "navigation" });

async function dragTab(page: Page, from: Locator, to: Locator): Promise<void> {
  const start = await from.boundingBox();
  const end = await to.boundingBox();

  if (start === null || end === null) throw new Error("A tab to drag is hidden");
  const y = start.y + start.height / 2;
  await page.mouse.move(start.x + start.width / 2, y);
  await page.mouse.down();
  await page.mouse.move(end.x + end.width / 4, y, { steps: 10 });
  await page.mouse.up();
}

test("the navigation journey", async ({ desktop }) => {
  const { page } = desktop;

  await test.step("opening a chat selects its tab and marks it read", async () => {
    await expect(await revealChat(page, FIXTURES.alpha)).toHaveAccessibleName(/^Unread /u);
    await openChat(page, FIXTURES.alpha);
    await expect(chatRow(page, FIXTURES.alpha)).not.toHaveAccessibleName(/^Unread /u);
    await expect(chatPane(page).getByRole("region", { name: "Messages" })).toContainText(
      "Echo: Hello from alpha",
    );
  });

  await test.step("a plain click previews a chat in one italic tab, which the next click replaces", async () => {
    const tabs = page.getByRole("tablist", { name: "Tabs" }).getByRole("tab");
    await expect(tabs).toHaveCount(1);
    await expect(tabs).toHaveAccessibleName(`${FIXTURES.alpha}, preview`);
    await expect(tabs).toHaveCSS("font-style", "italic");
    await openChat(page, FIXTURES.beta);
    await expect(tabs).toHaveCount(1);
    await expect(tabs).toHaveAccessibleName(`${FIXTURES.beta}, preview`);
    await page.keyboard.press("ControlOrMeta+Shift+T");
    await expect(tabs, "the replaced preview isn't reopened").toHaveCount(1);
  });

  await test.step("double-click keeps a preview, and a modified click opens a chat behind", async () => {
    const tabs = page.getByRole("tablist", { name: "Tabs" }).getByRole("tab");
    await chatTab(page, FIXTURES.beta).dblclick();
    await expect(chatTab(page, FIXTURES.beta)).toHaveAccessibleName(FIXTURES.beta);
    await expect(chatTab(page, FIXTURES.beta)).toHaveCSS("font-style", "normal");
    await openChat(page, FIXTURES.alpha);
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(1)).toHaveAccessibleName(`${FIXTURES.alpha}, preview`);
    await (await revealChat(page, FIXTURES.sidebar)).click({ modifiers: ["ControlOrMeta"] });
    await expect(tabs).toHaveCount(3);
    await expect(tabs.nth(2), "a chat opened behind is kept").toHaveAccessibleName(
      new RegExp(`^${FIXTURES.sidebar}(, unread)?$`, "u"),
    );
    await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "false");
    await expect(chatTab(page, FIXTURES.alpha)).toHaveAttribute("aria-selected", "true");
  });

  await test.step("New tab adds a new chat, and closing it goes back to the chat before it", async () => {
    const tabs = page.getByRole("tablist", { name: "Tabs" }).getByRole("tab");
    const before = await tabs.count();
    await page.getByRole("button", { name: "New tab" }).click();
    await expect(tabs).toHaveCount(before + 1);
    await expect(chatTab(page, "New chat")).toHaveAttribute("aria-selected", "true");
    await chatTab(page, "New chat").click({ button: "middle" });
    await expect(tabs).toHaveCount(before);
    await expect(chatTab(page, FIXTURES.alpha)).toHaveAttribute("aria-selected", "true");
  });

  await test.step("Chat actions offers the two splits", async () => {
    await page.getByRole("button", { name: "Chat actions" }).click();
    const menu = page.getByRole("menu", { name: "Chat actions" });
    await expect(
      menu.getByRole("menuitem", { name: `Split Down ${menuShortcut(shiftKey, primaryKey, "D")}` }),
    ).toBeVisible();
    await expect(
      menu.getByRole("menuitem", { name: `Split Right ${menuShortcut(primaryKey, "D")}` }),
    ).toBeVisible();
    await expect(menu.getByRole("menuitem")).toHaveCount(2);
    await page.keyboard.press("Escape");
    await expect(menu).toBeHidden();
  });

  await test.step("Environments opens in its own tab", async () => {
    await sidebar(page).getByRole("button", { name: "Environments" }).click();
    await expect(chatTab(page, "Environments")).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { level: 2 })).toHaveText([
      "Remote access",
      "Manual setup",
      "Server",
    ]);
    await expect(page.getByRole("button", { name: "Connect Server" })).toBeDisabled();
    await expect(page.getByRole("textbox", { name: "Server URL" })).toBeEmpty();
  });

  await test.step("Customize lists the plugins", async () => {
    await sidebar(page).getByRole("button", { name: "Customize", exact: true }).click();
    await expect(chatTab(page, "Customize")).toHaveAttribute("aria-selected", "true");
    await expect(
      page.getByRole("tablist", { name: "Customize" }).getByRole("tab", { name: /^Plugins/u }),
    ).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Built in", level: 2 })).toBeVisible();
    await expect(page.getByRole("button", { name: "Open Plugins Folder" })).toBeVisible();
  });

  await test.step("Search lists recent chats and actions, filters by category and opens a result", async () => {
    await sidebar(page)
      .getByRole("button", { name: `Search ${primaryKey} K` })
      .click();
    const dialog = page.getByRole("dialog", { name: "Search chats and actions" });
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole("combobox", { name: "Search" })).toBeFocused();
    const results = dialog.getByRole("listbox", { name: "All" });
    await expect(
      results.getByRole("group", { name: "Recent chats" }).getByRole("option"),
    ).toHaveCount(Object.keys(FIXTURES).length);
    const actions = results.getByRole("group", { name: "Actions" });

    for (const name of [
      `New Chat ${primaryKey} N`,
      `Open Folder… ${primaryKey} O`,
      "General Settings",
      "Appearance",
      "Providers",
    ])
      await expect(actions.getByRole("option", { name, exact: true })).toBeVisible();

    const total = await results.getByRole("option").count();
    const count = dialog.getByText(/^\d+ results$/u);
    await expect(count).toHaveText(`${String(total)} results`);
    let shown = 0;

    for (const category of ["Chats", "Actions", "Settings"]) {
      await dialog.getByRole("tab", { name: category }).click();
      const options = await dialog.getByRole("option").count();
      await expect(count).toHaveText(`${String(options)} results`);
      shown += options;
    }

    expect(shown).toBe(total);
    await dialog.getByRole("tab", { name: "Chats" }).click();
    await expect(count).toHaveText(`${String(Object.keys(FIXTURES).length)} results`);
    await dialog.getByRole("combobox", { name: "Search" }).fill("markdown");
    await expect(dialog.getByRole("option")).toHaveText([/^Markdown showcase/u]);
    await dialog.getByRole("option", { name: /^Markdown showcase/u }).click();
    await expect(dialog).toBeHidden();
    await expect(chatTab(page, FIXTURES.markdown)).toHaveAttribute("aria-selected", "true");
  });

  await test.step("Escape closes Search without changing the tab", async () => {
    await page.keyboard.press("ControlOrMeta+k");
    const dialog = page.getByRole("dialog", { name: "Search chats and actions" });
    await expect(dialog).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(dialog).toBeHidden();
    await expect(chatTab(page, FIXTURES.markdown)).toHaveAttribute("aria-selected", "true");
  });

  await test.step("Inbox grouping folds read chats into the Done shelf and unfolds on demand", async () => {
    await sidebar(page).getByRole("button", { name: "Customize sidebar" }).click();
    await page.getByRole("menuitem", { name: "Grouping" }).click();
    await page.getByRole("menuitemradio", { name: "Inbox" }).click();
    await expect(async () => {
      await page.keyboard.press("Escape");
      await expect(page.getByRole("menu")).toHaveCount(0, { timeout: 500 });
    }).toPass();
    const done = sidebar(page).getByRole("button", { name: /^Done \d+$/u });
    await expect(done).toBeVisible();

    if ((await done.getAttribute("aria-expanded")) === "true") await done.click();

    await expect(done).toHaveAttribute("aria-expanded", "false");
    await expect(chatRow(page, FIXTURES.alpha)).toBeHidden();
    await done.click();
    await expect(chatRow(page, FIXTURES.alpha)).toBeVisible();
    await done.click();
    await expect(chatRow(page, FIXTURES.alpha)).toBeHidden();
  });

  await test.step("dragging a preview keeps it", async () => {
    const tabs = page.getByRole("tablist", { name: "Tabs" }).getByRole("tab");
    const preview = chatTab(page, FIXTURES.alpha);
    await expect(preview).toHaveAccessibleName(`${FIXTURES.alpha}, preview`);
    await dragTab(page, preview, tabs.nth(0));
    await expect(tabs.nth(0)).toHaveAccessibleName(FIXTURES.alpha);
  });
});
