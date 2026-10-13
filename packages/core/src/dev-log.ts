/** Returns where a DEV line goes. */
type Sink = (line: string) => void;

/** One row the dev console shows: when, which process, which area, and the message with its JSON. */
export interface DevRow {
  readonly ts: number;
  readonly source: string;
  readonly area: string;
  readonly message: string;
  readonly data: string;
}

const NOOP: Sink = () => undefined;

const CONSOLE: Sink = (line) => console.error(line);

/** Set by `dev.forward`; sees every line the sink sees, already serialised. */
let tap: ((area: string, message: string, json: string) => void) | undefined;

const FLUSH_MS = 100;

const FLUSH_ROWS = 50;

/** Writes one DEV log line, `DEV:<area> <message> <json>`, to `dev.sink` (temporary, stripped after the refactor): ids and sizes only, never secrets, tokens or message bodies. Nothing reads it and nothing branches on it; a value it cannot serialise drops the line. `dev.off()` silences it, `dev.on(sink?)` restores it (default `console.error`, stderr, so `-p` and `--json` output on stdout stays clean). `dev.forward(url, source)` also posts every line, `console.warn`/`console.error` call and uncaught exception to a dev console. */
export function dev(area: string, message: string, data?: Record<string, unknown>): void {
  try {
    const json = data === undefined ? "{}" : JSON.stringify(data, replacer);
    dev.sink(`DEV:${area} ${message} ${json}`);
    tap?.(area, message, json);
  } catch {
    return;
  }
}

dev.sink = CONSOLE;

dev.off = (): void => {
  dev.sink = NOOP;
};

dev.on = (sink: Sink = CONSOLE): void => {
  dev.sink = sink;
};

/** Returns a value's size as UTF-8 JSON, what a line reports as `bytes`. */
dev.bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;

/**
 * Posts DEV lines, `console.warn` and `console.error` calls, and uncaught
 * exceptions in batches to `url` as JSON arrays of `DevRow`, tagged with
 * `source` so one console can tell the processes apart. A console that is
 * down drops the batch; nothing waits on it. Returns the function that
 * restores the console methods and stops forwarding.
 */
dev.forward = (url: string, source: string): (() => void) => {
  const queue: DevRow[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const error = console.error;
  const warn = console.warn;

  const flush = (): void => {
    timer = undefined;

    if (queue.length === 0) return;
    const body = JSON.stringify(queue.splice(0));

    fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body,
      keepalive: true,
    }).catch(() => undefined);
  };

  const push = (area: string, message: string, data: string): void => {
    queue.push({ ts: Date.now(), source, area, message, data });

    if (queue.length >= FLUSH_ROWS) {
      if (timer !== undefined) clearTimeout(timer);
      flush();

      return;
    }

    timer ??= setTimeout(flush, FLUSH_MS);
  };

  const describe = (args: readonly unknown[]): string => {
    try {
      return JSON.stringify(
        args.map((arg) =>
          arg instanceof Error ? (arg.stack ?? `${arg.name}: ${arg.message}`) : arg,
        ),
        replacer,
      );
    } catch {
      return JSON.stringify(args.map(String));
    }
  };

  tap = push;
  dev.on((line) => error(line));
  console.error = (...args: unknown[]) => {
    error(...args);
    push("console", "error", describe(args));
  };
  console.warn = (...args: unknown[]) => {
    warn(...args);
    push("console", "warn", describe(args));
  };

  const uncaught = (thrown: unknown): void => push("process", "uncaught", describe([thrown]));

  if (typeof process !== "undefined" && typeof process.on === "function") {
    process.on("uncaughtExceptionMonitor", uncaught);
  }

  return () => {
    if (typeof process !== "undefined" && typeof process.off === "function") {
      process.off("uncaughtExceptionMonitor", uncaught);
    }

    console.error = error;
    console.warn = warn;
    tap = undefined;
    dev.on();

    if (timer !== undefined) clearTimeout(timer);
    flush();
  };
};

/** Returns a value as the line shows it: a bigint as its digits, bytes as their count, an error as `name: message`, a map as its entries and a set as its values. */
function replacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();

  if (value instanceof Uint8Array) return `<${value.byteLength} bytes>`;

  if (value instanceof Error) return `${value.name}: ${value.message}`;

  if (value instanceof Map) return [...value];

  if (value instanceof Set) return [...value];

  return value;
}
