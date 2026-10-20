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

export async function loadAllMessages(page: Page): Promise<string> {
  await scrollMessagesUntilSettled(page, "end");
  const oldest = await scrollMessagesUntilSettled(page, "top");
  await scrollMessagesUntilSettled(page, "end");

  return oldest;
}

async function scrollMessagesUntilSettled(page: Page, edge: "top" | "end"): Promise<string> {
  await page.evaluate(() => delete document.documentElement.dataset.benchScrollHeight);

  const settled = await page.waitForFunction(
    (target) => {
      const region = document.querySelector('[aria-label="Messages"]');
      const marks = document.documentElement.dataset;
      let node = region;

      while (node !== null && node.scrollHeight <= node.clientHeight) node = node.parentElement;

      if (region === null || node === null) return false;
      node.scrollTop = target === "top" ? 0 : node.scrollHeight;
      const height = String(node.scrollHeight);
      const steady = marks.benchScrollHeight === height ? Number(marks.benchScrollSteady) + 1 : 0;
      marks.benchScrollHeight = height;
      marks.benchScrollSteady = String(steady);

      const atEdge =
        target === "top" || node.scrollHeight - node.scrollTop - node.clientHeight <= 1;

      return steady >= 4 && atEdge
        ? { oldest: region.querySelector("[data-row-key]")?.textContent ?? "" }
        : false;
    },
    edge,
    { polling: 250, timeout: 120_000 },
  );

  const value = await settled.jsonValue();

  return value === false ? "" : value.oldest;
}

export async function revealRow(page: Page, title: string): Promise<void> {
  const row = chatRow(page, title);

  if (await row.isVisible()) return;
  const done = sidebar(page).getByRole("button", { name: /^Done ?\d+$/u });

  if ((await done.isVisible()) && (await done.getAttribute("aria-expanded")) !== "true")
    await done.click();

  const more = sidebar(page)
    .getByRole("button", { name: /^Show \d+ More$/iu })
    .first();

  while (!(await row.isVisible()) && (await more.isVisible())) await more.click();
  await row.waitFor();
}

export async function openChat(page: Page, name: string): Promise<void> {
  const row = chatRow(page, name);
  const done = sidebar(page).getByRole("button", { name: /^Done \d+$/u });
  await expect(row.or(done).first()).toBeVisible();

  if (!(await row.isVisible())) await done.click();

  await row.click();
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

export async function connectAnthropic(page: Page): Promise<void> {
  await page.keyboard.press("ControlOrMeta+,");
  await page.getByRole("link", { name: "Providers", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Providers", level: 1 })).toBeVisible();
  const offer = page.getByText("Claude models from Anthropic");
  await offer
    .or(page.getByText("Anthropic", { exact: true }))
    .first()
    .waitFor();

  if (await offer.isVisible()) {
    await offer.locator("xpath=ancestor::*[.//button][1]").getByRole("button").first().click();
    await page.getByRole("menuitem", { name: /API Key/u }).click();
    await page.getByPlaceholder(/API key/iu).fill("sk-ant-api03-bench");
    await page.keyboard.press("Enter");
    await expect(offer).toBeHidden({ timeout: 60_000 });
  }

  await leaveSettings(page);
}

export async function chooseScripted(page: Page): Promise<void> {
  const picker = page.getByRole("form", { name: /^Message( composer)?$/u }).getByRole("button", {
    name: /Scripted|Choose a model|model/iu,
  });

  if ((await picker.first().textContent())?.includes("Scripted")) return;
  await picker.first().click();
  const scripted = page.getByRole("option", { name: /^Scripted/u });
  const submenu = page.getByRole("menuitem", { name: /^Model/u });

  await scripted.or(submenu).first().waitFor();

  if (!(await scripted.isVisible())) await submenu.hover();
  await scripted.click();
  await page.keyboard.press("Escape");
  await expect(picker.first()).toContainText("Scripted");
}

export async function closeWorkbenchTabs(page: Page): Promise<void> {
  const tabs = page.getByRole("tablist", { name: "Workbench tabs" });

  for (let left = await tabs.getByRole("tab").count(); left > 0; left--) {
    const tab = tabs.getByRole("tab").first();
    const label = await tab.getAttribute("aria-label");
    await tab.hover({ position: { x: 8, y: 8 } });
    await tabs.getByRole("button", { name: `Close ${label ?? ""} tab` }).click();
    const confirm = page.getByRole("alertdialog").getByRole("button", { name: /^Close/u });

    await confirm.click({ timeout: 2_000 }).catch(() => undefined);
  }

  await expect(tabs.getByRole("tab")).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Workbench navigation" })).toBeVisible();
}
