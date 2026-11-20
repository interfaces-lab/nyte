import { formatRows, formatStatus } from "./format.ts";
import type { Row, Gutter } from "./format.ts";
import type { Json } from "@nyte-ai/sdk";
import type { Mode } from "./mode.ts";

export interface Output {
  readonly mode: Mode;
  readonly closed: AbortSignal;
  result(text: string): void;
  json(value: Json): void;
  say(text: string): void;
  rows(rows: readonly Row[]): void;
  status(gutter: Gutter, text: string): void;
  progress(phase: string, detail?: string): void;
}

export function createOutput(
  mode: Mode,
  streams: { readonly stdout: NodeJS.WriteStream; readonly stderr: NodeJS.WriteStream },
): Output {
  const closed = new AbortController();

  streams.stdout.on("error", () => closed.abort(new Error("stdout closed")));
  streams.stderr.on("error", () => undefined);

  const animate = mode.interactive && mode.stderr.rich;
  let drawn = false;
  let phase: string | undefined;

  const clear = (): void => {
    if (drawn) streams.stderr.write("\r\x1b[K");
    drawn = false;
  };

  const result = (text: string): void => {
    clear();

    if (!closed.signal.aborted) streams.stdout.write(text);
  };

  const say = (text: string): void => {
    clear();
    streams.stderr.write(`${text}\n`);
  };

  return {
    mode,
    closed: closed.signal,
    result,
    json: (value) => result(`${JSON.stringify(value, null, mode.stdout.rich ? 2 : undefined)}\n`),
    say,
    rows: (rows) => {
      for (const line of formatRows(rows, mode.stderr)) say(line);
    },
    status: (gutter, text) => say(formatStatus(gutter, text, mode.stderr)),
    progress: (next, detail) => {
      const line = formatStatus("none", next, mode.stderr);

      if (animate) {
        streams.stderr.write(`\r\x1b[K${detail === undefined ? line : `${line} ${detail}`}`);
        drawn = true;
      } else if (next !== phase) say(line);

      phase = next;
    },
  };
}
