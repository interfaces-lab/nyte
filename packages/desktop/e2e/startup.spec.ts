import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mkdtemp, realpath, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { collectErrors } from "@nyte-ai/app/e2e/errors";
import { FIXTURES, prepareHome } from "./baseline.ts";
import { launchDesktop } from "./launch.ts";
import { chatPane, chatRow, chatTab, composer, messages, openNewChat, sidebar } from "./ui.ts";

const HOST_DELAY_MS = 6_000;

const DRAFT = "Typed before the host opened";

const FRAME_MS = 1_000 / 60;

const SHOW_TO_PAINT_FRAMES = 3;

interface RendererMarks {
  readonly timeOrigin: number;
  readonly startup: number | undefined;
  readonly shellReady: number | undefined;
  readonly firstContentfulPaint: number | undefined;
  readonly firstInputHandled: number | undefined;
  readonly sdkConnected: number | undefined;
}

function readMarks(page: Page): Promise<RendererMarks> {
  return page.evaluate(() => {
    const at = (name: string) => performance.getEntriesByName(name)[0]?.startTime;

    return {
      timeOrigin: performance.timeOrigin,
      startup: at("nyte:startup"),
      shellReady: at("nyte:shell-ready"),
      firstContentfulPaint: at("first-contentful-paint"),
      firstInputHandled: performance
        .getEntriesByType("first-input")
        .find((entry) => entry instanceof PerformanceEventTiming)?.processingEnd,
      sdkConnected: at("nyte:sdk-connected"),
    };
  });
}

test("a relaunch draws the last run's chats and model while the host is held, and its first send starts one chat", async () => {
  test.setTimeout(180_000);
  const testInfo = test.info();
  await using cleanup = new AsyncDisposableStack();
  const parent = await realpath(await mkdtemp(join(tmpdir(), "nyte-e2e-startup-")));
  cleanup.defer(() => rm(parent, { recursive: true, force: true }));
  const prepared = await prepareHome(parent);
  const appData = join(parent, "app-data");

  await test.step("the first run records what it saw as it quits", async () => {
    const first = await launchDesktop({ home: prepared.home, parentDirectory: parent, appData });

    try {
      await expect(chatRow(first.page, FIXTURES.long)).toBeVisible();
      await openNewChat(first.page);
      await expect(chatPane(first.page).getByRole("button", { name: "Scripted" })).toBeVisible();
    } finally {
      await first.close();
    }
  });

  const second = await launchDesktop({
    home: prepared.home,
    parentDirectory: parent,
    appData,
    hostDelayMs: HOST_DELAY_MS,
    typeAtFirstFrame: DRAFT,
  });

  cleanup.defer(() => second.close());
  const { application, page } = second;
  const errors = collectErrors(page);
  const field = composer(page);
  const sendButton = page.getByRole("button", { name: "Send message" });

  await test.step("the first frame is the new chat, drawn from the snapshot", async () => {
    await expect(chatTab(page, "New chat")).toHaveAttribute("aria-selected", "true");
    await expect(field).toHaveAttribute("contenteditable", "true");
    await expect(chatPane(page).getByRole("button", { name: "Scripted" })).toBeVisible();
    await expect(chatRow(page, FIXTURES.long)).toBeVisible();
    expect((await readMarks(page)).sdkConnected).toBeUndefined();
  });

  await test.step("the window shows at the interface's first frame", async () => {
    await expect
      .poll(() =>
        application.evaluate(({ BrowserWindow }) =>
          BrowserWindow.getAllWindows().every((window) => window.isVisible()),
        ),
      )
      .toBe(true);
  });

  await test.step("keys typed at the first frame land, and Enter holds the draft until the host opens", async () => {
    await expect(field).toHaveText(DRAFT);
    await field.press("Enter");
    await expect(chatPane(page).getByRole("status")).toContainText("Sends when Nyte connects");
    await expect(field).toHaveText(DRAFT);
    await expect(sendButton).toBeDisabled();
    expect((await readMarks(page)).sdkConnected).toBeUndefined();
  });

  const held = await readMarks(page);

  const windowShown = await application.evaluate(() => {
    const shown = performance.getEntriesByName("nyte:window-shown")[0];

    return shown === undefined ? undefined : performance.timeOrigin + shown.startTime;
  });

  await test.step("once the host opens, the held draft starts exactly one chat", async () => {
    await expect
      .poll(async () => (await readMarks(page)).sdkConnected, { timeout: HOST_DELAY_MS * 3 })
      .toBeDefined();
    await expect(chatTab(page, DRAFT)).toHaveAttribute("aria-selected", "true");
    await expect(messages(page).getByRole("paragraph")).toHaveText([DRAFT, `Echo: ${DRAFT}`]);
    await expect(chatRow(page, DRAFT)).toHaveCount(1);
    await expect(sidebar(page).getByRole("button", { name: /^Draft /u })).toHaveCount(0);
  });

  const { shellReady, firstContentfulPaint, firstInputHandled, startup, timeOrigin } = held;

  if (
    shellReady === undefined ||
    firstContentfulPaint === undefined ||
    firstInputHandled === undefined ||
    windowShown === undefined
  )
    throw new Error(`Missing a first-frame mark: ${JSON.stringify({ ...held, windowShown })}`);

  const shown = windowShown - timeOrigin;

  const connected = (await readMarks(page)).sdkConnected;

  const report = {
    hostDelayMs: HOST_DELAY_MS,
    startupMs: startup,
    shellReadyMs: shellReady,
    firstContentfulPaintMs: firstContentfulPaint,
    firstContentfulPaintAfterShellMs: firstContentfulPaint - shellReady,
    windowShownAfterShellMs: shown - shellReady,
    firstContentfulPaintAfterWindowShownMs: firstContentfulPaint - shown,
    firstInputHandledMs: firstInputHandled,
    firstInputHandledAfterFirstContentfulPaintMs: firstInputHandled - firstContentfulPaint,
    sdkConnectedMs: connected,
  };

  await testInfo.attach("first-frame-marks", {
    body: JSON.stringify(report, null, 2),
    contentType: "application/json",
  });
  process.stdout.write(`first-frame marks ${JSON.stringify(report)}\n`);

  expect(shown).toBeGreaterThanOrEqual(shellReady);
  expect(firstContentfulPaint - shown).toBeLessThanOrEqual(SHOW_TO_PAINT_FRAMES * FRAME_MS);
  expect(firstInputHandled).toBeLessThanOrEqual(firstContentfulPaint + FRAME_MS);
  expect(firstInputHandled).toBeLessThan(connected ?? Number.POSITIVE_INFINITY);
  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors.filter((text) => !text.startsWith("DEV:"))).toEqual([]);
});
