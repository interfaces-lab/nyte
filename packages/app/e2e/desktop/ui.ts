/**
 * Locators for the surfaces more than one chapter drives, named as the
 * accessibility tree names them.
 */
import { expect } from "@playwright/test";
import type { Locator, Page } from "@playwright/test";

export function sidebar(page: Page): Locator {
  return page.getByRole("navigation", { name: "Sessions and workspaces" });
}

export function chatPane(page: Page): Locator {
  return page.getByRole("region", { name: "Active chat pane" });
}

export function composer(page: Page): Locator {
  return page.getByRole("combobox", { name: "Message" });
}

export function messages(page: Page): Locator {
  return page.getByRole("region", { name: "Messages" }).getByRole("log");
}

export function chatTab(page: Page, name: string): Locator {
  return page.getByRole("tablist", { name: "Tabs" }).getByRole("tab", { name, exact: true });
}

/** A chat's sidebar row, whichever shelf holds it and whether or not it is unread. */
export function chatRow(page: Page, name: string): Locator {
  return sidebar(page).getByRole("button", { name: new RegExp(`^(Unread )?${name} `, "u") });
}

/** Opens a seeded chat from the sidebar, unfolding the Done shelf when it moved there. */
export async function openChat(page: Page, name: string): Promise<void> {
  const row = chatRow(page, name);

  if (!(await row.isVisible()))
    await sidebar(page)
      .getByRole("button", { name: /^Done \d+$/u })
      .click();

  await row.click();
  await expect(chatTab(page, name)).toHaveAttribute("aria-selected", "true");
}

/** Replaces the composer text and sends it with Enter. */
export async function send(page: Page, text: string): Promise<void> {
  const field = composer(page);
  await field.fill(text);
  await expect(field).toHaveText(text);
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
  await field.press("Enter");
  await expect(field).not.toHaveText(text);
}

/** Empties the composer the way a user would, and waits until the editor agrees. */
export async function clearComposer(page: Page): Promise<void> {
  const field = composer(page);
  await field.press("ControlOrMeta+a");
  await field.press("Backspace");
  await expect(field).toHaveText("");
}

export async function openNewChat(page: Page): Promise<void> {
  await sidebar(page).getByRole("button", { name: "New Chat ⌘ N" }).click();
  await expect(chatTab(page, "New chat")).toHaveAttribute("aria-selected", "true");
  await expect(composer(page)).toHaveAttribute("data-placeholder", /^Ask Nyte/u);
}

export function settingsNav(page: Page): Locator {
  return page.getByRole("navigation", { name: "Settings", exact: true });
}

/** Opens a settings page; the sidebar swaps to the settings list while one is open. */
export async function openSettings(page: Page, title: string): Promise<void> {
  if (!(await settingsNav(page).isVisible()))
    await sidebar(page).getByRole("link", { name: "Settings", exact: true }).click();

  await settingsNav(page).getByRole("link", { name: title, exact: true }).click();
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
}

/** Leaves settings for the chat that was open before. */
export async function leaveSettings(page: Page): Promise<void> {
  await settingsNav(page).getByRole("button", { name: "Back", exact: true }).click();
  await expect(sidebar(page)).toBeVisible();
}
