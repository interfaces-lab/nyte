import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import type { Page } from "@playwright/test";
import { collectErrors } from "@nyte-ai/app/e2e/errors";
import { APP_ORIGINS } from "@nyte-ai/app/web/origins.ts";
import { FIXTURES } from "./baseline.ts";
import { expect, test } from "./fixtures.ts";
import { chatRow, sidebar } from "./ui.ts";

test.use({ chapter: "remote-access" });

const CREATED = "Created in the browser";

const WEB_ORIGIN = APP_ORIGINS[2];

const DIST = join(import.meta.dirname, "../../app/dist");

const TYPES = new Map([
  [".html", "text/html; charset=utf-8"],
  [".js", "text/javascript"],
  [".css", "text/css"],
  [".svg", "image/svg+xml"],
  [".png", "image/png"],
  [".woff2", "font/woff2"],
  [".json", "application/json"],
]);

async function serveShell(page: Page): Promise<void> {
  await page.route(`${WEB_ORIGIN}/**`, async (route) => {
    const path = normalize(join(DIST, new URL(route.request().url()).pathname));
    const file = path.startsWith(DIST) && extname(path) !== "" ? path : join(DIST, "index.html");

    try {
      await route.fulfill({
        body: await readFile(file),
        contentType: TYPES.get(extname(file)) ?? "application/octet-stream",
      });
    } catch {
      await route.fulfill({ status: 404, body: "Not found" });
    }
  });
}

async function openRemoteAccess(page: Page): Promise<void> {
  await sidebar(page).getByRole("button", { name: "Environments", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Remote access" })).toBeVisible();
}

test("a browser paired through Remote access shares the desktop's chats until it stops", async ({
  browser,
  desktop,
}) => {
  const context = await browser.newContext({ permissions: ["local-network-access"] });
  await using cleanup = new AsyncDisposableStack();
  cleanup.defer(() => context.close());
  const { page } = desktop;
  await openRemoteAccess(page);

  const thisMacOnly = page
    .locator("div")
    .filter({ hasText: /^This Mac only/u, hasNotText: "Over Tailscale" });

  await thisMacOnly.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByRole("button", { name: "Remote access: This Mac only" })).toBeVisible();

  await page.getByRole("tab", { name: "Address and Token" }).click();
  await page.getByRole("button", { name: "Reveal token" }).click();
  const link = page.locator('code[aria-label="Pairing link"]');
  await expect(link).toHaveText(/^https:\/\/app\.nyte\.sh\/pair#host=.+&token=[\w-]+$/u);
  const pairingUrl = new URL(await link.innerText());
  const fragment = new URLSearchParams(pairingUrl.hash.slice(1));
  const host = fragment.get("host");
  const token = fragment.get("token");
  expect(host).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/u);

  const remote = await context.newPage();
  const remoteErrors = collectErrors(remote);
  await serveShell(remote);
  await remote.goto(`${WEB_ORIGIN}/pair${pairingUrl.hash}`);
  await expect(remote.getByRole("form", { name: "Message composer" })).toBeVisible();

  for (const name of Object.values(FIXTURES)) await expect(chatRow(remote, name)).toBeVisible();

  const status = await remote.evaluate(
    async (input) => {
      const response = await fetch(`${input.host}/sessions.start`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ name: input.name, content: "Hi from the phone" }),
      });

      return response.status;
    },
    { host, token, name: CREATED },
  );

  expect(status).toBe(200);
  await expect(chatRow(page, CREATED)).toBeVisible();

  await page.getByRole("button", { name: "Remote access: This Mac only" }).click();
  await page.getByRole("menuitem", { name: "Stop Remote Access" }).click();
  await expect(thisMacOnly.getByRole("button", { name: "Start", exact: true })).toBeEnabled();

  await chatRow(remote, FIXTURES.alpha).click();
  await expect(remote.getByRole("dialog", { name: "Couldn't open folder" })).toContainText(
    "Failed to fetch",
  );

  expect(remoteErrors.pageErrors).toEqual([]);
});
