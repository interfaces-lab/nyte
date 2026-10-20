import { expect, test } from "@playwright/test";
import type { ElectronApplication } from "@playwright/test";
import type { MessageBoxOptions } from "electron";
import { mkdir, mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { collectErrors } from "@nyte-ai/app/e2e/errors";
import { launchDesktop } from "./launch.ts";
import { chatPane, composer, messages, openNewChat, send } from "./ui.ts";

const HOST_GONE =
  /^Failed to load resource: net::ERR_(?:INCOMPLETE_CHUNKED_ENCODING|CONNECTION_REFUSED|CONNECTION_RESET|EMPTY_RESPONSE)$/u;

async function hostPid(application: ElectronApplication): Promise<number | undefined> {
  return application.evaluate(
    ({ app }) => app.getAppMetrics().find((metric) => metric.name === "Nyte Host")?.pid,
  );
}

async function nextHost(application: ElectronApplication, previous?: number): Promise<number> {
  await expect
    .poll(async () => {
      const pid = await hostPid(application);

      return pid !== undefined && pid !== previous;
    })
    .toBe(true);

  const pid = await hostPid(application);

  if (pid === undefined) throw new Error("The Nyte Host stopped again.");

  return pid;
}

async function launch(cleanup: AsyncDisposableStack, name: string) {
  const parent = await realpath(await mkdtemp(join(tmpdir(), `nyte-e2e-${name}-`)));
  cleanup.defer(() => rm(parent, { recursive: true, force: true }));
  const home = join(parent, "home");
  await mkdir(home, { mode: 0o700 });
  const desktop = await launchDesktop({ home, parentDirectory: parent });
  cleanup.defer(() => desktop.close());

  return { ...desktop, errors: collectErrors(desktop.page) };
}

test("a killed host restarts on the same endpoint, and a message sent during the outage lands once", async () => {
  await using cleanup = new AsyncDisposableStack();
  const { application, page, errors } = await launch(cleanup, "host-restart");

  await openNewChat(page);
  await send(page, "Before the crash");
  await expect(messages(page).getByRole("paragraph")).toHaveText([
    "Before the crash",
    "Echo: Before the crash",
  ]);
  await expect(
    page.getByRole("tab", { selected: true }).getByRole("img", { name: "Running" }),
  ).toBeHidden();

  const killed = await nextHost(application);
  process.kill(killed, "SIGKILL");
  await send(page, "During the outage");
  await nextHost(application, killed);

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

test("a host that crashes a fourth time running stops restarting, says so, and its Restart brings it back", async () => {
  test.setTimeout(180_000);
  await using cleanup = new AsyncDisposableStack();
  const { application, page, errors } = await launch(cleanup, "host-crash-loop");

  await page.waitForFunction(() => performance.getEntriesByName("nyte:sdk-connected").length > 0);

  const shown = await application.evaluateHandle(({ dialog }) => {
    const options: MessageBoxOptions[] = [];

    Object.assign(dialog, {
      showMessageBox: async (box: MessageBoxOptions) => {
        options.push(box);

        return { response: 0, checkboxChecked: false };
      },
    });

    return options;
  });

  let pid = await nextHost(application);

  for (const _restart of [1, 2, 3]) {
    process.kill(pid, "SIGKILL");
    pid = await nextHost(application, pid);
  }

  process.kill(pid, "SIGKILL");
  await expect.poll(() => shown.evaluate((options) => options.length)).toBe(1);
  expect(
    await shown.evaluate((options) =>
      options.map((box) => ({ message: box.message, buttons: box.buttons })),
    ),
  ).toEqual([{ message: "Nyte Host keeps stopping", buttons: ["Restart Host", "Quit Nyte"] }]);

  await nextHost(application, pid);
  await openNewChat(page);
  await composer(page).fill("After the restart");
  await composer(page).press("Enter");
  await expect(messages(page).getByRole("paragraph")).toHaveText(
    ["After the restart", "Echo: After the restart"],
    { timeout: 30_000 },
  );

  expect(errors.pageErrors).toEqual([]);
  expect(
    errors.consoleErrors.filter((text) => !text.startsWith("DEV:") && !HOST_GONE.test(text)),
  ).toEqual([]);
});
