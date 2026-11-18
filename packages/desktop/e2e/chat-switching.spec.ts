import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import type { Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { markTimes, splitMainThread, startTrace, findThread } from "./main-thread.ts";
import { chatPane, chatTab, revealChat } from "./ui.ts";
import {
  acrossSessions,
  countWork,
  difference,
  overBudget,
  readCounts,
  settled,
  stopCountingWork,
  summarize,
} from "./work-counts.ts";
import type { Counts, WorkBudget } from "./work-counts.ts";

const output = process.env.NYTE_PERF_DIR;

const CHATS = [
  "Switching A",
  "Switching B",
  "Switching C",
  "Switching D",
  "Switching E",
  "Switching F",
];

const TURNS = 120;

const SWITCHES = 20;

const PROMPTS = ["/think", "/markdown", "/long 3", "A plain question"];

function lastWord(name: string): string {
  return `Last word in ${name}`;
}

function transcript(name: string): readonly string[] {
  return [
    ...Array.from(
      { length: TURNS },
      (_, index) => `${PROMPTS[index % PROMPTS.length] ?? ""} ${name} turn ${String(index + 1)}`,
    ),
    lastWord(name),
  ];
}

test.use({
  chapter: "chat-switching",
  extraChats: Object.fromEntries(CHATS.map((name) => [name, transcript(name)])),
});

const SWITCH_WORK_BUDGETS = {
  first: {
    "render:conversation": 5,
    "render:transcript-row": 21,
    "render:composer": 5,
    "render:agents-tray": 6,
    "render:window-tab": 2,
    "select:row": 34,
    "select:activity": 2,
    "publish:view": 3,
    notify: 6,
  },
  again: {
    "render:conversation": 3,
    "render:transcript-row": 21,
    "render:composer": 3,
    "render:agents-tray": 4,
    "render:window-tab": 2,
    "select:row": 21,
    "select:activity": 2,
    "publish:view": 1,
    notify: 2,
  },
} satisfies Record<string, WorkBudget>;

interface AppMarks {
  readonly requestedMs: number | undefined;
  readonly arrivedMs: number | undefined;
  readonly skeletonShownMs: number | undefined;
  readonly skeletonRemovedMs: number | undefined;
  readonly lastPaintedMs: number;
}

interface SwitchTiming {
  readonly chat: string;
  readonly clickMs: number;
  readonly paintedMs: number;
  readonly spanMs: number;
  readonly marks: AppMarks;
}

interface Profile {
  readonly nodes: readonly {
    readonly id: number;
    readonly callFrame: {
      readonly functionName: string;
      readonly url: string;
      readonly lineNumber: number;
    };
  }[];
  readonly startTime: number;
  readonly samples?: readonly number[];
  readonly timeDeltas?: readonly number[];
}

declare global {
  interface Window {
    nyteSwitch?: {
      clickMs: number;
      paintedMs: number;
      target: string;
      frame: number;
    };
  }
}

function round(ms: number): number {
  return Math.round(ms * 10) / 10;
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = values.toSorted((first, second) => first - second);

  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)] ?? 0;
}

async function armSwitch(page: Page, target: string): Promise<void> {
  await page.evaluate((text) => {
    const state = { clickMs: 0, paintedMs: 0, target: text, frame: 0 };
    window.nyteSwitch = state;

    const painted = (): boolean => {
      const pane = document.querySelector("[aria-label='Active chat pane']");

      const viewport = [
        ...(pane?.querySelectorAll<HTMLElement>("[role='region'][aria-label='Messages']") ?? []),
      ].find((element) => element.clientHeight > 0);

      if (viewport === undefined) return false;
      const box = viewport.getBoundingClientRect();
      const rows = [...viewport.querySelectorAll<HTMLElement>("[data-row-key]")].slice(-6);

      return rows.some((row) => {
        const bounds = row.getBoundingClientRect();

        return (
          bounds.height > 0 &&
          bounds.bottom > box.top &&
          bounds.top < box.bottom &&
          (row.textContent ?? "").includes(`Echo: ${text}`)
        );
      });
    };

    const check = (): void => {
      if (painted()) {
        const channel = new MessageChannel();
        channel.port1.onmessage = () => {
          state.paintedMs = performance.now();
          performance.mark("nyte:switch:painted");
        };
        channel.port2.postMessage(null);

        return;
      }

      state.frame = requestAnimationFrame(check);
    };

    document.addEventListener(
      "click",
      (event) => {
        state.clickMs = event.timeStamp;
        performance.mark("nyte:switch:click", { startTime: event.timeStamp });
        state.frame = requestAnimationFrame(check);
      },
      { capture: true, once: true },
    );
  }, target);
}

