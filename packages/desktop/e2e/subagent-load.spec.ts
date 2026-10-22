import { Buffer } from "node:buffer";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import type { Locator, Page } from "@playwright/test";
import { SWARM_AGENTS } from "../src/main/fixtures/e2e-models.ts";
import { expect, test } from "./fixtures.ts";
import { readInputTrace } from "./input-trace.ts";
import { chatPane, composer, messages, openNewChat, send } from "./ui.ts";

test.use({ chapter: "subagent-load" });

const output = process.env.NYTE_PERF_DIR;

test.skip(output === undefined, "Set NYTE_PERF_DIR to record the subagent load workload.");

const HISTORY = "/long 60";

const NOTES = ["First note", "Second note"];

const FOLLOWING_DRAFT = "Typing while five agents stream ";

const DETAIL_DRAFT = "with an agent chat open ";

const READING_DRAFT = "keeps every keystroke where it lands.";

const KEY_DELAY_MS = 35;

const KEY_P99_BUDGET_MS = 50;

const KEY_MAX_BUDGET_MS = 100;

const RENDER_P99_BUDGET_MS = 16.67;

const MIN_RENDER_SAMPLES = 100;

/** Each streaming agent's view publishes every delta (25 ms), so one typing phase sees far more than this per agent. */
const STREAMING_PUBLICATIONS = 10;

const MARKS = { start: "nyte:typing:start", end: "nyte:typing:end" } as const;

const RUNNING_OR_DONE = /Thinking|Writing a response|Reading|Planning next moves|Completed/u;

const TRACE_CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "blink.user_timing",
  "latencyInfo",
  "toplevel",
  "v8.execute",
  "disabled-by-default-v8.cpu_profiler",
].join(",");

interface Probe {
  readonly mounts: Record<string, number>;
  readonly frameIntervalsMs: number[];
  rowResizes: number;
  scrolls: number;
  detail?: {
    frames: number;
    textChanges: number;
    maxParentDrift: number;
    blankFrames: number;
    maxOverlap: number;
    running: boolean;
    frame: number;
    timer: number;
  };
}

declare global {
  interface Window {
    nyteProbe?: Probe;
    nyteWorkCounts?: Record<string, number>;
  }
}

type Counts = Readonly<Record<string, number>>;

function percentile(values: readonly number[], fraction: number): number {
  const sorted = values.toSorted((first, second) => first - second);

  return sorted[Math.max(0, Math.ceil(fraction * sorted.length) - 1)] ?? 0;
}

function difference(before: Counts, after: Counts): Counts {
  return Object.fromEntries(
    Object.entries(after).map(([name, count]) => [name, count - (before[name] ?? 0)]),
  );
}

function readCounts(page: Page): Promise<Counts> {
  return page.evaluate(() => ({ ...window.nyteWorkCounts }));
}

async function installProbe(log: Locator): Promise<void> {
  await log.evaluate((viewport) => {
    const probe: Probe = { mounts: {}, frameIntervalsMs: [], rowResizes: 0, scrolls: 0 };
    window.nyteProbe = probe;
    let previous: number | undefined;

    const frame = (time: number): void => {
      if (previous !== undefined) probe.frameIntervalsMs.push(time - previous);
      previous = time;
      requestAnimationFrame(frame);
    };

    requestAnimationFrame(frame);

    const scrolled = (): void => {
      probe.scrolls += 1;
    };

    viewport.addEventListener("scroll", scrolled, { passive: true });

    const seen = new WeakSet<Element>();

    const resized = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (seen.has(entry.target)) probe.rowResizes += 1;
        else seen.add(entry.target);
      }
    });

    const watch = (node: Node): void => {
      if (!(node instanceof Element)) return;

      for (const row of [node, ...node.querySelectorAll("[data-row-key]")]) {
        const key = row.getAttribute("data-row-key");

        if (key === null) continue;
        const kind = key.split(":")[0] ?? key;
        probe.mounts[kind] = (probe.mounts[kind] ?? 0) + 1;
        resized.observe(row);
      }
    };

    new MutationObserver((records) => {
      for (const record of records) for (const node of record.addedNodes) watch(node);
    }).observe(viewport, { childList: true, subtree: true });
  });
}

