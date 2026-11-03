import { mkdir, writeFile } from "node:fs/promises";
import { join } from "node:path";
import process from "node:process";
import type { CDPSession, Page } from "@playwright/test";
import { expect, test } from "./fixtures.ts";
import { chatPane, chatTab, revealChat } from "./ui.ts";

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

test.skip(output === undefined, "Set NYTE_PERF_DIR to record chat switching.");

const TRACE_CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "blink.user_timing",
  "toplevel",
  "v8.execute",
].join(",");

interface SwitchTiming {
  readonly chat: string;
  readonly clickMs: number;
  readonly paintedMs: number;
  readonly spanMs: number;
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

interface TraceEvent {
  readonly name: string;
  readonly ph: string;
  readonly ts: number;
  readonly dur?: number;
  readonly pid: number;
  readonly tid: number;
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
  };
}

async function startTrace(session: CDPSession): Promise<() => Promise<TraceEvent[]>> {
  const events: TraceEvent[] = [];

  session.on("Tracing.dataCollected", (event) => {
    for (const value of event.value) {
      const name: unknown = value["name"];
      const ph: unknown = value["ph"];
      const ts: unknown = value["ts"];
      const pid: unknown = value["pid"];
      const tid: unknown = value["tid"];
      const dur: unknown = value["dur"];

      if (
        typeof name === "string" &&
        typeof ph === "string" &&
        typeof ts === "number" &&
        typeof pid === "number" &&
        typeof tid === "number"
      )
        events.push({ name, ph, ts, pid, tid, dur: typeof dur === "number" ? dur : undefined });
    }
  });
  await session.send("Tracing.start", {
    categories: TRACE_CATEGORIES,
    transferMode: "ReportEvents",
  });

  return async () => {
    const complete = new Promise<void>((resolve) =>
      session.once("Tracing.tracingComplete", () => resolve()),
    );
    await session.send("Tracing.end");
    await complete;

    return events;
  };
}

function busyBy(
  events: readonly TraceEvent[],
  window: { readonly from: number; readonly to: number },
): Record<string, number> {
  const names = {
    script: ["FunctionCall", "EvaluateScript", "V8.Execute", "RunMicrotasks"],
    style: ["UpdateLayoutTree", "RecalculateStyles"],
    layout: ["Layout"],
    paint: ["Paint", "PrePaint", "Layerize", "UpdateLayer"],
    gc: ["MinorGC", "MajorGC", "V8.GC_SCAVENGER", "V8.GC_MARK_COMPACTOR"],
  } as const;

  const totals: Record<string, number> = { task: 0 };

  for (const kind of Object.keys(names)) totals[kind] = 0;

  for (const event of events) {
    if (event.ph !== "X" || event.dur === undefined) continue;
    const from = Math.max(window.from, event.ts);
    const to = Math.min(window.to, event.ts + event.dur);

    if (to <= from) continue;

    if (event.name === "RunTask") totals["task"] = (totals["task"] ?? 0) + (to - from) / 1_000;

    for (const [kind, list] of Object.entries(names))
      if (list.some((name) => name === event.name))
        totals[kind] = (totals[kind] ?? 0) + (to - from) / 1_000;
  }

  return Object.fromEntries(
    Object.entries(totals).map(([name, ms]) => [name, Math.round(ms * 10) / 10]),
  );
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

test("switching between long chats paints the last message quickly", async ({
  desktop,
}, testInfo) => {
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
  const main = mainThread(events);
  const painted = markTimes(events, "nyte:switch:painted");

  if (painted.length !== SWITCHES)
    throw new Error(`The trace has ${String(painted.length)} painted marks`);

  const switches = timings.map((timing, index) => {
    const to = painted[index] ?? 0;
    const from = to - timing.spanMs * 1_000;
    const busy = busyBy(main, { from, to });

    return {
      index: index + 1,
      ...timing,
      busy,
      idleMs: Math.round((timing.spanMs - (busy["task"] ?? 0)) * 10) / 10,
      window: { from, to },
      hot: hotFunctions(profiled.profile, [{ from, to }]),
    };
  });

  const slowest = switches.toSorted((first, second) => second.spanMs - first.spanMs).slice(0, 3);

  const summary = {
    switches: spans.length,
    medianMs: percentile(spans, 0.5),
    p95Ms: percentile(spans, 0.95),
    maxMs: Math.max(...spans),
    spansMs: spans.map((span) => Math.round(span * 10) / 10),
    slowest,
    all: switches.map((entry) => ({
      index: entry.index,
      chat: entry.chat,
      spanMs: Math.round(entry.spanMs * 10) / 10,
      busy: entry.busy,
      idleMs: entry.idleMs,
      window: entry.window,
    })),
    hotAcrossSwitches: hotFunctions(
      profiled.profile,
      switches.map((entry) => entry.window),
    ),
    busyAcrossSwitches: switches.reduce<Record<string, number>>((totals, entry) => {
      for (const [kind, ms] of Object.entries(entry.busy))
        totals[kind] = Math.round(((totals[kind] ?? 0) + ms) * 10) / 10;

      return totals;
    }, {}),
  };

  await writeFile(join(output, "chat-switching.json"), JSON.stringify(summary, null, 2));
  await writeFile(join(output, "chat-switching.cpuprofile"), JSON.stringify(profiled.profile));
  await testInfo.attach("summary", {
    body: JSON.stringify(summary, null, 2),
    contentType: "application/json",
  });
  expect(spans).toHaveLength(SWITCHES);
});

function mainThread(events: readonly TraceEvent[]): TraceEvent[] {
  const counts = new Map<string, number>();

  for (const event of events)
    if (event.name === "FunctionCall" || event.name === "UpdateLayoutTree") {
      const key = `${String(event.pid)}:${String(event.tid)}`;
      counts.set(key, (counts.get(key) ?? 0) + 1);
    }

  const busiest = [...counts].toSorted((first, second) => second[1] - first[1])[0]?.[0];

  return events.filter((event) => `${String(event.pid)}:${String(event.tid)}` === busiest);
}

function markTimes(events: readonly TraceEvent[], name: string): number[] {
  return [
    ...new Set(events.filter((event) => event.name === name).map((event) => event.ts)),
  ].toSorted((first, second) => first - second);
}
