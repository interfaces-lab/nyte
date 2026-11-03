import { expect, test } from "@playwright/test";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { collectErrors } from "@nyte-ai/app/e2e/errors";
import { startE2eHost } from "./host.ts";
import type { E2eHost } from "./host.ts";
import { launchDesktop } from "./launch.ts";
import { chatPane, chatRow, messages, openNewChat, send } from "./ui.ts";

const HOST_GONE =
  /^Failed to load resource: net::ERR_(?:INCOMPLETE_CHUNKED_ENCODING|CONNECTION_REFUSED|CONNECTION_RESET|EMPTY_RESPONSE)$/u;

async function nextHost(host: E2eHost, previous: number): Promise<number> {
  await expect
    .poll(async () => (await host.pid()) ?? previous, { timeout: 30_000 })
    .not.toBe(previous);
  const pid = await host.pid();

  if (pid === null) throw new Error("The Nyte host stopped again.");

  return pid;
}

async function emptyHome(cleanup: AsyncDisposableStack, name: string) {
  const parent = await realpath(await mkdtemp(join(tmpdir(), `nyte-e2e-${name}-`)));
  cleanup.defer(() => rm(parent, { recursive: true, force: true }));
  const home = join(parent, "home");
  await mkdir(home, { mode: 0o700 });

  return { parent, home };
}

test("a killed host comes back under launchd, and a message sent during the outage lands once", async () => {
  await using cleanup = new AsyncDisposableStack();
  const { parent, home } = await emptyHome(cleanup, "host-restart");
  const desktop = await launchDesktop({ home, parentDirectory: parent });
  cleanup.defer(() => desktop.close());
  const { page, host } = desktop;
  const errors = collectErrors(page);

  await openNewChat(page);
  await send(page, "Before the crash");
  await expect(messages(page).getByRole("paragraph")).toHaveText([
    "Before the crash",
    "Echo: Before the crash",
  ]);
  await expect(
    page.getByRole("tab", { selected: true }).getByRole("img", { name: "Working" }),
  ).toBeHidden();

  const killed = await host.pid();

  if (killed === null) throw new Error("The Nyte host isn't running.");
  process.kill(killed, "SIGKILL");
  await send(page, "During the outage");
  await nextHost(host, killed);

  await expect(messages(page).getByRole("paragraph")).toHaveText(
    ["Before the crash", "Echo: Before the crash", "During the outage", "Echo: During the outage"],
    { timeout: 30_000 },
  );
  await expect(chatPane(page).getByText("Reconnecting to the host…")).toBeHidden();
  await expect(chatPane(page).getByText(/Couldn't send/u)).toBeHidden();

  await send(page, "After the restart");
  await expect(messages(page).getByRole("paragraph")).toHaveText([
    "Before the crash",
    "Echo: Before the crash",
    "During the outage",
    "Echo: During the outage",
    "After the restart",
    "Echo: After the restart",
  ]);

  expect(errors.pageErrors).toEqual([]);
  expect(
    errors.consoleErrors.filter((text) => !text.startsWith("DEV:") && !HOST_GONE.test(text)),
  ).toEqual([]);
});

test("quitting the app leaves its host running, and a relaunch reconnects to the same process", async () => {
  test.setTimeout(180_000);
  await using cleanup = new AsyncDisposableStack();
  const { parent, home } = await emptyHome(cleanup, "host-quit");
  const host = await startE2eHost({ home, parentDirectory: parent, output: [] });
  cleanup.defer(() => host.close());
  const appData = join(parent, "app-data");
  const before = await host.pid();

  const first = await launchDesktop({ home, parentDirectory: parent, appData, host });

  try {
    await openNewChat(first.page);
    await send(first.page, "Before the quit");
    await expect(messages(first.page).getByRole("paragraph")).toHaveText([
      "Before the quit",
      "Echo: Before the quit",
    ]);
  } finally {
    await first.close();
  }

  expect(await host.pid()).toBe(before);

  const second = await launchDesktop({ home, parentDirectory: parent, appData, host });
  cleanup.defer(() => second.close());
  const errors = collectErrors(second.page);
  await expect(chatRow(second.page, "Before the quit")).toBeVisible();
  await openNewChat(second.page);
  await send(second.page, "After the relaunch");
  await expect(messages(second.page).getByRole("paragraph")).toHaveText([
    "After the relaunch",
    "Echo: After the relaunch",
  ]);
  expect(await host.pid()).toBe(before);

  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors.filter((text) => !text.startsWith("DEV:"))).toEqual([]);
});