async function startTrace(page: Page): Promise<(path: string) => Promise<void>> {
  const session = await page.context().newCDPSession(page);
  await session.send("Tracing.start", {
    categories: TRACE_CATEGORIES,
    transferMode: "ReturnAsStream",
  });

  return async (path) => {
    const complete = new Promise<string | undefined>((resolve) =>
      session.once("Tracing.tracingComplete", (event) => resolve(event.stream)),
    );

    await session.send("Tracing.end");
    const stream = await complete;

    if (stream === undefined) throw new Error("Tracing finished without a stream");
    const chunks: Buffer[] = [];

    for (;;) {
      const read = await session.send("IO.read", { handle: stream });
      chunks.push(Buffer.from(read.data, read.base64Encoded === true ? "base64" : "utf8"));

      if (read.eof) break;
    }

    await session.send("IO.close", { handle: stream });
    await session.detach();
    await writeFile(path, Buffer.concat(chunks));
  };
}

async function typeMarked(page: Page, field: Locator, text: string): Promise<void> {
  await page.evaluate((name) => performance.mark(name), MARKS.start);
  await field.pressSequentially(text, { delay: KEY_DELAY_MS });
  await page.evaluate((name) => performance.mark(name), MARKS.end);
}

async function wheelUntilVisible(page: Page, log: Locator, target: Locator, deltaY: number) {
  await expect(async () => {
    await log.hover();
    await page.mouse.wheel(0, deltaY);
    await expect(target).toBeVisible({ timeout: 500 });
  }).toPass();
}

function distanceFromEnd(log: Locator): Promise<number> {
  return log.evaluate((element) => element.scrollHeight - element.clientHeight - element.scrollTop);
}

