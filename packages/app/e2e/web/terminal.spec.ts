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
  });

  expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });
});
