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
  return page.getByRole("region", { name: "Messages", exact: true });
}

export function chatTab(page: Page, name: string): Locator {
  return page.getByRole("tablist", { name: "Tabs" }).getByRole("tab", { name, exact: true });
}

export function chatRow(page: Page, name: string): Locator {
  return sidebar(page).getByRole("button", { name: new RegExp(`^(Unread )?${name} `, "u") });
}

export async function revealChat(page: Page, name: string): Promise<Locator> {
  const row = chatRow(page, name);
  const more = sidebar(page).getByRole("button", { name: /^Show \d+ More$/u });
  await expect(row.or(more).first()).toBeVisible();

  while (!(await row.isVisible())) await more.first().click();

  return row;
}

export async function openChat(page: Page, name: string): Promise<void> {
  await (await revealChat(page, name)).click();
  await expect(chatTab(page, name)).toHaveAttribute("aria-selected", "true");
}

export async function send(page: Page, text: string): Promise<void> {
  const field = composer(page);
  await field.fill(text);
  await expect(field).toHaveText(text);
  await expect(page.getByRole("button", { name: "Send message" })).toBeEnabled();
  await field.press("Enter");
  await expect(field).not.toHaveText(text);
}

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

export async function openSettings(page: Page, title: string): Promise<void> {
  if (!(await settingsNav(page).isVisible()))
    await sidebar(page).getByRole("link", { name: "Settings", exact: true }).click();

  await settingsNav(page).getByRole("link", { name: title, exact: true }).click();
  await expect(page.getByRole("heading", { name: title, level: 1 })).toBeVisible();
}

export async function leaveSettings(page: Page): Promise<void> {
  await settingsNav(page).getByRole("button", { name: "Back", exact: true }).click();
  await expect(sidebar(page)).toBeVisible();
}
