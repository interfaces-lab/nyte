import type { Locator, Page } from "@playwright/test";
import { FIXTURES } from "./baseline.ts";
import { expect, test } from "./fixtures.ts";
import {
  chatPane,
  chatRow,
  chatTab,
  menuShortcut,
  messages,
  openChat,
  openNewChat,
  primaryKey,
  revealChat,
  send,
  shiftKey,
  sidebar,
} from "./ui.ts";

test.use({ chapter: "navigation" });

async function closeMenus(page: Page): Promise<void> {
  await expect(async () => {
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toHaveCount(0, { timeout: 500 });
  }).toPass();
}

/** Rows move with a layout animation, so hover until the row's action shows. */
async function hoverAction(row: Locator, action: Locator): Promise<Locator> {
  await expect(async () => {
    await row.hover();
    await expect(action).toBeVisible({ timeout: 500 });
  }).toPass();

  return action;
}

/** Clicks a hover action; a click that times out never landed, so retrying it is safe. */
async function clickAction(row: Locator, action: Locator): Promise<void> {
  await expect(async () => {
    await row.hover();
    await action.click({ timeout: 1_000 });
  }).toPass();
}

async function chooseGrouping(page: Page, grouping: string): Promise<void> {
  await sidebar(page).getByRole("button", { name: "Customize sidebar" }).click();
  await page.getByRole("menuitem", { name: "Grouping" }).click();
  await page.getByRole("menuitemradio", { name: grouping }).click();
  await closeMenus(page);
}

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

  await test.step("a tab and a sidebar row open the chat's card, and its folder line copies the path", async () => {
    const folder = page.getByRole("button", { name: /Local$/u });
    const tab = chatTab(page, FIXTURES.beta);
    await tab.hover();
    await expect(folder).toBeVisible();
    await expect(folder).toHaveAccessibleDescription("Click to copy");
    const tabBox = await tab.boundingBox();
    expect((await folder.boundingBox())?.y).toBeGreaterThan(tabBox?.y ?? Infinity);
    await folder.click();
    await expect(folder).toHaveAccessibleDescription("Copied");
    expect(await desktop.application.evaluate(({ clipboard }) => clipboard.readText())).toBe(
      desktop.home,
    );
    await page.keyboard.press("Escape");
    await expect(folder).toBeHidden();

    const row = await revealChat(page, FIXTURES.alpha);
    await row.hover();
    await expect(folder).toBeVisible();
    const rowBox = await row.boundingBox();
    expect((await folder.boundingBox())?.x).toBeGreaterThan(
      (rowBox?.x ?? 0) + (rowBox?.width ?? 0),
    );
    await page.keyboard.press("Escape");
    await expect(folder).toBeHidden();
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

test("the sidebar journey", async ({ desktop }) => {
  const { page } = desktop;
  const workspace = sidebar(page).getByRole("button", { name: "home", exact: true });
  const workspaces = sidebar(page).getByRole("region", { name: "Workspaces" });
  const pinned = sidebar(page).getByRole("region", { name: "Pinned" });

  await test.step("a 260 px sidebar shows 24 px Pin and Archive beside the age", async () => {
    await chooseGrouping(page, "Repository");
    await expect(workspace).toHaveAttribute("aria-expanded", "true");

    expect(
      await page.evaluate(() =>
        getComputedStyle(document.documentElement).getPropertyValue("--nyte-sidebar-width").trim(),
      ),
    ).toBe("260px");

    const row = chatRow(page, FIXTURES.long);
    const age = row.locator('[data-slot="row-meta"]');

    for (const action of ["Pin", "Archive"]) {
      const button = await hoverAction(
        row,
        sidebar(page).getByRole("button", { name: `${action} ${FIXTURES.long}` }),
      );

      await expect(age).toBeVisible();
      const box = await button.boundingBox();
      const ageBox = await age.boundingBox();
      expect(box?.width).toBe(24);
      expect(box?.height).toBe(24);
      expect((box?.x ?? 0) + (box?.width ?? 0)).toBeLessThanOrEqual(ageBox?.x ?? 0);
    }
  });

  await test.step("Mark as Read and Mark All as Read clear unread marks through the host", async () => {
    const thinking = await revealChat(page, FIXTURES.thinking);
    await expect(thinking).toHaveAccessibleName(/^Unread /u);
    await thinking.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Mark as Read" }).click();
    await expect(chatRow(page, FIXTURES.thinking)).not.toHaveAccessibleName(/^Unread /u);
    await expect(chatRow(page, FIXTURES.long)).toHaveAccessibleName(/^Unread /u);
    await workspace.click({ button: "right" });
    await page.getByRole("menuitem", { name: "Mark All as Read" }).click();
    await expect(chatRow(page, FIXTURES.long)).not.toHaveAccessibleName(/^Unread /u);
  });

  await test.step("Pin moves a chat into Pinned above the workspaces, and Unpin returns it", async () => {
    await clickAction(
      chatRow(page, FIXTURES.long),
      sidebar(page).getByRole("button", { name: `Pin ${FIXTURES.long}` }),
    );
    await expect(chatRow(page, FIXTURES.long)).toHaveCount(1);
    await expect(pinned.getByText(FIXTURES.long, { exact: true })).toBeVisible();
    await expect(workspaces.getByText(FIXTURES.long, { exact: true })).toHaveCount(0);
    await clickAction(
      chatRow(page, FIXTURES.long),
      sidebar(page).getByRole("button", { name: `Unpin ${FIXTURES.long}` }),
    );
    await expect(pinned).toHaveCount(0);
    await expect(workspaces.getByText(FIXTURES.long, { exact: true })).toBeVisible();
  });

  await test.step("the open chat stays under its folded workspace", async () => {
    await openChat(page, FIXTURES.alpha);
    await workspace.click();
    await expect(workspace).toHaveAttribute("aria-expanded", "false");
    await expect(chatRow(page, FIXTURES.alpha)).toBeVisible();
    await expect(chatRow(page, FIXTURES.long)).toBeHidden();
  });

  await test.step("grouping and folds survive a reload", async () => {
    await chooseGrouping(page, "Status");
    await page.reload();
    await page.locator("[data-nyte-shell]").waitFor({ state: "visible" });
    await expect(workspace).toHaveAttribute("aria-expanded", "false");
    await sidebar(page).getByRole("button", { name: "Customize sidebar" }).click();
    await page.getByRole("menuitem", { name: "Grouping" }).click();
    await expect(page.getByRole("menuitemradio", { name: "Status" })).toHaveAttribute(
      "aria-checked",
      "true",
    );
    await closeMenus(page);
  });

  await test.step("arrow keys move focus without opening a chat, and fold and unfold", async () => {
    await workspace.click();
    await expect(workspace).toHaveAttribute("aria-expanded", "true");
    const tabs = page.getByRole("tablist", { name: "Tabs" });
    const selected = tabs.getByRole("tab", { selected: true });
    const before = await selected.textContent();
    await workspace.press("ArrowRight");
    await expect(workspace).not.toBeFocused();
    await page.keyboard.press("ArrowDown");
    const focused = page.locator('[data-slot="row-primary"]:focus [data-slot="row-label"]');
    const name = await focused.textContent();
    expect(name).not.toBeNull();
    expect(await selected.textContent()).toBe(before);
    await page.keyboard.press("Enter");
    await expect(chatTab(page, name ?? "")).toHaveAttribute("aria-selected", "true");
    await page.keyboard.press("ArrowLeft");
    await expect(workspace).toBeFocused();
    await page.keyboard.press("ArrowLeft");
    await expect(workspace).toHaveAttribute("aria-expanded", "false");
    await page.keyboard.press("ArrowRight");
    await expect(workspace).toHaveAttribute("aria-expanded", "true");
  });

  await test.step("double-click renames in place, and Escape keeps the title", async () => {
    await (await revealChat(page, FIXTURES.composer)).dblclick();
    const field = sidebar(page).getByRole("textbox", { name: `Rename ${FIXTURES.composer}` });
    await expect(field).toBeFocused();
    await field.pressSequentially("Something else");
    await field.press("Escape");
    await expect(field).toHaveCount(0);
    await expect(chatRow(page, FIXTURES.composer)).toBeVisible();
  });

  await test.step("archiving a working chat asks first, and Cancel keeps it running", async () => {
    await openNewChat(page);
    await send(page, "/hold");
    await expect(messages(page).getByRole("paragraph").last()).toContainText("Holding");
    const held = sidebar(page).getByRole("button", { name: /^Working \/hold /u });
    const archive = sidebar(page).getByRole("button", { name: "Archive /hold" });
    const dialog = page.getByRole("alertdialog", { name: "Archive Working Chat" });
    const stop = chatPane(page).getByRole("button", { name: "Stop response" });
    await clickAction(held, archive);
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel" }).click();
    await expect(dialog).toBeHidden();
    await expect(held).toBeVisible();
    await expect(stop).toBeVisible();
    await clickAction(held, archive);
    await dialog.getByRole("button", { name: "Archive Chat" }).click();
    await expect(held).toHaveCount(0);
    await page.getByRole("button", { name: "Undo" }).click();
    await held.click();
    await stop.click();
    await expect(stop).toBeHidden();
  });

  await test.step("the Archived filter lists archived chats only", async () => {
    await clickAction(
      chatRow(page, FIXTURES.markdown),
      sidebar(page).getByRole("button", { name: `Archive ${FIXTURES.markdown}` }),
    );
    await expect(chatRow(page, FIXTURES.markdown)).toHaveCount(0);
    await sidebar(page).getByRole("button", { name: "Customize sidebar" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Archived" }).click();
    await closeMenus(page);
    await expect(chatRow(page, FIXTURES.markdown)).toBeVisible();
    await expect(chatRow(page, FIXTURES.beta)).toHaveCount(0);
  });
});
