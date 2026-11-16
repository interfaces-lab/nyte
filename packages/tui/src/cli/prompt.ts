import process from "node:process";
import { createInterface } from "node:readline/promises";
import { formatStatus } from "./format.ts";
import type { Output } from "./output.ts";

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
