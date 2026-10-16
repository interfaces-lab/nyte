type Sink = (line: string) => void;

export interface DevRow {
  readonly ts: number;
  readonly source: string;
  readonly area: string;
  readonly message: string;
  readonly data: string;
}

const NOOP: Sink = () => undefined;

const CONSOLE: Sink = (line) => console.error(line);

let tap: ((area: string, message: string, json: string) => void) | undefined;

const FLUSH_MS = 100;

const FLUSH_ROWS = 50;

export function dev(area: string, message: string, data?: Record<string, unknown>): void {
  try {
    const json = data === undefined ? "{}" : JSON.stringify(data, replacer);
    dev.sink(`DEV:${area} ${message} ${json}`);
    tap?.(area, message, json);
  } catch {
    return;
  }
}

dev.sink = typeof process !== "undefined" && process.env.NYTE_DEV !== undefined ? CONSOLE : NOOP;

dev.off = (): void => {
  dev.sink = NOOP;
};

dev.on = (sink: Sink = CONSOLE): void => {
  dev.sink = sink;
};

dev.bytes = (value: unknown): number => new TextEncoder().encode(JSON.stringify(value)).byteLength;

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

  const sink = dev.sink;
  tap = push;

  if (sink === CONSOLE) dev.on((line) => error(line));
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
    dev.on(sink);

    if (timer !== undefined) clearTimeout(timer);
    flush();
  };
};

function replacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();

  if (typeof value === "number" && !Number.isInteger(value)) return Math.round(value * 100) / 100;

  if (value instanceof Uint8Array) return `<${value.byteLength} bytes>`;

  if (value instanceof Error) return `${value.name}: ${value.message}`;

  if (value instanceof Map) return [...value];

  if (value instanceof Set) return [...value];

  return value;
}
