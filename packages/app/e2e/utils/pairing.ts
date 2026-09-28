import { expect } from "@playwright/test";
import type { Page } from "@playwright/test";
import { E2E_TOKEN, pairingLink } from "../server/address.ts";

export async function pair(page: Page): Promise<void> {
  await page.goto(pairingLink(E2E_TOKEN));
  await expect(page.getByRole("form", { name: "Message composer" })).toBeVisible();
}
