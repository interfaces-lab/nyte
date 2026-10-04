import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { E2E_ORIGIN, E2E_TOKEN, pairingLink } from "../server/address.ts";
import { pair } from "../utils/pairing.ts";
import { collectErrors } from "../utils/errors.ts";

const REJECTED = "The server rejected this token. Update the connection token.";

const WRONG_TOKEN = "not-the-e2e-token-0123456789abcdef";

/** Marks `<html>` once the connect form mounts, however briefly; runs before any page script. */
async function watchForConnectForm(page: Page): Promise<void> {
  await page.addInitScript(() => {
    new MutationObserver((records) => {
      const mounted = records.some((record) =>
        [...record.addedNodes].some((node) => node.textContent?.includes("Connect to a Desktop")),
      );

      if (mounted) document.documentElement.dataset.sawConnectForm = "true";
    }).observe(document, { childList: true, subtree: true });
  });
}

async function expectShellWithoutConnectForm(page: Page): Promise<void> {
  await expect(page.getByRole("form", { name: "Message composer" })).toBeVisible();
  await expect(page.getByRole("heading", { name: "Connect to a Desktop" })).toHaveCount(0);
  await expect(page.locator("html")).not.toHaveAttribute("data-saw-connect-form");
}

async function storedConnection(page: Page): Promise<string | null> {
  return page.evaluate(() => localStorage.getItem("nyte:connection"));
}

test("a pairing link opens the shell and leaves no token in the address bar", async ({ page }) => {
  const errors = collectErrors(page);
  await watchForConnectForm(page);
  await page.addInitScript(() => {
    sessionStorage.setItem("pairing-history-length", String(history.length));
  });

  await pair(page);

  await expectShellWithoutConnectForm(page);
  await expect(page).toHaveURL(`${E2E_ORIGIN}/`);
  expect(page.url()).not.toContain(E2E_TOKEN);
  expect(await page.evaluate(() => String(history.length))).toBe(
    await page.evaluate(() => sessionStorage.getItem("pairing-history-length")),
  );
  expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });
});

test("a reload keeps the paired connection", async ({ page }) => {
  const errors = collectErrors(page);
  await watchForConnectForm(page);
  await pair(page);

  await page.reload();

  await expectShellWithoutConnectForm(page);
  expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });
});

test("a wrong token in the form is rejected and nothing is stored", async ({ page }) => {
  const errors = collectErrors(page);
  await page.goto("/");
  await expect(page.getByRole("heading", { name: "Connect to a Desktop" })).toBeVisible();

  await page.getByLabel("Address").fill(E2E_ORIGIN);
  await page.getByLabel("Token").fill(WRONG_TOKEN);
  await page.getByRole("button", { name: "Connect" }).click();

  await expect(page.getByRole("alert")).toHaveText(REJECTED);
  await expect(page.getByRole("button", { name: "Connect" })).toBeEnabled();
  expect(await storedConnection(page)).toBeNull();
  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors).toEqual([expect.stringContaining("403")]);
});

test("a pairing link with a wrong token asks for a new token at the same address", async ({
  page,
}) => {
  const errors = collectErrors(page);

  await page.goto(pairingLink(WRONG_TOKEN));

  await expect(page.getByRole("alert")).toHaveText(REJECTED);
  await expect(page.getByLabel("Address")).toHaveValue(E2E_ORIGIN);
  await expect(page.getByLabel("Token")).toHaveValue("");
  await expect(page).toHaveURL(`${E2E_ORIGIN}/`);
  expect(await storedConnection(page)).toBeNull();
  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors).toEqual([expect.stringContaining("403")]);
});
