/** Returns where a DEV line goes. */
type Sink = (line: string) => void;

const NOOP: Sink = () => undefined;

const CONSOLE: Sink = (line) => console.debug(line);

/** Writes one DEV log line, `DEV:<area> <message> <json>`, to `dev.sink` (§46; temporary, stripped after the refactor): ids and sizes only, never secrets, tokens or message bodies. Nothing reads it and nothing branches on it; a value it cannot serialise drops the line. `dev.off()` silences it, `dev.on(sink?)` restores it (default `console.debug`). */
export function dev(area: string, message: string, data?: Record<string, unknown>): void {
  try {
    dev.sink(
      `DEV:${area} ${message} ${data === undefined ? "{}" : JSON.stringify(data, replacer)}`,
    );
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

/** Returns a value as the line shows it: a bigint as its digits, bytes as their count, an error as `name: message`, a map as its entries and a set as its values. */
function replacer(_key: string, value: unknown): unknown {
  if (typeof value === "bigint") return value.toString();

  if (value instanceof Uint8Array) return `<${value.byteLength} bytes>`;

  if (value instanceof Error) return `${value.name}: ${value.message}`;

  if (value instanceof Map) return [...value];

  if (value instanceof Set) return [...value];

  return value;
}
