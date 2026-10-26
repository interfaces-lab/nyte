import { expect, test } from "@playwright/test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectErrors } from "@nyte-ai/app/e2e/errors";
import { launchDesktop } from "./launch.ts";
import { chatPane, composer, openSettings, sidebar } from "./ui.ts";

test("an empty home opens on a new chat with nothing listed", async () => {
  await using cleanup = new AsyncDisposableStack();
  const parent = await realpath(await mkdtemp(join(tmpdir(), "nyte-e2e-first-run-")));
  cleanup.defer(() => rm(parent, { recursive: true, force: true }));
  const home = join(parent, "home");
  await mkdir(home, { mode: 0o700 });
  const desktop = await launchDesktop({ home, parentDirectory: parent });
  cleanup.defer(() => desktop.close());
  const { page } = desktop;
  const errors = collectErrors(page);

  await expect(page.getByRole("tab", { name: "New chat" })).toHaveAttribute(
    "aria-selected",
    "true",
  );
  await expect(chatPane(page).getByRole("button", { name: "Home", exact: true })).toBeVisible();
  await expect(chatPane(page).getByRole("button", { name: "This Mac" })).toBeVisible();
  await expect(composer(page)).toHaveAttribute("data-placeholder", /^Ask Nyte/u);
  await expect(page.getByRole("button", { name: "Send message" })).toBeDisabled();

  const chats = sidebar(page).getByRole("region", { name: "Chats" });
  await expect(chats.getByRole("button", { name: /^(Unread )?.* now$/u })).toHaveCount(0);

  await openSettings(page, "Providers");
  await expect(page.getByRole("button", { name: "E2E: Connected" })).toBeVisible();

  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors.filter((text) => !text.startsWith("DEV:"))).toEqual([]);
});
