import process from "node:process";
import { HOST_TAKEN_EXIT, hostFilePath, hostLockPath } from "@nyte-ai/service/host-endpoint";
import type { RunningHost } from "@nyte-ai/service/host-endpoint";
import { serveHost } from "@nyte-ai/service/serve-host";
import type { HostListening } from "@nyte-ai/service/serve-host";
import { alignedRows, ansiEnabled, statusGlyph } from "./cli-style.ts";
import { HOST_WORKER } from "./host-thread.ts";

interface Output {
  readonly write: (text: string) => void;
}

/** Serves the store on 127.0.0.1 until `signal` aborts, publishing the URL and token in `host.json` for `nyte --host-url` to attach to. Returns the exit status: `HOST_TAKEN_EXIT` when another host already serves this home. */
export async function hostCommand(
  args: readonly string[],
  signal: AbortSignal,
  output: Output,
): Promise<number> {
  if (new Set(args).size !== args.length || args.some((arg) => arg !== "--json" && arg !== "--log"))
    throw new Error("Usage: nyte host [--json] [--log]. Run `nyte host --help`.");

  const json = args.includes("--json");

  const served = await serveHost({
    entry: HOST_WORKER,
    log: args.includes("--log"),
    whenTaken: "exit",
    signal,
    output,
    listening: (host) =>
      json ? `${JSON.stringify({ type: "listening", ...host })}\n` : listening(host),
  });

  if (served.kind === "stopped") return 0;
  process.stderr.write(`${alreadyRunning(served.by)}\n`);

  return HOST_TAKEN_EXIT;
}

function alreadyRunning(host: RunningHost | null): string {
  const holder =
    host === null
      ? `is already starting (it holds ${hostLockPath()})`
      : `is already running at ${host.url} (pid ${String(host.pid)}, named in ${hostFilePath()})`;

  return `A Nyte host ${holder}. Stop it first, or attach to it.`;
}

function listening(host: HostListening): string {
  const color = ansiEnabled();

  const rows = alignedRows(
    [
      { label: "endpoint", detail: host.endpoint },
      ...(host.socket === undefined ? [] : [{ label: "socket", detail: host.socket }]),
      { label: "stop", detail: "Ctrl+C" },
    ],
    color,
  );

  return `${[`${statusGlyph("ok", color)} Nyte host listening on ${host.url}`, ...rows].join("\n")}\n`;
}
