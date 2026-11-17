import { expect, test } from "@playwright/test";
import type { Page } from "@playwright/test";
import { mkdir, mkdtemp, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { collectErrors } from "@nyte-ai/app/e2e/errors";
import { FIXTURES, LONG_TURNS, prepareHome } from "./baseline.ts";
import { startE2eHost } from "./host.ts";
import { launchDesktop } from "./launch.ts";
import { readTraceFile, splitMainThread, findThread, TRACE_CATEGORIES } from "./main-thread.ts";
import {
  chatPane,
  chatRow,
  chatTab,
  composer,
  messages,
  openChat,
  openNewChat,
  sidebar,
} from "./ui.ts";

const output = process.env.NYTE_PERF_DIR;

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

declare global {
  var nyteStopTrace: (() => Promise<void>) | undefined;
}

interface PageMark {
  readonly name: string;
  readonly at: number;
  readonly session: string | undefined;
}

test("measures a relaunch into a long chat while the host keeps running", async () => {
  test.skip(output === undefined, "Set NYTE_PERF_DIR to record the relaunch.");

  if (output === undefined) return;
  test.setTimeout(180_000);
  await mkdir(output, { recursive: true });
  await using cleanup = new AsyncDisposableStack();
  const parent = await realpath(await mkdtemp(join(tmpdir(), "nyte-e2e-relaunch-")));
  cleanup.defer(() => rm(parent, { recursive: true, force: true }));
  const prepared = await prepareHome(parent);
  const appData = join(parent, "app-data");
  const host = await startE2eHost({ home: prepared.home, parentDirectory: parent, output: [] });
  cleanup.defer(() => host.close());
  const lastPrompt = `/long 3 turn ${String(LONG_TURNS)}`;

  await test.step("the first run quits on the long chat", async () => {
    const first = await launchDesktop({
      home: prepared.home,
      parentDirectory: parent,
      appData,
      host,
    });

    try {
      await openChat(first.page, FIXTURES.long);
      await chatTab(first.page, FIXTURES.long).dblclick();
      await expect(chatTab(first.page, FIXTURES.long)).toHaveAccessibleName(FIXTURES.long);
      await expect(messages(first.page).getByText(lastPrompt, { exact: true })).toBeVisible();
    } finally {
      await first.close();
    }
  });

  const traceFile = join(output, "startup-trace.json");
  await rm(traceFile, { force: true });

  const second = await launchDesktop({
    home: prepared.home,
    parentDirectory: parent,
    appData,
    host,
    trace: { categories: TRACE_CATEGORIES, file: traceFile },
  });

  cleanup.defer(() => second.close());
  const { application, page } = second;
  const errors = collectErrors(page);

  await expect(chatTab(page, FIXTURES.long)).toHaveAttribute("aria-selected", "true");
  await expect(messages(page).getByText(lastPrompt, { exact: true })).toBeVisible();
  await expect
    .poll(() =>
      page.evaluate(() => performance.getEntriesByName("nyte:last-message-painted").length),
    )
    .toBeGreaterThan(0);

  const renderer = await page.evaluate(() => ({
    timeOrigin: performance.timeOrigin,
    marks: performance
      .getEntriesByType("mark")
      .filter((entry) => entry.name.startsWith("nyte:"))
      .map((entry) => ({
        name: entry.name,
        at: entry.startTime,
        session:
          entry instanceof PerformanceMark && typeof entry.detail === "string"
            ? entry.detail
            : undefined,
      })),
  }));

  const main = await application.evaluate(() => {
    const at = (name: string) => performance.getEntriesByName(name)[0]?.startTime;

    return {
      timeOrigin: performance.timeOrigin,
      entry: at("nyte:main-entry"),
      shown: at("nyte:window-shown"),
    };
  });

  await application.evaluate(() => globalThis.nyteStopTrace?.());
  const events = await readTraceFile(traceFile);

  if (main.entry === undefined || main.shown === undefined)
    throw new Error(`Missing a relaunch mark: ${JSON.stringify(main)}`);

  const painted = renderer.marks.find((mark) => mark.name === "nyte:last-message-painted");
  const session = painted?.session;

  const find = (name: string): PageMark | undefined =>
    renderer.marks.find(
      (mark) => mark.name === name && (mark.session === undefined || mark.session === session),
    );

  const startup = find("nyte:startup");

  if (painted === undefined || startup === undefined)
    throw new Error(`Missing a renderer mark: ${JSON.stringify(renderer.marks)}`);

  const launched = main.timeOrigin + main.entry;

  const sinceLaunch = (mark: PageMark | undefined) =>
    mark === undefined ? undefined : round(renderer.timeOrigin + mark.at - launched);

  const shown = main.timeOrigin + main.shown - renderer.timeOrigin;
  const thread = findThread(events, "nyte:startup");
  const startupTs = thread.find((event) => event.name === "nyte:startup")?.ts ?? 0;

  const trace = (mark: PageMark | undefined) =>
    mark === undefined ? undefined : startupTs + (mark.at - startup.at) * 1_000;

  const skeletonShown = find("nyte:skeleton-shown");
  const skeletonRemoved = find("nyte:skeleton-removed");
  const waited = skeletonShown !== undefined;

  const report = {
    timeToContentMs: sinceLaunch(painted),
    windowShownMs: round(shown + renderer.timeOrigin - launched),
    skeletonMountedMs:
      skeletonShown === undefined || skeletonRemoved === undefined
        ? 0
        : round(skeletonRemoved.at - skeletonShown.at),
    skeletonVisibleMs:
      skeletonShown === undefined || skeletonRemoved === undefined
        ? 0
        : round(Math.max(0, skeletonRemoved.at - Math.max(shown, skeletonShown.at))),
    sinceLaunchMs: {
      rendererStartup: sinceLaunch(startup),
      shellReady: sinceLaunch(find("nyte:shell-ready")),
      sdkConnected: sinceLaunch(find("nyte:sdk-connected")),
      socketConnected: sinceLaunch(find("nyte:socket-connected")),
      sessionRequested: sinceLaunch(find("nyte:session-requested")),
      sessionView: sinceLaunch(find("nyte:session-view")),
      skeletonShown: sinceLaunch(skeletonShown),
      skeletonRemoved: sinceLaunch(skeletonRemoved),
      lastMessagePainted: sinceLaunch(painted),
    },
    split: splitMainThread(thread, {
      from: startupTs,
      to: trace(painted) ?? startupTs,
      waitFrom: startupTs,
      requested: waited ? trace(find("nyte:session-requested")) : undefined,
      arrived: waited ? trace(find("nyte:session-view")) : undefined,
    }),
  };

  await writeFile(join(output, "startup.json"), JSON.stringify(report, null, 2));
  process.stdout.write(`relaunch ${JSON.stringify(report)}\n`);
  expect(errors.pageErrors).toEqual([]);
  expect(errors.consoleErrors.filter((text) => !text.startsWith("DEV:"))).toEqual([]);
});

function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}
