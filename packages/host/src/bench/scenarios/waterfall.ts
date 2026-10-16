import { readFile } from "node:fs/promises";
import { SPAN_NAMES } from "@nyte-ai/core";
import type { Span, SpanDetail, SpanName } from "@nyte-ai/core";

/** One span on a waterfall: its start and length in milliseconds from the trace's first span. */
export interface WaterfallRow {
  readonly name: SpanName;
  /** Which process recorded it: `host`, or a child such as `mcp:places`. */
  readonly process: string;
  readonly at: number;
  readonly duration: number;
  /** False for a span no submit owns (a server's connect, a user's terminal) that ran inside the trace's window. */
  readonly traced: boolean;
  readonly detail: SpanDetail;
}

/** One submit's spans from every process, in start order. */
export interface Waterfall {
  readonly trace: string;
  readonly total: number;
  readonly rows: readonly WaterfallRow[];
}

/** Spans as one process recorded them. */
export interface SpanSource {
  readonly process: string;
  readonly spans: readonly Span[];
}

/**
 * Lines up `trace`'s spans from every source, with the untraced spans that
 * overlap its window (from its first span's start to its last one's end).
 */
export function buildWaterfall(trace: string, sources: readonly SpanSource[]): Waterfall {
  const owned = sources.flatMap((source) =>
    source.spans.flatMap((span) => (span.trace === trace ? [{ span, source }] : [])),
  );

  const first = Math.min(...owned.map(({ span }) => span.start));
  const last = Math.max(...owned.map(({ span }) => span.start + span.duration));

  const overlapping = sources.flatMap((source) =>
    source.spans.flatMap((span) =>
      span.trace === null && span.start < last && span.start + span.duration > first
        ? [{ span, source }]
        : [],
    ),
  );

  const rows = [...owned, ...overlapping]
    .map(({ span, source }) => ({
      name: span.name,
      process: source.process,
      at: round(span.start - first),
      duration: round(span.duration),
      traced: span.trace !== null,
      detail: span.detail,
    }))
    .toSorted((a, b) => a.at - b.at);

  return { trace, total: owned.length === 0 ? 0 : round(last - first), rows };
}

/** Draws `waterfall` as text: one line per span, a bar scaled to `width` columns. */
export function formatWaterfall(waterfall: Waterfall, width = 48): string {
  const scale = waterfall.total === 0 ? 0 : width / waterfall.total;
  const label = Math.max(...waterfall.rows.map((row) => row.name.length + row.process.length + 3));

  const lines = waterfall.rows.map((row) => {
    const offset = Math.min(width - 1, Math.floor(row.at * scale));
    const length = Math.max(1, Math.round(row.duration * scale));
    const bar = `${" ".repeat(offset)}${"█".repeat(Math.min(length, width - offset))}`;
    const name = `${row.name} [${row.process}]${row.traced ? "" : "*"}`.padEnd(label + 1);

    const facts = Object.entries(row.detail)
      .filter(([key]) => key !== "session")
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(" ");

    return `${name} ${bar.padEnd(width)} ${row.at.toFixed(1).padStart(8)} +${row.duration.toFixed(1).padStart(7)} ms  ${facts}`;
  });

  return [
    `trace ${waterfall.trace}: ${waterfall.total.toFixed(1)} ms, ${waterfall.rows.length} spans (* untraced)`,
    ...lines,
  ].join("\n");
}

/** Reads the spans a child appended to `path`, one JSON line each, as the fixture servers write them; malformed lines are skipped. */
export async function readSpanFile(path: string): Promise<readonly Span[]> {
  const text = await readFile(path, "utf8").catch(() => "");

  return text.split("\n").flatMap((line) => {
    if (line.trim() === "") return [];
    const span = parseSpan(JSON.parse(line));

    return span === null ? [] : [span];
  });
}

/** Reads the spans a process printed as `NYTE_SPAN <json>` lines (`NYTE_TRACE=stdout`) out of its `output`. */
export function readPrintedSpans(output: string): readonly Span[] {
  return output.split("\n").flatMap((line) => {
    const json = line.startsWith("NYTE_SPAN ") ? line.slice("NYTE_SPAN ".length) : null;
    const span = json === null ? null : parseSpan(JSON.parse(json));

    return span === null ? [] : [span];
  });
}

function parseSpan(value: unknown): Span | null {
  if (typeof value !== "object" || value === null) return null;
  const fields = new Map<string, unknown>(Object.entries(value));
  const name = SPAN_NAMES.find((candidate) => candidate === fields.get("name"));
  const trace = fields.get("trace");
  const start = fields.get("start");
  const duration = fields.get("duration");
  const detail = fields.get("detail");

  if (
    name === undefined ||
    (trace !== null && typeof trace !== "string") ||
    typeof start !== "number" ||
    typeof duration !== "number"
  )
    return null;

  return { name, trace, start, duration, detail: readDetail(detail) };
}

function readDetail(value: unknown): SpanDetail {
  if (typeof value !== "object" || value === null) return {};
  const detail: Record<string, string | number | boolean | null> = {};

  for (const [key, field] of Object.entries(value))
    if (
      field === null ||
      typeof field === "string" ||
      typeof field === "number" ||
      typeof field === "boolean"
    )
      detail[key] = field;

  return detail;
}

function round(ms: number): number {
  return Math.round(ms * 100) / 100;
}
