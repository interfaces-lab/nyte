import { readFile } from "node:fs/promises";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

const TraceEventSchema = Type.Object({
  name: Type.String(),
  ph: Type.String(),
  ts: Type.Number(),
  pid: Type.Number(),
  tid: Type.Number(),
  dur: Type.Optional(Type.Number()),
  id: Type.Optional(Type.String()),
  id2: Type.Optional(
    Type.Object({ local: Type.Optional(Type.String()), global: Type.Optional(Type.String()) }),
  ),
  args: Type.Optional(
    Type.Object({
      data: Type.Optional(
        Type.Object({
          type: Type.Optional(Type.String()),
          functionName: Type.Optional(Type.String()),
          url: Type.Optional(Type.String()),
          lineNumber: Type.Optional(Type.Number()),
        }),
      ),
      beginData: Type.Optional(
        Type.Object({ stackTrace: Type.Optional(Type.Array(Type.Unknown())) }),
      ),
    }),
  ),
});

type TraceEvent = Static<typeof TraceEventSchema>;

const TraceSchema = Type.Object({ traceEvents: Type.Array(Type.Unknown()) });

const LONG_TASK_US = 50_000;

const SCRIPT_EVENTS: ReadonlySet<string> = new Set(["FunctionCall", "EvaluateScript"]);

export interface LongTask {
  readonly startMs: number;
  readonly durationMs: number;
  readonly layoutMs: number;
  readonly styleMs: number;
  readonly scripts: readonly { readonly source: string; readonly durationMs: number }[];
}

export interface InputTrace {
  /** Each keydown's Event Timing span, from its timestamp to the paint after it, inside the marked windows. */
  readonly keydownMs: readonly number[];
  readonly renderingMs: readonly number[];
  readonly longTasks: readonly LongTask[];
  readonly layouts: number;
  readonly forcedLayouts: number;
  readonly styleRecalcs: number;
}

function readEvents(json: unknown): TraceEvent[] {
  if (!Value.Check(TraceSchema, json)) throw new Error("The trace has no traceEvents array");

  return json.traceEvents.flatMap((event) => (Value.Check(TraceEventSchema, event) ? [event] : []));
}

function markTimes(events: readonly TraceEvent[], name: string): number[] {
  return [...new Set(events.filter((event) => event.name === name).map((event) => event.ts))];
}

function asyncId(event: TraceEvent): string {
  return event.id2?.local ?? event.id2?.global ?? event.id ?? "";
}

export async function readInputTrace(
  path: string,
  marks: { readonly start: string; readonly end: string },
): Promise<InputTrace> {
  const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
  const events = readEvents(parsed);
  const starts = markTimes(events, marks.start);
  const ends = markTimes(events, marks.end);

  if (starts.length === 0 || starts.length !== ends.length)
    throw new Error(
      `The trace has ${String(starts.length)} start and ${String(ends.length)} end marks`,
    );

  const windows = starts.map((start, index) => ({ start, end: ends[index] ?? start }));
  const begins = new Map<string, TraceEvent>();
  const keydowns: { readonly event: TraceEvent; readonly durationMs: number }[] = [];

  for (const event of events) {
    if (event.name !== "EventTiming") continue;

    if (event.ph === "b") begins.set(asyncId(event), event);

    if (event.ph !== "e") continue;
    const begin = begins.get(asyncId(event));
    begins.delete(asyncId(event));

    if (
      begin?.args?.data?.type === "keydown" &&
      windows.some((window) => begin.ts >= window.start && begin.ts <= window.end)
    )
      keydowns.push({ event: begin, durationMs: (event.ts - begin.ts) / 1_000 });
  }

  const main = keydowns[0]?.event;

  if (main === undefined)
    throw new Error("The trace has no keydown Event Timing in the marked windows");

  const thread = events
    .filter((event) => event.pid === main.pid && event.tid === main.tid)
    .toSorted((first, second) => first.ts - second.ts);

  const renderBegins = new Map<string, number[]>();
  const renderingMs: number[] = [];

  for (const event of thread) {
    if (event.name !== "AnimationFrame::Render") continue;

    if (event.ph === "X" && event.dur !== undefined) {
      renderingMs.push(event.dur / 1_000);

      continue;
    }

    const key = asyncId(event);

    if (event.ph === "b" || event.ph === "B") {
      const pending = renderBegins.get(key) ?? [];
      pending.push(event.ts);
      renderBegins.set(key, pending);
    }

    if (event.ph !== "e" && event.ph !== "E") continue;
    const begin = renderBegins.get(key)?.pop();

    if (begin !== undefined) renderingMs.push((event.ts - begin) / 1_000);
  }

  if (renderingMs.length === 0)
    throw new Error(
      "The trace has no complete AnimationFrame::Render phases on the renderer thread",
    );

  const first = windows[0]?.start ?? 0;
  const last = windows.at(-1)?.end ?? 0;
  const span = thread.filter((event) => event.ts >= first && event.ts <= last);

  const longTasks = thread
    .filter((event) => event.name === "RunTask" && (event.dur ?? 0) >= LONG_TASK_US)
    .map((task): LongTask => {
      const end = task.ts + (task.dur ?? 0);
      const inside = thread.filter(
        (event) => event !== task && event.ts >= task.ts && event.ts + (event.dur ?? 0) <= end,
      );
      const sum = (name: string) =>
        inside
          .filter((event) => event.name === name)
          .reduce((total, event) => total + (event.dur ?? 0) / 1_000, 0);
      const scripts = new Map<string, number>();

      for (const event of inside) {
        if (!SCRIPT_EVENTS.has(event.name)) continue;
        const data = event.args?.data;
        const name =
          data?.functionName === undefined || data.functionName === ""
            ? "(anonymous)"
            : data.functionName;
        const source = `${name} ${data?.url ?? ""}:${String(data?.lineNumber ?? 0)}`;
        scripts.set(source, (scripts.get(source) ?? 0) + (event.dur ?? 0) / 1_000);
      }

      return {
        startMs: (task.ts - first) / 1_000,
        durationMs: (task.dur ?? 0) / 1_000,
        layoutMs: sum("Layout"),
        styleMs: sum("UpdateLayoutTree"),
        scripts: [...scripts]
          .map(([source, durationMs]) => ({ source, durationMs }))
          .toSorted((left, right) => right.durationMs - left.durationMs)
          .slice(0, 5),
      };
    });

  const layouts = span.filter((event) => event.name === "Layout");

  return {
    keydownMs: keydowns.map((keydown) => keydown.durationMs),
    renderingMs,
    longTasks,
    layouts: layouts.length,
    forcedLayouts: layouts.filter((event) => event.args?.beginData?.stackTrace !== undefined)
      .length,
    styleRecalcs: span.filter((event) => event.name === "UpdateLayoutTree").length,
  };
}
