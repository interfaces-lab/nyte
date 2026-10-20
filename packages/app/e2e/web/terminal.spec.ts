import { expect, test } from "@playwright/test";
import { collectErrors } from "../utils/errors.ts";
import { pair } from "../utils/pairing.ts";

test("a paired browser opens a terminal on the host's Home folder", async ({ page }) => {
  const errors = collectErrors(page);
  await pair(page);

  await test.step("the workbench offers a terminal on the web", async () => {
    await page
      .getByRole("navigation", { name: "Workbench navigation" })
      .getByRole("button", { name: "Terminal", exact: true })
      .click();
  });

  await test.step("the tab runs a shell: its input is ready and nothing failed", async () => {
    const terminal = page.getByRole("tabpanel").getByRole("region", { name: "Terminal" });
    await expect(terminal.getByRole("textbox", { name: "Terminal input" })).toBeVisible();
    await expect(terminal.getByRole("status")).toHaveCount(0);
    await expect(terminal.getByRole("alert")).toHaveCount(0);
    await terminal.getByRole("textbox", { name: "Terminal input" }).focus();
    await page.keyboard.type("exit\r");
    await expect(terminal.getByRole("status")).toHaveText(/Shell exited/u);
    await page.getByRole("button", { name: "Close Terminal tab", exact: true }).press("Enter");
    await expect(page.getByRole("tab", { name: "Terminal", exact: true })).toHaveCount(0);
  });

  await test.step("an idle shell closes without a dialog", async () => {
    await page
      .getByRole("navigation", { name: "Workbench navigation" })
      .getByRole("button", { name: "Terminal", exact: true })
      .click();
    const terminal = page.getByRole("tabpanel").getByRole("region", { name: "Terminal" });
    const input = terminal.getByRole("textbox", { name: "Terminal input" });
    await input.focus();
    await page.keyboard.type("printf '\\033]0;Idle shell\\007'\r");
    await expect(page.getByRole("tab", { name: "Idle shell", exact: true })).toBeVisible();
    await page.evaluate(() => {
      const observer = new MutationObserver(() => {
        if (document.querySelector('[role="alertdialog"]') !== null)
          document.body.dataset.terminalConfirmationShown = "true";
      });
      observer.observe(document.body, { childList: true, subtree: true });
    });
    await page.getByRole("button", { name: "Close Idle shell tab", exact: true }).press("Enter");
    await expect(page.getByRole("tab", { name: "Idle shell", exact: true })).toHaveCount(0);
    await expect(page.getByRole("alertdialog", { name: "Close Terminal" })).toHaveCount(0);
    await expect(page.locator("body")).not.toHaveAttribute("data-terminal-confirmation-shown");
  });

  await test.step("a shell with a running process asks before closing", async () => {
    await page
      .getByRole("navigation", { name: "Workbench navigation" })
      .getByRole("button", { name: "Terminal", exact: true })
      .click();
    const terminal = page.getByRole("tabpanel").getByRole("region", { name: "Terminal" });
    await terminal.getByRole("textbox", { name: "Terminal input" }).focus();
    await page.keyboard.type("sleep 30 & printf '\\033]0;Busy shell\\007'; wait\r");
    await expect(page.getByRole("tab", { name: "Busy shell", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Close Busy shell tab", exact: true }).press("Enter");
    const dialog = page.getByRole("alertdialog", { name: "Close Terminal" });
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Close Terminal", exact: true }).click();
    await expect(page.getByRole("tab", { name: "Busy shell", exact: true })).toHaveCount(0);
    await expect(dialog).toHaveCount(0);
  });

  expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });
});
