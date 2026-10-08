import { randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import { collectErrors } from "../utils/errors.ts";
import { pair } from "../utils/pairing.ts";

const README_LINE = "workspace.read reached the browser.";

test("a paired browser reads, edits, blames, searches, and mentions workspace files", async ({
  page,
}) => {
  const errors = collectErrors(page);
  const savedLine = `Saved through workspace.save ${randomUUID()}.`;
  const files = page.getByRole("region", { name: "Files" });
  const readme = files.getByRole("treeitem", { name: /README\.md/u });
  await pair(page);

  await test.step("the web workbench offers Files without native terminal or browser tabs", async () => {
    const workbench = page.getByRole("navigation", { name: "Workbench navigation" });
    const filesAction = workbench.getByRole("button", { name: "Files", exact: true });
    await expect(filesAction).toBeVisible();
    await expect(workbench.getByRole("button", { name: "Terminal", exact: true })).toHaveCount(0);
    await expect(workbench.getByRole("button", { name: "Browser", exact: true })).toHaveCount(0);
    await filesAction.click();
    await expect(page.getByRole("tab", { name: "Files", exact: true })).toBeVisible();
    await expect(files).toBeVisible();
  });

  await test.step("opening README.md from the explorer reads it from the workspace", async () => {
    await files.getByRole("button", { name: "Show Explorer", exact: true }).click();
    await readme.click();
    await expect(files.getByText(README_LINE, { exact: true })).toBeVisible();
  });

  await test.step("a saved edit is on disk after a reload", async () => {
    const editor = files.getByRole("textbox", { name: "README.md" });
    await editor.click();
    await page.keyboard.press("ControlOrMeta+End");
    await page.keyboard.press("Enter");
    await page.keyboard.type(savedLine);
    await expect(editor).toBeFocused();
    await expect(page.getByLabel("Message", { exact: true })).not.toContainText(savedLine);
    await page.keyboard.press("ControlOrMeta+s");
    await expect(files.getByText("Saved", { exact: true })).toBeVisible();

    await page.reload();
    await expect(files).toBeVisible();
    await files.getByRole("button", { name: "Files Sidebar", exact: true, pressed: false }).click();
    await readme.click();
    await expect(files.getByText(savedLine, { exact: true })).toBeVisible();
  });

  await test.step("Git blame names the seeded commit author", async () => {
    await files.getByText(README_LINE, { exact: true }).click();
    await files.getByRole("button", { name: "File options" }).click();
    await page.getByRole("menuitemcheckbox", { name: "Git Blame" }).click();
    await expect(files.getByText(/E2E Author/u)).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("menu")).toBeHidden();
  });

  await test.step("workspace search starts idle and finds the README line", async () => {
    await files.getByRole("button", { name: "Search Files" }).click();
    const search = files.getByRole("region", { name: "Workspace search" });
    const query = search.getByRole("textbox", { name: "Search workspace" });
    await expect(query).toBeVisible();

    for (const name of ["Match case", "Match whole word", "Use regular expression"]) {
      await expect(search.getByRole("button", { name, exact: true, pressed: false })).toBeVisible();
    }

    const filters = search.getByRole("button", { name: "Search filters", exact: true });
    const include = search.getByRole("textbox", { name: "Files to include" });
    const exclude = search.getByRole("textbox", { name: "Files to exclude" });
    await expect(filters).toHaveAttribute("aria-expanded", "false");
    await expect(include).toBeHidden();
    await expect(exclude).toBeHidden();
    await filters.click();
    await expect(filters).toHaveAttribute("aria-expanded", "true");
    await expect(include).toBeVisible();
    await expect(exclude).toBeVisible();
    await expect(search.getByRole("status")).toHaveCount(0);
    await expect(search.getByLabel(/replace|respect ignore files/iu)).toHaveCount(0);
    await expect(search).not.toContainText(/replace|respect ignore files/iu);

    await query.fill(README_LINE);
    await expect(search.getByRole("status")).toHaveText("1 match in 1 file.");
    await expect(search.getByRole("region", { name: "README.md" })).toContainText(README_LINE);
    await expect(
      search.getByRole("button", { name: /^README\.md, line 3, column 1: /u }),
    ).toBeVisible();
  });

  await test.step("an @ mention in a new chat offers the workspace file", async () => {
    await page.getByRole("button", { name: /New Chat/u }).click();
    await page.getByLabel("Message", { exact: true }).fill("@READ");
    await expect(page.getByRole("option", { name: /README\.md/u })).toBeVisible();
  });

  expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });
});
