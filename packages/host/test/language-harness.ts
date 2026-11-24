import { execFileSync } from "node:child_process";
import { asId } from "@nyte-ai/schema";
import type { ExecutionEnv } from "@nyte-ai/core";
import { localExec, localFiles } from "../src/index.ts";

export function localEnv(cwd: string): ExecutionEnv {
  return {
    identity: asId("test"),
    cwd,
    files: localFiles(cwd),
    exec: localExec(cwd),
    close: async () => undefined,
  };
}

export async function until<T>(
  source: AsyncIterable<T>,
  accept: (value: T) => boolean,
): Promise<T> {
  for await (const value of source) if (accept(value)) return value;

  throw new Error("The stream ended first.");
}

export async function serverProcesses(program: string): Promise<readonly number[]> {
  return execFileSync("ps", ["-A", "-o", "pid=,ppid=,command="], { encoding: "utf8" })
    .split("\n")
    .flatMap((line) => {
      const match = /^\s*(\d+)\s+(\d+)\s+(.*)$/.exec(line);

      return match !== null &&
        Number(match[2]) === process.pid &&
        (match[3] ?? "").includes(program)
        ? [Number(match[1])]
        : [];
    });
}