async function switchTo(page: Page, chat: string): Promise<SwitchTiming> {
  const row = await revealChat(page, chat);
  await armSwitch(page, lastWord(chat));
  await row.click();
  await expect(chatTab(page, chat)).toHaveAttribute("aria-selected", "true");
  await expect(
    chatPane(page)
      .getByText(`Echo: ${lastWord(chat)}`, { exact: true })
      .first(),
  ).toBeVisible();
  const state = await page
    .waitForFunction(() => {
      const current = window.nyteSwitch;

      return current !== undefined && current.paintedMs > 0 ? current : undefined;
    })
    .then((handle) => handle.jsonValue());

  if (state === undefined) throw new Error(`Switching to ${chat} never painted`);

  return {
    chat,
    clickMs: state.clickMs,
    paintedMs: state.paintedMs,
    spanMs: state.paintedMs - state.clickMs,
    marks: await readAppMarks(page, state.clickMs),
  };
}

async function readAppMarks(page: Page, since: number): Promise<AppMarks> {
  const handle = await page.waitForFunction((after) => {
    const marks = (name: string) =>
      performance
        .getEntriesByName(name)
        .filter((entry) => entry instanceof PerformanceMark && entry.startTime >= after)
        .map((entry) => ({
          at: entry.startTime,
          session: entry instanceof PerformanceMark ? String(entry.detail) : "",
        }));

    const painted = marks("nyte:last-message-painted")[0];

    if (painted === undefined) return undefined;

    const first = (name: string) =>
      marks(name).find((mark) => mark.session === painted.session && mark.at <= painted.at)?.at;

    return {
      requestedMs: first("nyte:session-requested"),
      arrivedMs: first("nyte:session-view"),
      skeletonShownMs: first("nyte:skeleton-shown"),
      skeletonRemovedMs: first("nyte:skeleton-removed"),
      lastPaintedMs: painted.at,
    };
  }, since);

  const marks = await handle.jsonValue();

  if (marks === undefined) throw new Error("The switch has no last-message-painted mark");

  return marks;
}

function hotFunctions(
  profile: Profile,
  windows: readonly { readonly from: number; readonly to: number }[],
): { readonly frame: string; readonly selfMs: number }[] {
  const frames = new Map(
    profile.nodes.map((node) => {
      const file = node.callFrame.url.split("/").at(-1) ?? "";
      const name = node.callFrame.functionName === "" ? "(anonymous)" : node.callFrame.functionName;

      return [node.id, `${name} ${file}:${String(node.callFrame.lineNumber + 1)}`] as const;
    }),
  );

  const self = new Map<string, number>();
  let time = profile.startTime;
  const samples = profile.samples ?? [];
  const deltas = profile.timeDeltas ?? [];

  for (const [index, sample] of samples.entries()) {
    const delta = deltas[index + 1] ?? 0;
    time += deltas[index] ?? 0;

    if (!windows.some((window) => time >= window.from && time <= window.to)) continue;
    const frame = frames.get(sample) ?? "?";

    if (frame.startsWith("(idle)") || frame.startsWith("(program)")) continue;
    self.set(frame, (self.get(frame) ?? 0) + delta / 1_000);
  }

  return [...self]
    .map(([frame, selfMs]) => ({ frame, selfMs: Math.round(selfMs * 10) / 10 }))
    .toSorted((first, second) => second.selfMs - first.selfMs)
    .slice(0, 12);
}

async function countedSwitch(page: Page, chat: string): Promise<Counts> {
  const row = await revealChat(page, chat);
  const before = await readCounts(page);
  await row.click();
  await expect(chatTab(page, chat)).toHaveAttribute("aria-selected", "true");
  await expect(
    chatPane(page)
      .getByText(`Echo: ${lastWord(chat)}`, { exact: true })
      .first(),
  ).toBeVisible();
  await settled(page);

  return acrossSessions(difference(before, await readCounts(page)));
}

test("each switch between long chats renders and publishes within its budget", async ({
  desktop,
}, testInfo) => {
  const { page } = desktop;
  await countWork(page);
  const first: Counts[] = [];
  const again: Counts[] = [];

  for (const chat of CHATS) first.push(await countedSwitch(page, chat));

  for (const chat of CHATS) again.push(await countedSwitch(page, chat));

  await stopCountingWork(page);

  for (const sample of [...first, ...again])
    expect(sample["render:conversation"], "the app counted no work").toBeGreaterThan(0);

  const summaries = { first: summarize(first), again: summarize(again) };
  const receipt = JSON.stringify(
    { startup: desktop.startup, budgets: SWITCH_WORK_BUDGETS, summaries, first, again },
    null,
    2,
  );
  await testInfo.attach("work-per-switch", { body: receipt, contentType: "application/json" });

  if (output !== undefined) {
    await mkdir(output, { recursive: true });
    await writeFile(join(output, "chat-switching-work.json"), receipt);
  }

  expect([
    ...overBudget("first visit, median", summaries.first.median, SWITCH_WORK_BUDGETS.first),
    ...overBudget("second visit, median", summaries.again.median, SWITCH_WORK_BUDGETS.again),
  ]).toEqual([]);
});

