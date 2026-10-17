import { expect, test } from "@playwright/test";
import type { Page, Route } from "@playwright/test";
import { collectErrors } from "../utils/errors.ts";
import { pair } from "../utils/pairing.ts";

const SNAPSHOT_KEY = "nyte.first-frame.v1";

const DRAFT = "Typed before the host answered";

const hostRequests = (url: URL): boolean => url.pathname.startsWith("/.nyte");

function storedSnapshot(page: Page): Promise<string | null> {
  return page.evaluate((key) => localStorage.getItem(key), SNAPSHOT_KEY);
}

/** Pairs, then hides the page the way a closing tab does, so the next load has a snapshot. */
async function recordSnapshot(page: Page): Promise<void> {
  await pair(page);
  await expect
    .poll(async () => {
      await page.evaluate(() => window.dispatchEvent(new Event("pagehide")));

      return storedSnapshot(page);
    })
    .not.toBeNull();
}

type HostAnswer = "continue" | "refuse";

/**
 * Mounts from the snapshot while every host request waits, and types into the new chat. The
 * returned `release` lets the held requests, and every later one, through or refuses them.
 */
async function reloadHeld(page: Page): Promise<(answer: HostAnswer) => Promise<void>> {
  const held: Route[] = [];
  let answer: HostAnswer | undefined;

  const settle = (route: Route, next: HostAnswer): Promise<void> =>
    next === "continue" ? route.continue() : route.abort("connectionrefused");

  await page.route(hostRequests, (route) =>
    answer === undefined ? void held.push(route) : settle(route, answer),
  );
  await page.reload();

  const field = page.getByLabel("Message", { exact: true });
  await expect(field).toHaveAttribute("contenteditable", "true");
  await field.click();
  await page.keyboard.type(DRAFT);
  await expect(field).toHaveText(DRAFT);
  expect(held.length).toBeGreaterThan(0);

  return async (next) => {
    answer = next;
    await Promise.all(held.splice(0).map((route) => settle(route, next)));
  };
}

test("a saved connection mounts from its snapshot, and another host behind it leaves for the connect screen and forgets the snapshot", async ({
  page,
}) => {
  const errors = collectErrors(page);
  await recordSnapshot(page);
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("nyte:host-identity:"))
        localStorage.setItem(key, JSON.stringify("another-host"));
    }
  });

  const release = await reloadHeld(page);
  await release("continue");

  await expect(page.getByRole("heading", { name: "Connect to a Desktop" })).toBeVisible();
  expect(await storedSnapshot(page)).toBeNull();
  expect(errors).toEqual({ pageErrors: [], consoleErrors: [] });
});

test("a saved connection that cannot reach its host keeps the shell, its draft and a retry", async ({
  page,
}) => {
  await recordSnapshot(page);

  const release = await reloadHeld(page);
  await release("refuse");

  const failure = page.getByRole("alert").filter({ hasText: "Couldn’t open your workspace." });
  await expect(failure).toBeVisible();
  await expect(page.getByLabel("Message", { exact: true })).toHaveText(DRAFT);
  await expect(page.getByRole("heading", { name: "Connect to a Desktop" })).toHaveCount(0);
  expect(await storedSnapshot(page)).not.toBeNull();

  await release("continue");
  await failure.getByRole("button", { name: "Try Again" }).click();
  await expect(failure).toHaveCount(0);
  await expect(page.getByLabel("Message", { exact: true })).toHaveText(DRAFT);
});
