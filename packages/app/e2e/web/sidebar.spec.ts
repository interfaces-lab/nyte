import { expect, test } from "@playwright/test";
import { ARCHIVED_SESSION_COUNT } from "../server/address.ts";
import { collectErrors } from "../utils/errors.ts";
import { pair } from "../utils/pairing.ts";

test("the Inbox's Archived shelf reveals 8 more chats per click", async ({ page }) => {
  const errors = collectErrors(page);
  await pair(page);

  await page.getByRole("button", { name: "Customize sidebar" }).click();
  await page.getByRole("menuitem", { name: "Grouping" }).click();
  await page.getByRole("menuitemradio", { name: "Inbox" }).click();
  await page.keyboard.press("Escape");
  await page.getByRole("menuitemcheckbox", { name: "Archived" }).click();
  await page.keyboard.press("Escape");

  const sidebar = page.getByRole("navigation", { name: "Sessions and workspaces" });
  await sidebar.getByRole("button", { name: `Archived ${String(ARCHIVED_SESSION_COUNT)}` }).click();

  const rows = sidebar.getByRole("button", { name: /^(Unread )?Archived chat \d+ /u });
  await expect(rows).toHaveCount(5);

  await sidebar.getByRole("button", { name: "Show 8 More", exact: true }).click();
  await expect(rows).toHaveCount(13);

  await sidebar.getByRole("button", { name: "Show 9 More", exact: true }).click();
  await expect(rows).toHaveCount(ARCHIVED_SESSION_COUNT);
  await expect(sidebar.getByRole("button", { name: /^Show \d+ More$/u })).toHaveCount(0);

  expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });
});
