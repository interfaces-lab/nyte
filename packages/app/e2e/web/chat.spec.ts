import { expect, test } from "@playwright/test";
import { E2E_TOKEN, pairingLink } from "../server/address.ts";
import { collectErrors } from "../utils/errors.ts";

test("a new chat shows the reply and takes its title from the provider", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto(pairingLink(E2E_TOKEN));
  await expect(page.getByRole("form", { name: "Message composer" })).toBeVisible();

  await page.getByRole("button", { name: /New Chat/u }).click();
  const composer = page.getByLabel("Message", { exact: true });
  await composer.fill("hello");
  await composer.press("Enter");

  const pane = page.getByRole("region", { name: "Active chat pane" });
  await expect(pane.getByText("Echo: hello", { exact: true })).toBeVisible();
  await expect(page.getByRole("banner").getByText("Echo: hello", { exact: true })).toBeVisible();
  // The server outlives a test, so earlier runs may have left chats with the same title.
  await expect(
    page
      .getByRole("navigation", { name: "Sessions and workspaces" })
      .getByRole("button", { name: "Echo: hello" })
      .and(page.locator("[aria-current=page]")),
  ).toBeVisible();
  expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });
});