test("measures how long switching between long chats takes to paint the last message", async ({
  desktop,
}, testInfo) => {
  test.skip(output === undefined, "Set NYTE_PERF_DIR to record chat switching.");

  if (output === undefined) return;
  test.setTimeout(600_000);
  const { page } = desktop;
  await mkdir(output, { recursive: true });

  await expect(
    page.getByRole("navigation", { name: "Sessions and workspaces" }).first(),
  ).toBeVisible();

  const session = await page.context().newCDPSession(page);
  await session.send("Profiler.enable");
  await session.send("Profiler.setSamplingInterval", { interval: 200 });
  const stopTrace = await startTrace(session);
  await session.send("Profiler.start");
  const timings: SwitchTiming[] = [];

  for (let index = 0; index < SWITCHES; index += 1) {
    const chat = CHATS[index % CHATS.length] ?? "";
    timings.push(await switchTo(page, chat));
  }

  const profiled = await session.send("Profiler.stop");
  const events = await stopTrace();
  await session.detach();

  const spans = timings.map((timing) => timing.spanMs);
  const main = findThread(events, "nyte:switch:painted");
  const painted = markTimes(main, "nyte:switch:painted");

  if (painted.length !== SWITCHES)
    throw new Error(`The trace has ${String(painted.length)} painted marks`);

  const switches = timings.map((timing, index) => {
    const to = painted[index] ?? 0;
    const from = to - timing.spanMs * 1_000;

    const trace = (ms: number | undefined) =>
      ms === undefined ? undefined : to + (ms - timing.paintedMs) * 1_000;

    const marks = timing.marks;
    const waited = marks.skeletonShownMs !== undefined;

    return {
      index: index + 1,
      chat: timing.chat,
      spanMs: round(timing.spanMs),
      lastPaintedMs: round(marks.lastPaintedMs - timing.clickMs),
      skeletonMs:
        marks.skeletonShownMs === undefined || marks.skeletonRemovedMs === undefined
          ? 0
          : round(marks.skeletonRemovedMs - marks.skeletonShownMs),
      layouts: main.filter((event) => event.name === "Layout" && event.ts >= from && event.ts < to)
        .length,
      split: splitMainThread(main, {
        from,
        to,
        waitFrom: trace(marks.requestedMs) ?? from,
        requested: waited ? trace(marks.requestedMs) : undefined,
        arrived: waited ? trace(marks.arrivedMs) : undefined,
      }),
      window: { from, to },
    };
  });

  const slowest = switches
    .toSorted((first, second) => second.spanMs - first.spanMs)
    .slice(0, 3)
    .map((entry) => ({ ...entry, hot: hotFunctions(profiled.profile, [entry.window]) }));

  const splitAcrossSwitches = switches.reduce<Record<string, number>>((totals, entry) => {
    for (const [part, ms] of Object.entries(entry.split))
      totals[part] = round((totals[part] ?? 0) + ms);

    return totals;
  }, {});

  const summary = {
    switches: spans.length,
    medianMs: round(percentile(spans, 0.5)),
    p95Ms: round(percentile(spans, 0.95)),
    maxMs: round(Math.max(...spans)),
    skeletonShown: switches.filter((entry) => entry.skeletonMs > 0).length,
    splitAcrossSwitches,
    largestPart: Object.entries(splitAcrossSwitches)
      .filter(([part]) => part !== "otherMs")
      .toSorted((first, second) => second[1] - first[1])[0]?.[0],
    slowest,
    all: switches,
    hotAcrossSwitches: hotFunctions(
      profiled.profile,
      switches.map((entry) => entry.window),
    ),
  };

  await writeFile(join(output, "chat-switching.json"), JSON.stringify(summary, null, 2));
  await writeFile(join(output, "chat-switching.cpuprofile"), JSON.stringify(profiled.profile));
  await writeFile(join(output, "chat-switching-trace.json"), JSON.stringify(main));
  await testInfo.attach("summary", {
    body: JSON.stringify(summary, null, 2),
    contentType: "application/json",
  });
  expect(spans).toHaveLength(SWITCHES);
});
