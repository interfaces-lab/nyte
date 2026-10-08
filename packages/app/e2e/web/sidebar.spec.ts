import { expect, test } from "@playwright/test";
import { ARCHIVED_SESSION_COUNT } from "../server/address.ts";
import { collectErrors } from "../utils/errors.ts";
import { pair } from "../utils/pairing.ts";

test("a folded sidebar list reveals 8 more chats per click", async ({ page }) => {
  const errors = collectErrors(page);
  await pair(page);

  await page.getByRole("button", { name: "Customize sidebar" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Archived" }).click();
  await page.keyboard.press("Escape");

  const sidebar = page.getByRole("navigation", { name: "Sessions and workspaces" });
  await sidebar.getByRole("button", { name: `Archived ${String(ARCHIVED_SESSION_COUNT)}` }).click();

  // Anchored: a hovered or focused row adds "Pin …" and "Restore …" buttons with the same title.
  const rows = sidebar.getByRole("button", { name: /^Archived chat \d+ /u });
  await expect(rows).toHaveCount(5);

  await sidebar.getByRole("button", { name: "Show 8 More", exact: true }).click();
  await expect(rows).toHaveCount(13);

  // Nine remain: the last page takes the lone leftover row instead of offering "Show 1 More".
  await sidebar.getByRole("button", { name: "Show 9 More", exact: true }).click();
  await expect(rows).toHaveCount(ARCHIVED_SESSION_COUNT);
  await expect(sidebar.getByRole("button", { name: /^Show \d+ More$/u })).toHaveCount(0);

  expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });
});
