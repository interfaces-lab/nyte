import { formatRows, formatStatus } from "./format.ts";
import type { Row, Gutter } from "./format.ts";
import type { Json } from "@nyte-ai/sdk";
import type { Mode } from "./mode.ts";

/**
 * The two streams of a one-shot command. stdout holds only the answer; everything else goes to
 * stderr. Writes never go through `console`, which Bun paints red on a terminal.
 * A closed stdout (EPIPE) drops later stdout writes and aborts `closed`; it never throws.
 */
export interface Output {
  readonly mode: Mode;
  /** Aborts when stdout closes. A follow command stops on it; a read just finishes. */
  readonly closed: AbortSignal;
  /** The answer, as given. */
  result(text: string): void;
  /** One JSON document and a newline on stdout: indented 2 on a terminal, one line otherwise. */
  json(value: Json): void;
  /** One human line on stderr. */
  say(text: string): void;
  /** Label/value rows on stderr, through `formatRows`. */
  rows(rows: readonly Row[]): void;
  /** One status line on stderr, through `formatStatus`. */
  status(gutter: Gutter, text: string): void;
  /**
   * The phase of long work on stderr, such as `Downloading nyte 0.0.28…` with a `40%` detail.
   * Rich and interactive: one line redrawn in place, which the next write to either stream clears.
   * Otherwise each new phase prints once and `detail` is dropped.
   */
  progress(phase: string, detail?: string): void;
}

/** A stderr that fails has no one left to tell, so its error listener only keeps Bun from throwing. */
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
