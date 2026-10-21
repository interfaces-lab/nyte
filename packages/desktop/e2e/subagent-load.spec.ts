import { Buffer } from "node:buffer";
import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import type { Locator, Page } from "@playwright/test";
import { SWARM_AGENTS } from "../src/main/fixtures/e2e-models.ts";
import { expect, test } from "./fixtures.ts";
import { composer, messages, openNewChat, send } from "./ui.ts";

test.use({ chapter: "subagent-load" });

const output = process.env.NYTE_PERF_DIR;

test.skip(output === undefined, "Set NYTE_PERF_DIR to record the subagent load workload.");

const HISTORY = "/long 60";

const NOTES = ["First note", "Second note"];

const FOLLOWING_DRAFT = "Typing while five agents stream ";

const READING_DRAFT = "keeps every keystroke where it lands.";

const KEY_DELAY_MS = 35;

const TRACE_CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "disabled-by-default-devtools.timeline.frame",
  "blink.user_timing",
  "latencyInfo",
  "v8.execute",
  "disabled-by-default-v8.cpu_profiler",
].join(",");

interface Probe {
  readonly inputs: number[];
  readonly slowEvents: { readonly name: string; readonly duration: number }[];
  readonly frames: string[];
  readonly scrolls: number[];
  rowMounts: number;
  rowResizes: number;
}

declare global {
  interface Window {
    nyteProbe?: Probe;
  }
}

function percentile(values: readonly number[], fraction: number): number {
  const sorted = values.toSorted((first, second) => first - second);

  return sorted[Math.min(sorted.length - 1, Math.floor(fraction * sorted.length))] ?? 0;
}

async function installProbe(page: Page): Promise<void> {
  await page.evaluate(() => {
    const probe: Probe = {
      inputs: [],
      slowEvents: [],
      frames: [],
      scrolls: [],
      rowMounts: 0,
      rowResizes: 0,
    };
    window.nyteProbe = probe;

    document.addEventListener(
      "keydown",
      (event) => {
        const start = event.timeStamp;
        requestAnimationFrame(() =>
          setTimeout(() => probe.inputs.push(performance.now() - start), 0),
        );
      },
      { capture: true },
    );

    const events = { type: "event", durationThreshold: 16 };
    new PerformanceObserver((list) => {
      for (const entry of list.getEntries())
        probe.slowEvents.push({ name: entry.name, duration: entry.duration });
    }).observe(events);

    new PerformanceObserver((list) => {
      for (const entry of list.getEntries()) probe.frames.push(JSON.stringify(entry));
    }).observe({ type: "long-animation-frame" });

    const viewport = document.querySelector("[role='region'][aria-label='Messages']");

    if (viewport === null) throw new Error("The Messages region is not mounted");
    viewport.addEventListener("scroll", () => probe.scrolls.push(performance.now()), {
      passive: true,
    });

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
        if (!row.hasAttribute("data-row-key")) continue;
        probe.rowMounts += 1;
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
  const { page } = desktop;
  const log = messages(page);
  const field = composer(page);
  const directory = join(output, testInfo.project.name || "desktop");
  await mkdir(directory, { recursive: true });

  await openNewChat(page);
  await send(page, HISTORY);
  await expect(log.getByText("Paragraph 60 of 60.", { exact: false })).toBeVisible();

  for (const note of NOTES) {
    await send(page, note);
    await expect(log.getByText(`Echo: ${note}`, { exact: true })).toBeVisible();
  }

  await installProbe(page);
  const stopTrace = await startTrace(page);

  await send(page, "/swarm");
  const group = log.getByText(`Running ${String(SWARM_AGENTS)} agents…`, { exact: true });
  await expect(group).toBeVisible();
  const first = log.getByRole("button", { name: /^Survey part 1/u }).first();
  await expect(first).toBeVisible();
  await expect(first).not.toContainText("Starting up");

  await test.step("typing while following keeps the transcript at its end", async () => {
    await field.click();
    await field.pressSequentially(FOLLOWING_DRAFT, { delay: KEY_DELAY_MS });
    await expect(field).toHaveText(FOLLOWING_DRAFT);
    await expect.poll(() => distanceFromEnd(log)).toBeLessThanOrEqual(1);
  });

  const top = log.getByText("Paragraph 1 of 60.", { exact: false });

  await test.step("typing while reading holds the read position", async () => {
    await wheelUntilVisible(page, log, top, -50_000);
    await expect(group).toHaveCount(0);
    const before = await top.evaluate((element) => element.getBoundingClientRect().top);
    await field.pressSequentially(READING_DRAFT, { delay: KEY_DELAY_MS });
    const after = await top.evaluate((element) => element.getBoundingClientRect().top);
    expect(Math.abs(after - before)).toBeLessThanOrEqual(1);
  });

  await test.step("returning to the agents shows each one's own status", async () => {
    await wheelUntilVisible(page, log, first, 50_000);
    await expect(first).not.toContainText("Starting up");
    await expect.poll(() => distanceFromEnd(log)).toBeLessThanOrEqual(1);
    await expect(
      log.getByText(`${String(SWARM_AGENTS)} agents completed`, { exact: true }),
    ).toBeVisible({ timeout: 60_000 });
    await expect(first).toContainText("Completed");
  });

  await test.step("the draft, focus and caret survive the run", async () => {
    await expect(field).toHaveText(`${FOLLOWING_DRAFT}${READING_DRAFT}`);
    await expect(field).toBeFocused();

    const caret = await field.evaluate((editor) => {
      const selection = document.getSelection();

      if (selection?.focusNode == null || !selection.isCollapsed) return -1;
      const range = document.createRange();
      range.selectNodeContents(editor);
      range.setEnd(selection.focusNode, selection.focusOffset);

      return range.toString().length;
    });
    expect(caret).toBe(FOLLOWING_DRAFT.length + READING_DRAFT.length);
  });

  await stopTrace(join(directory, "trace.json"));
  const probe = await page.evaluate(() => window.nyteProbe);

  if (probe === undefined) throw new Error("The probe was not installed");

  const summary = {
    keys: probe.inputs.length,
    inputToFrameMs: {
      p50: percentile(probe.inputs, 0.5),
      p95: percentile(probe.inputs, 0.95),
      max: Math.max(0, ...probe.inputs),
    },
    slowEvents: probe.slowEvents.length,
    longAnimationFrames: probe.frames.length,
    rowMounts: probe.rowMounts,
    rowResizes: probe.rowResizes,
    scrollEvents: probe.scrolls.length,
  };

  await writeFile(join(directory, "probe.json"), JSON.stringify(probe, null, 2));
  await writeFile(join(directory, "summary.json"), JSON.stringify(summary, null, 2));
  await testInfo.attach("summary", {
    body: JSON.stringify(summary, null, 2),
    contentType: "application/json",
  });
});
