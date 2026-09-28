import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { mkdtemp, realpath, rm, symlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { launchDesktop } from "../../../desktop/benchmark/desktop.ts";
import { collectErrors } from "../utils/errors.ts";

const APP_ROOT = resolve(import.meta.dirname, "../..");
const CREATED = "Created in the browser";

test.beforeAll(() => {
  if (!existsSync(resolve(APP_ROOT, "../desktop/out/main/index.js"))) {
    throw new Error("Run pnpm --dir packages/desktop build first");
  }

  if (!existsSync(resolve(APP_ROOT, "dist/index.html"))) {
    throw new Error("Run pnpm --dir packages/app build first");
  }
});

async function openRemoteAccess(page: Page): Promise<void> {
  await page.getByRole("button", { name: "Environments", exact: true }).click();
  await page.getByRole("tab", { name: "Remote access" }).click();
  await expect(page.getByRole("heading", { name: "Serving this Mac" })).toBeVisible();
}

function sessionButton(page: Page, name: string) {
  return page
    .getByRole("navigation", { name: "Sessions and workspaces" })
    .getByRole("button", { name });
}

test("a browser paired through Remote access shares the desktop's chats until it stops", async ({
  browser,
}) => {
  await using cleanup = new AsyncDisposableStack();
  const parent = await realpath(await mkdtemp(join(tmpdir(), "nyte-e2e-desktop-")));
  cleanup.defer(() => rm(parent, { recursive: true, force: true }));
  // The unpackaged desktop serves `<app path>/../app/dist`; the fixture's app
  // path is a directory under `parent`, so `parent/app` points at this package.
  await symlink(APP_ROOT, join(parent, "app"), "junction");
  const desktop = await launchDesktop({
    parentDirectory: parent,
    sessionCount: 2,
    turnsPerSession: 1,
  });
  cleanup.defer(() => desktop.close());
  const context = await browser.newContext();
  cleanup.defer(() => context.close());

  const { page } = desktop;
  const seeded = desktop.fixture.sessions.map((session) => session.name);
  await openRemoteAccess(page);

  const thisMacOnly = page
    .locator("div")
    .filter({ hasText: /^This Mac only/u, hasNotText: "Over Tailscale" });
  await thisMacOnly.getByRole("button", { name: "Start", exact: true }).click();
  await expect(page.getByRole("button", { name: "Stop", exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Address and token" }).click();
  await page.getByRole("button", { name: "Reveal token" }).click();
  const link = page.getByLabel("Pairing link");
  await expect(link).toHaveText(/^http:\/\/127\.0\.0\.1:\d+\/pair\?host=.+&token=[\w-]+$/u);
  const pairingUrl = await link.innerText();
  const token = new URL(pairingUrl).searchParams.get("token");

  const remote = await context.newPage();
  const remoteErrors = collectErrors(remote);
  await remote.goto(pairingUrl);
  await expect(remote.getByRole("form", { name: "Message composer" })).toBeVisible();

  for (const name of seeded) await expect(sessionButton(remote, name)).toBeVisible();

  // A chat is created by its first message, and this project sends none, so
  // the browser creates it over the same API with the paired token.
  const status = await remote.evaluate(
    async (input) => {
      const response = await fetch("/v1/call/sessions.create", {
        method: "POST",
        headers: {
          authorization: `Bearer ${input.token}`,
          "content-type": "application/json",
        },
        body: JSON.stringify({ input: { name: input.name } }),
      });

      return response.status;
    },
    { token, name: CREATED },
  );
  expect(status).toBe(200);

  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(sessionButton(page, CREATED)).toBeVisible();

  await openRemoteAccess(page);
  await page.getByRole("button", { name: "Stop", exact: true }).click();
  await expect(thisMacOnly.getByRole("button", { name: "Start", exact: true })).toBeEnabled();

  const [first] = seeded;

  if (first === undefined) throw new Error("The fixture seeded no sessions");
  await sessionButton(remote, first).click();
  await expect(
    remote.getByRole("alert").filter({ hasText: "Couldn’t load this chat." }),
  ).toBeVisible();
  await expect(remote.reload()).rejects.toThrow("net::ERR_CONNECTION_REFUSED");

  expect(remoteErrors.pageErrors).toEqual([]);
  expect(desktop.pageErrors).toEqual([]);
});