test("typing stays responsive while five agents stream", async ({ desktop }, testInfo) => {
  if (output === undefined) return;
  test.setTimeout(240_000);
  const { page } = desktop;
  const log = messages(page).first();
  const field = composer(page);
  const groupRow = log.locator("[data-row-key^='agents:']");
  const pill = chatPane(page).getByRole("button", { name: "Agents", exact: true });
  const allActive = `Agents, ${String(SWARM_AGENTS)} active`;

  const agents = Array.from({ length: SWARM_AGENTS }, (_, index) =>
    groupRow.getByRole("button", { name: new RegExp(`^Survey part ${String(index + 1)}\\b`, "u") }),
  );

  await mkdir(output, { recursive: true });
  await using cleanup = new AsyncDisposableStack();
  const tracePath = join(output, "trace.json");

  await page.evaluate(() => localStorage.setItem("NYTE_TRACE", "1"));
  await page.reload();
  await page.locator("[data-nyte-shell]").waitFor({ state: "visible" });

  await openNewChat(page);
  await send(page, HISTORY);
  await expect(log.getByText("Paragraph 60 of 60.", { exact: false })).toBeVisible();

  for (const note of NOTES) {
    await send(page, note);
    await expect(log.getByText(`Echo: ${note}`, { exact: true })).toBeVisible();
  }

  await installProbe(log);
  const stopTrace = await startTrace(page);
  cleanup.defer(() => stopTrace(tracePath));
  const start = await readCounts(page);

  await send(page, "/swarm");
  await expect(groupRow.getByText(`Running ${String(SWARM_AGENTS)} agents…`)).toBeVisible();
  await expect(pill).toHaveAccessibleDescription(allActive);

  for (const row of agents) {
    await expect(row).toBeVisible();
    await expect(row).toContainText(RUNNING_OR_DONE);
  }

  let following: Counts = {};
  let detail: Counts = {};
  let reading: Counts = {};

  await test.step("typing while following: every agent streams, the end stays in view", async () => {
    await field.click();
    const before = await readCounts(page);
    await typeMarked(page, field, FOLLOWING_DRAFT);
    following = difference(before, await readCounts(page));
    await expect(field).toHaveText(FOLLOWING_DRAFT);
    await expect(pill).toHaveAccessibleDescription(allActive);

    const streaming = Object.entries(following).filter(
      ([name, count]) => name.startsWith("publish:view:") && count >= STREAMING_PUBLICATIONS,
    );

    expect(streaming.length).toBeGreaterThanOrEqual(SWARM_AGENTS);
    await expect.poll(() => distanceFromEnd(log)).toBeLessThanOrEqual(1);
  });

  await test.step("typing with a child chat open: its output advances and both transcripts hold", async () => {
    await groupRow.getByRole("button", { name: /^Survey part 1\b/u }).click();
    const expand = chatPane(page).getByRole("button", { name: "Open as full chat" });
    await expect(expand).toBeVisible();
    const tray = chatPane(page).locator("[data-slot='tray']");
    const child = tray.getByRole("region", { name: "Messages", exact: true });
    await expect(child.getByRole("paragraph").last()).toBeInViewport();
    await field.click();
    await field.press("End");
    await expect.poll(() => distanceFromEnd(log)).toBeLessThanOrEqual(1);
    const anchor = await groupRow.elementHandle();

    if (anchor === null) throw new Error("The parent agents row is missing");

    await child.evaluate((viewport, anchor) => {
      const probe = window.nyteProbe;

      if (probe === undefined) throw new Error("The probe was not installed");

      const detail = {
        frames: 0,
        textChanges: 0,
        maxParentDrift: 0,
        blankFrames: 0,
        maxOverlap: 0,
        running: true,
        frame: 0,
        timer: 0,
      };

      probe.detail = detail;
      const parentTop = anchor.getBoundingClientRect().top;
      let text = viewport.textContent;

      const sample = (): void => {
        detail.frame = requestAnimationFrame(() => {
          detail.timer = window.setTimeout(() => {
            if (!detail.running) return;
            detail.frames += 1;
            detail.maxParentDrift = Math.max(
              detail.maxParentDrift,
              Math.abs(anchor.getBoundingClientRect().top - parentTop),
            );
            const box = viewport.getBoundingClientRect();

            const rows = [...viewport.querySelectorAll<HTMLElement>("[data-row-key]")]
              .map((row) => ({
                text: row.textContent?.trim() ?? "",
                box: row.getBoundingClientRect(),
              }))
              .filter(
                (row) => row.text !== "" && row.box.bottom > box.top && row.box.top < box.bottom,
              );

            if (rows.length === 0) detail.blankFrames += 1;

            for (let index = 1; index < rows.length; index += 1) {
              const previous = rows[index - 1];
              const row = rows[index];

              if (previous !== undefined && row !== undefined)
                detail.maxOverlap = Math.max(detail.maxOverlap, previous.box.bottom - row.box.top);
            }

            if (viewport.textContent !== text) detail.textChanges += 1;
            text = viewport.textContent;
            sample();
          }, 0);
        });
      };

      sample();
    }, anchor);
    await anchor.dispose();
    cleanup.defer(() =>
      page.evaluate(() => {
        const detail = window.nyteProbe?.detail;

        if (detail === undefined) return;
        detail.running = false;
        cancelAnimationFrame(detail.frame);
        clearTimeout(detail.timer);
      }),
    );
    const before = await readCounts(page);
    await typeMarked(page, field, DETAIL_DRAFT);
    detail = difference(before, await readCounts(page));

    const frames = await page.evaluate(() => {
      const detail = window.nyteProbe?.detail;

      if (detail === undefined) throw new Error("The child frame probe is missing");
      detail.running = false;
      cancelAnimationFrame(detail.frame);
      clearTimeout(detail.timer);

      return detail;
    });

    await testInfo.attach("child-chat-frames", {
      body: JSON.stringify(frames, null, 2),
      contentType: "application/json",
    });
    expect(frames.frames).toBeGreaterThan(1);
    expect(frames.textChanges).toBeGreaterThan(0);
    expect(frames.maxParentDrift).toBeLessThanOrEqual(1);
    expect(frames.blankFrames).toBe(0);
    expect(frames.maxOverlap).toBeLessThanOrEqual(1);
    expect(
      Object.entries(detail).filter(
        ([name, count]) => name.startsWith("publish:view:") && count >= STREAMING_PUBLICATIONS,
      ).length,
    ).toBeGreaterThanOrEqual(SWARM_AGENTS);
    await expect(field).toHaveText(`${FOLLOWING_DRAFT}${DETAIL_DRAFT}`);
    await expect(field).toBeFocused();
    await chatPane(page).getByRole("button", { name: "Close agents" }).click();
    await expect(expand).toBeHidden();
    await expect(field).toBeFocused();
  });

  const top = log.getByText("Paragraph 1 of 60.", { exact: false });

  await test.step("typing while reading: the agents row is evicted, the read position holds", async () => {
    await wheelUntilVisible(page, log, top, -50_000);
    await expect(groupRow).toHaveCount(0);
    const position = await top.evaluate((element) => element.getBoundingClientRect().top);
    const before = await readCounts(page);
    await typeMarked(page, field, READING_DRAFT);
    reading = difference(before, await readCounts(page));
    const moved = await top.evaluate((element) => element.getBoundingClientRect().top);
    expect(Math.abs(moved - position)).toBeLessThanOrEqual(1);
    await expect(pill).toHaveAccessibleDescription(allActive);
    await expect(groupRow).toHaveCount(0);
  });

  await test.step("returning to the agents: each shows its own child's status", async () => {
    const mounted = await page.evaluate(() => window.nyteProbe?.mounts.agents ?? 0);
    await wheelUntilVisible(page, log, groupRow, 50_000);
    expect(await page.evaluate(() => window.nyteProbe?.mounts.agents ?? 0)).toBeGreaterThan(
      mounted,
    );

    for (const row of agents) {
      await expect(row).toBeVisible();
      await expect(row).not.toContainText("Starting up");
      await expect(row).toContainText(RUNNING_OR_DONE);
    }

    await expect.poll(() => distanceFromEnd(log)).toBeLessThanOrEqual(1);
  });

  await test.step("every agent completes", async () => {
    await expect(
      groupRow.getByText(`${String(SWARM_AGENTS)} agents completed`, { exact: true }),
    ).toBeVisible({
      timeout: 90_000,
    });

    for (const row of agents) await expect(row).toContainText("Completed");
  });

  await test.step("the draft, focus and caret survive the run", async () => {
    await expect(field).toHaveText(`${FOLLOWING_DRAFT}${DETAIL_DRAFT}${READING_DRAFT}`);
    await expect(field).toBeFocused();

    const caret = await field.evaluate((editor) => {
      const selection = document.getSelection();

      if (selection?.focusNode == null || !selection.isCollapsed) return -1;
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.setEnd(selection.focusNode, selection.focusOffset);

      return range.toString().length;
    });

    expect(caret).toBe(FOLLOWING_DRAFT.length + DETAIL_DRAFT.length + READING_DRAFT.length);
  });

  const totals = difference(start, await readCounts(page));
  await cleanup.disposeAsync();
  const probe = await page.evaluate(() => window.nyteProbe);

  if (probe === undefined) throw new Error("The probe was not installed");
  const trace = await readInputTrace(tracePath, MARKS);
  const typed = FOLLOWING_DRAFT.length + DETAIL_DRAFT.length + READING_DRAFT.length;

  const summary = {
    keys: { typed, measured: trace.keydownMs.length },
    inputToPaintMs: {
      p50: percentile(trace.keydownMs, 0.5),
      p95: percentile(trace.keydownMs, 0.95),
      p99: percentile(trace.keydownMs, 0.99),
      max: Math.max(0, ...trace.keydownMs),
    },
    renderingMs: {
      samples: trace.renderingMs.length,
      p99: percentile(trace.renderingMs, 0.99),
      max: Math.max(...trace.renderingMs),
    },
    frameCadenceMs: {
      samples: probe.frameIntervalsMs.length,
      p50: percentile(probe.frameIntervalsMs, 0.5),
      p99: percentile(probe.frameIntervalsMs, 0.99),
      max: Math.max(...probe.frameIntervalsMs),
    },
    longTasks: trace.longTasks,
    layouts: trace.layouts,
    forcedLayouts: trace.forcedLayouts,
    styleRecalcs: trace.styleRecalcs,
    rowMounts: probe.mounts,
    rowResizes: probe.rowResizes,
    scrollEvents: probe.scrolls,
    childFrames: probe.detail,
    work: { following, detail, reading, totals },
  };

  await writeFile(join(output, "summary.json"), JSON.stringify(summary, null, 2));
  await testInfo.attach("summary", {
    body: JSON.stringify(summary, null, 2),
    contentType: "application/json",
  });

  expect(trace.keydownMs.length).toBeGreaterThanOrEqual(Math.floor(typed * 0.9));
  expect(summary.inputToPaintMs.p99).toBeLessThanOrEqual(KEY_P99_BUDGET_MS);
  expect(summary.inputToPaintMs.max).toBeLessThanOrEqual(KEY_MAX_BUDGET_MS);
  expect(summary.renderingMs.samples).toBeGreaterThanOrEqual(MIN_RENDER_SAMPLES);
  expect(summary.renderingMs.p99).toBeLessThanOrEqual(RENDER_P99_BUDGET_MS);
  if (process.env.NYTE_E2E_60FPS === "1")
    expect(summary.frameCadenceMs.p50, "The renderer must actually run at 60Hz").toBeCloseTo(
      1000 / 60,
      0,
    );
  expect(
    trace.longTasks.filter((task) => task.startMs >= 0),
    "No renderer task may take 50ms after typing starts, through all-agent completion",
  ).toEqual([]);
});
