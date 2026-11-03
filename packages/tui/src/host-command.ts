import { serveHost } from "@nyte-ai/service/serve-host";
import type { HostListening } from "@nyte-ai/service/serve-host";
import { alignedRows, ansiEnabled, statusGlyph } from "./cli-style.ts";
import { HOST_WORKER } from "./host-thread.ts";

interface Output {
  readonly write: (text: string) => void;
}

/** Serves the store on 127.0.0.1 until `signal` aborts, publishing the URL and token in `host.json` for `nyte --host-url` to attach to. */
export async function hostCommand(
  args: readonly string[],
  signal: AbortSignal,
  output: Output,
): Promise<void> {
  if (new Set(args).size !== args.length || args.some((arg) => arg !== "--json" && arg !== "--log"))
    throw new Error("Usage: nyte host [--json] [--log]. Run `nyte host --help`.");

  const json = args.includes("--json");

  await serveHost({
    entry: HOST_WORKER,
    log: args.includes("--log"),
    signal,
    output,
    listening: (host) =>
      json ? `${JSON.stringify({ type: "listening", ...host })}\n` : listening(host),
  });
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
