import process from "node:process";
import { createInterface } from "node:readline/promises";
import { formatStatus } from "./format.ts";
import type { Output } from "./output.ts";

/**
 * The destructive tier's question: `? <question> (y/N) ` on stderr, one line from stdin, and only
 * `y` or `yes` is yes. Ask only when `output.mode.interactive`; without it, fail with `missing_input`
 * naming `--yes`. Readline stays in cooked mode, so Ctrl+C reaches the invocation as SIGINT and
 * aborts `signal`. An abort and an ended stdin both answer no; readline ends the prompt's line.
 */
export async function confirm(
  output: Output,
  question: string,
  signal: AbortSignal,
): Promise<boolean> {
  const rl = createInterface({ input: process.stdin, output: process.stderr, terminal: false });
  const ended = new AbortController();
  rl.once("close", () => ended.abort());

  const answer = await rl
    .question(`${formatStatus("prompt", `${question} (y/N)`, output.mode.stderr)} `, {
      signal: AbortSignal.any([signal, ended.signal]),
    })
    .catch(() => undefined);

  rl.close();

  return answer !== undefined && ["y", "yes"].includes(answer.trim().toLowerCase());
}
