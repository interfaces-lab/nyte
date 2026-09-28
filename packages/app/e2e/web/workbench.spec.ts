import { expect, test } from "@playwright/test";
import { collectErrors } from "../utils/errors.ts";
import { pair } from "../utils/pairing.ts";

test("web workbench exposes files without native terminal or browser tabs", async ({ page }) => {
  const errors = collectErrors(page);
  await pair(page);

  const workbench = page.getByRole("navigation", { name: "Workbench navigation" });
  const filesAction = workbench.getByRole("button", { name: "Files", exact: true });
  await expect(filesAction).toBeVisible();
  await expect(workbench.getByRole("button", { name: "Terminal", exact: true })).toHaveCount(0);
  await expect(workbench.getByRole("button", { name: "Browser", exact: true })).toHaveCount(0);
  await filesAction.click();
  await expect(page.getByRole("tab", { name: "Files", exact: true })).toBeVisible();

  await page.getByRole("button", { name: /New Chat/u }).click();
  await page.getByLabel("Message", { exact: true }).fill("@READ");
  await expect(page.getByRole("option", { name: /README\.md/u })).toBeVisible();

  expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });
});
