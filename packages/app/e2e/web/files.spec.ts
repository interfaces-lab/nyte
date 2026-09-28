import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { E2E_TOKEN, pairingLink } from "../server/address.ts";
import { collectErrors } from "../utils/errors.ts";

const README_LINE = "workspace.read reached the browser.";
const SAVED_LINE = "Saved through workspace.save.";

async function openFiles(page: Page) {
  const files = page.getByRole("region", { name: "Files" });

  if (!(await files.isVisible())) {
    await page
      .getByRole("navigation", { name: "Workbench navigation" })
      .getByRole("button", { name: "Files" })
      .click();
  }

  await expect(files).toBeVisible();

  return files;
}

async function openReadme(page: Page) {
  const files = await openFiles(page);
  await files.getByRole("treeitem", { name: /README\.md/u }).click();
  await expect(files.getByText(README_LINE, { exact: true })).toBeVisible();

  return files;
}

test("opens a workspace file through the shared SDK operation", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(pairingLink(E2E_TOKEN));
  await expect(page.getByRole("form", { name: "Message composer" })).toBeVisible();
  await openReadme(page);
  expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });
});

test("saves an edited workspace file through the shared SDK operation", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(pairingLink(E2E_TOKEN));
  const files = await openReadme(page);
  const editor = files.getByRole("textbox");
  await editor.click();
  await page.keyboard.press("ControlOrMeta+End");
  await page.keyboard.type(SAVED_LINE);
  await page.keyboard.press("ControlOrMeta+s");
  await expect(files.getByText("Saved", { exact: true })).toBeVisible();

  await page.reload();
  const reopened = page.getByRole("region", { name: "Files" });
  await expect(reopened).toBeVisible();
  await reopened.getByRole("treeitem", { name: /README\.md/u }).click();
  await expect(reopened.getByText(SAVED_LINE, { exact: true })).toBeVisible();
  expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });
});

test("searches the workspace through the shared SDK operation", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(pairingLink(E2E_TOKEN));
  const files = await openFiles(page);
  await files.getByRole("button", { name: "Search Files" }).click();
  const search = files.getByRole("region", { name: "Workspace search" });
  await search.getByRole("textbox", { name: "Search workspace" }).fill(README_LINE);
  await expect(search.getByRole("region", { name: "README.md" })).toContainText(README_LINE);
  expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });
});

test("shows the seeded commit author in Git blame", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(pairingLink(E2E_TOKEN));
  const files = await openReadme(page);
  await files.getByText(README_LINE, { exact: true }).click();
  await files.getByRole("button", { name: "File options" }).click();
  await page.getByRole("menuitemcheckbox", { name: "Git Blame" }).click();
  await expect(files.getByText(/E2E Author/u)).toBeVisible();
  expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });
});
