import { readFile } from "node:fs/promises";
import type { CDPSession } from "@playwright/test";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

export const TRACE_CATEGORIES = [
  "devtools.timeline",
  "disabled-by-default-devtools.timeline",
  "blink.user_timing",
  "toplevel",
  "v8.execute",
].join(",");

const TraceEventType = Type.Object({
  name: Type.String(),
  ph: Type.String(),
  ts: Type.Number(),
  dur: Type.Optional(Type.Number()),
  pid: Type.Number(),
  tid: Type.Number(),
});

export type TraceEvent = Static<typeof TraceEventType>;

/** A span of one thread's trace, in trace microseconds. */
export interface TraceSpan {
  readonly from: number;
  readonly to: number;
}

/**
 * Where one span's main-thread time went. The chat's view travels from `requested` to `arrived`:
 * the thread idling in that stretch is waiting on the host, and its script is the transfer
 * (receiving the socket frame, parsing it and building the view). The rest of the script is
 * React. `otherMs` is paint, compositing and idle frames outside the wait.
 */
export interface MainThreadSplit {
  readonly hostWaitMs: number;
  readonly transferMs: number;
  readonly reactMs: number;
  readonly layoutMs: number;
  readonly otherMs: number;
}

const LAYOUT = new Set(["Layout", "UpdateLayoutTree", "RecalculateStyles"]);

const SCRIPT = new Set([
  "FunctionCall",
  "EvaluateScript",
  "V8.Execute",
  "v8.compile",
  "v8.compileModule",
  "v8.evaluateModule",
  "RunMicrotasks",
  "FireAnimationFrame",
  "TimerFire",
  "EventDispatch",
]);

function readTraceEvents(values: readonly unknown[]): TraceEvent[] {
  return values.flatMap((value) =>
    Value.Check(TraceEventType, value)
      ? [
          {
            name: value.name,
            ph: value.ph,
            ts: value.ts,
            dur: value.dur,
            pid: value.pid,
            tid: value.tid,
          },
        ]
      : [],
  );
}

export async function startTrace(session: CDPSession): Promise<() => Promise<TraceEvent[]>> {
  const events: TraceEvent[] = [];

  session.on("Tracing.dataCollected", (event) => {
    events.push(...readTraceEvents(event.value));
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

/** Reads a trace saved as a JSON array of events. */
export async function readTraceFile(path: string): Promise<TraceEvent[]> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));

  if (!Array.isArray(parsed)) throw new Error(`${path} holds no trace events`);

  return readTraceEvents(parsed);
}

/** The events of the thread that recorded the first `mark`: the renderer's main thread for a page's user timing mark. */
export function findThread(events: readonly TraceEvent[], mark: string): TraceEvent[] {
  const marked = events.find((event) => event.name === mark);

  if (marked === undefined) throw new Error(`The trace has no ${mark} mark`);

  return events.filter((event) => event.pid === marked.pid && event.tid === marked.tid);
}

export function markTimes(events: readonly TraceEvent[], name: string): number[] {
  return [...new Set(events.flatMap((event) => (event.name === name ? [event.ts] : [])))].toSorted(
    (first, second) => first - second,
  );
}

interface ThreadTime {
  readonly layout: number;
  readonly script: number;
  readonly busy: number;
  readonly idle: number;
}

function unionMs(intervals: readonly (readonly [number, number])[]): number {
  let total = 0;
  let reach = Number.NEGATIVE_INFINITY;

  for (const [from, to] of intervals.toSorted((first, second) => first[0] - second[0])) {
    if (to <= reach) continue;
    total += to - Math.max(from, reach);
    reach = to;
  }

  return total / 1000;
}

function classify(events: readonly TraceEvent[], span: TraceSpan): ThreadTime {
  const ranked = events.flatMap((event) => {
    if (event.ph !== "X" || event.dur === undefined) return [];
    const from = Math.max(span.from, event.ts);
    const to = Math.min(span.to, event.ts + event.dur);

    if (to <= from) return [];

    const rank = LAYOUT.has(event.name)
      ? 3
      : SCRIPT.has(event.name)
        ? 2
        : event.name === "RunTask" || event.name === "ThreadControllerImpl::RunTask"
          ? 1
          : 0;

    return rank === 0 ? [] : [{ rank, interval: [from, to] as const }];
  });

  const atLeast = (rank: number): number =>
    unionMs(ranked.flatMap((entry) => (entry.rank >= rank ? [entry.interval] : [])));

  const [busy, script, layout] = [atLeast(1), atLeast(2), atLeast(3)];

  return {
    idle: (span.to - span.from) / 1000 - busy,
    busy: busy - script,
    script: script - layout,
    layout,
  };
}

export function splitMainThread(
  events: readonly TraceEvent[],
  span: TraceSpan & {
    readonly waitFrom: number;
    readonly requested: number | undefined;
    readonly arrived: number | undefined;
  },
): MainThreadSplit {
  const whole = classify(events, span);
  const arrived = span.arrived === undefined ? undefined : Math.min(span.arrived, span.to);

  const waiting =
    arrived === undefined || arrived <= span.waitFrom
      ? undefined
      : classify(events, { from: span.waitFrom, to: arrived });

  const moving =
    arrived === undefined || span.requested === undefined || arrived <= span.requested
      ? undefined
      : classify(events, { from: Math.max(span.from, span.requested), to: arrived });

  const hostWait = waiting?.idle ?? 0;
  const transfer = moving?.script ?? 0;
  const react = Math.max(0, whole.script - transfer);
  const total = (span.to - span.from) / 1000;
  const round = (ms: number): number => Math.round(ms * 10) / 10;

  return {
    hostWaitMs: round(hostWait),
    transferMs: round(transfer),
    reactMs: round(react),
    layoutMs: round(whole.layout),
    otherMs: round(Math.max(0, total - hostWait - transfer - react - whole.layout)),
  };
}
