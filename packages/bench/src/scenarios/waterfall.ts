import { readFile } from "node:fs/promises";
import { SPAN_NAMES } from "@nyte-ai/core";
import type { Span, SpanDetail, SpanName } from "@nyte-ai/core";

export interface WaterfallRow {
  readonly name: SpanName;
  readonly process: string;
  readonly at: number;
  readonly duration: number;
  readonly traced: boolean;
  readonly detail: SpanDetail;
}

export interface Waterfall {
  readonly trace: string;
  readonly total: number;
  readonly rows: readonly WaterfallRow[];
}

export interface SpanSource {
  readonly process: string;
  readonly spans: readonly Span[];
}

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

export function formatWaterfall(waterfall: Waterfall, width = 48): string {
  const scale = waterfall.total === 0 ? 0 : width / waterfall.total;
  const label = Math.max(...waterfall.rows.map((row) => row.name.length + row.process.length + 3));

  const lines = waterfall.rows.map((row) => {
    const offset = Math.max(0, Math.min(width - 1, Math.floor(row.at * scale)));
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

export async function readSpanFile(path: string): Promise<readonly Span[]> {
  const text = await readFile(path, "utf8").catch(() => "");

  return text.split("\n").flatMap((line) => {
    if (line.trim() === "") return [];
    const span = parseSpan(JSON.parse(line));

    return span === null ? [] : [span];
  });
}

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
