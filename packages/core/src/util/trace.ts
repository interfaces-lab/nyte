/** The hops one user submit crosses, in the order a turn reaches them: client, host, the host's MCP and process children, and back to the client's paint. */
export const SPAN_NAMES = [
  "composer.submit",
  "sdk.send",
  "host.admit",
  "turn.start",
  "model.stream",
  "skill.load",
  "mcp.connect",
  "mcp.call",
  "mcp.serve",
  "tool.run",
  "canvas.compile",
  "canvas.paint",
  "pty.spawn",
  "pty.output",
  "part.publish",
  "client.paint",
] as const;

export type SpanName = (typeof SPAN_NAMES)[number];

/** Scalar facts a span carries beside its trace id. */
export type SpanDetail = Readonly<Record<string, string | number | boolean | null>>;

/** One timed hop, its start in epoch milliseconds so spans from different processes line up. */
export interface Span {
  readonly name: SpanName;
  readonly trace: string | null;
  readonly start: number;
  readonly duration: number;
  readonly detail: SpanDetail;
}

/** Ends a span, adding `detail` to what it started with. */
export type EndSpan = (detail?: SpanDetail) => void;

const NAMES: ReadonlySet<string> = new Set(SPAN_NAMES);

const TRACE_PATTERN = /^[0-9a-f]{32}$/;

const followed = new Map<string, string>();

const caused = new Map<string, string>();

let latest: string | null = null;

const NOOP: EndSpan = () => undefined;

const setting = readSetting();

/** Whether spans are recorded, and whether each one is also printed to stdout as a `NYTE_SPAN <json>` line. `NYTE_TRACE` (`1` records, `stdout` also prints) or a `NYTE_TRACE` localStorage key turns it on at load. */
export const tracing = {
  enabled: setting !== null,
  stdout: setting === "stdout",
};

/** Records spans in this process from now on; `stdout` (default as `NYTE_TRACE` set it) also prints each one as a `NYTE_SPAN <json>` line. */
export function enableTracing(options?: { readonly stdout?: boolean }): void {
  tracing.enabled = true;
  tracing.stdout = options?.stdout ?? tracing.stdout;
}

/** Starts the hop `name` of `trace` (null when the hop belongs to no submit, as a server's connect does), as a `performance.measure` its end records; a no-op while tracing is off. */
export function startSpan(name: SpanName, trace: string | null, detail?: SpanDetail): EndSpan {
  if (!tracing.enabled) return NOOP;
  const started = performance.now();
  let ended = false;

  return (more) => {
    if (ended) return;
    ended = true;
    const merged = { ...detail, ...more, trace };
    const end = performance.now();
    performance.measure(name, { start: started, end, detail: merged });

    if (tracing.stdout)
      console.log(
        `NYTE_SPAN ${JSON.stringify({
          name,
          trace,
          start: performance.timeOrigin + started,
          duration: end - started,
          detail: { ...detail, ...more },
        })}`,
      );
  };
}

/** Runs `work` inside the span `name` of `trace`, ending it however `work` settles. */
export async function traced<T>(
  name: SpanName,
  trace: string | null,
  detail: SpanDetail | undefined,
  work: () => Promise<T>,
): Promise<T> {
  const end = startSpan(name, trace, detail);

  try {
    return await work();
  } finally {
    end();
  }
}

/** Remembers `trace` as the submit `scope` (a session id) is serving, so hops that see only the session join it. */
export function followTrace(scope: string, trace: string): void {
  if (!tracing.enabled) return;
  followed.set(scope, trace);
  latest = trace;
}

/** Records that the submit with receipt `receipt` serves `trace`, as a subagent's task serves its parent's submit, so its admission joins `trace` instead of starting its own; a null `trace` records nothing. */
export function traceReceipt(receipt: string, trace: string | null): void {
  if (!tracing.enabled || trace === null) return;
  caused.set(receipt, trace);
}

/** The trace the submit with receipt `receipt` serves, which its admission takes once: the one `traceReceipt` gave it, else the receipt id itself. */
export function takeReceiptTrace(receipt: string): string {
  const trace = caused.get(receipt) ?? receipt;
  caused.delete(receipt);

  return trace;
}

/** The trace `scope` last followed, or without `scope` the one any scope followed last, as a renderer that knows no session reads it; null when none did or tracing is off. */
export function followedTrace(scope?: string): string | null {
  return scope === undefined ? latest : (followed.get(scope) ?? null);
}

/** The spans this process recorded, in start order; given `trace`, only its own. */
export function readSpans(trace?: string): readonly Span[] {
  if (typeof performance.getEntriesByType !== "function") return [];

  return performance
    .getEntriesByType("measure")
    .flatMap((entry) => {
      const span = readSpan(entry);

      return span === null || (trace !== undefined && span.trace !== trace) ? [] : [span];
    })
    .toSorted((a, b) => a.start - b.start);
}

/** Forgets the spans this process recorded and the traces it followed. */
export function clearSpans(): void {
  for (const name of SPAN_NAMES) performance.clearMeasures(name);
  followed.clear();
  caused.clear();
  latest = null;
}

/** The W3C `traceparent` value carrying `trace` to a child, its parent span id derived from the trace so no state is needed. */
export function traceparent(trace: string): string {
  const id = trace.replaceAll("-", "").toLowerCase().padEnd(32, "0").slice(0, 32);

  return `00-${id}-${id.slice(0, 16)}-01`;
}

/** The trace id in a `traceparent` value, as `traceparent` derived it from a UUID; null when it is not one. */
export function readTraceparent(value: string | undefined): string | null {
  const id = value?.split("-")[1];

  if (id === undefined || !TRACE_PATTERN.test(id)) return null;

  return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}

function readSpan(entry: PerformanceEntry): Span | null {
  if (!NAMES.has(entry.name) || !("detail" in entry)) return null;
  const name = SPAN_NAMES.find((candidate) => candidate === entry.name);
  const recorded = entry.detail;

  if (name === undefined || typeof recorded !== "object" || recorded === null) return null;
  const detail: Record<string, string | number | boolean | null> = {};
  let trace: string | null = null;

  for (const [key, value] of Object.entries(recorded)) {
    if (key === "trace") trace = typeof value === "string" ? value : null;
    else if (
      value === null ||
      typeof value === "string" ||
      typeof value === "number" ||
      typeof value === "boolean"
    )
      detail[key] = value;
  }

  return {
    name,
    trace,
    start: performance.timeOrigin + entry.startTime,
    duration: entry.duration,
    detail,
  };
}

/** `NYTE_TRACE` from the environment where there is one (Node's own `localStorage` warns when read), else from localStorage. */
function readSetting(): string | null {
  if (typeof process !== "undefined" && typeof process.env === "object") {
    const value = process.env.NYTE_TRACE;

    return value === undefined || value === "" || value === "0" ? null : value;
  }

  try {
    return globalThis.localStorage?.getItem("NYTE_TRACE") ?? null;
  } catch {
    return null;
  }
}
