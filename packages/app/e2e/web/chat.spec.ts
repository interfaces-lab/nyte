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
  await expect(page).toHaveURL(/\/session\/[^/?#]+$/u);
  const sessionUrl = page.url();

  await page.reload();
  await expect(pane.getByText("Echo: hello", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(sessionUrl);

  await page.getByRole("link", { name: "Settings", exact: true }).click();
  await expect(page).toHaveURL(/\/settings\/general$/u);
  await page.goBack();
  await expect(page).toHaveURL(sessionUrl);
  await expect(pane.getByText("Echo: hello", { exact: true })).toBeVisible();
  await page.goForward();
  await expect(page).toHaveURL(/\/settings\/general$/u);
  await page.reload();
  await expect(page.getByRole("heading", { name: "General", exact: true })).toBeVisible();

  await page.evaluate(() => localStorage.setItem("nyte:startup-destination:v1", "last-session"));
  await page.goto(sessionUrl);
  await expect(pane.getByText("Echo: hello", { exact: true })).toBeVisible();
  await expect(page).toHaveURL(sessionUrl);
  await page.getByRole("button", { name: /New Chat/u }).click();
  await expect(page).toHaveURL(new URL("/", sessionUrl).href);
  await expect(composer).toHaveValue("");

  await page.reload();
  await expect(page).toHaveURL(/\/session\/[^/?#]+$/u);
  await expect(page.getByRole("form", { name: "Message composer" })).toBeVisible();
  expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });
});
