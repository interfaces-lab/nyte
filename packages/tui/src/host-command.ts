import { hostFilePath, hostLockPath, hostLogPath } from "@nyte-ai/service/host-endpoint";
import type { RunningHost } from "@nyte-ai/service/host-endpoint";
import { serveHost } from "@nyte-ai/service/serve-host";
import type { HostListening } from "@nyte-ai/service/serve-host";
import { CliError } from "./cli/errors.ts";
import type { Output } from "./cli/output.ts";
import { HOST_WORKER } from "./host-thread.ts";

/**
 * Serves the store on 127.0.0.1 until `signal` aborts, publishing the URL and token in `host.json`
 * for clients to attach to. stdout gets the URL, or with `--json` one listening line; where it
 * listens goes to stderr. With `--log` the listening line goes to the host log instead of stdout.
 * Throws a `conflict` when another host already serves this home.
 */
export async function hostCommand(
  args: readonly string[],
  signal: AbortSignal,
  output: Output,
): Promise<number> {
  const options = parseHostArgs(args);

  const served = await serveHost({
    entry: HOST_WORKER,
    log: options.log,
    whenTaken: "exit",
    signal,
    output: { write: (text) => output.result(text) },
    listening: (host) => {
      describe(host, options.log, output);

      if (options.json) return `${JSON.stringify({ type: "listening", ...host })}\n`;

      return options.log
        ? `${new Date().toISOString()} Listening on ${host.url}\n`
        : `${host.url}\n`;
    },
  });

  if (served.kind === "taken") throw taken(served.by);
  output.status("none", `Stopped the host and removed ${hostFilePath()}.`);

  return 0;
}

function parseHostArgs(args: readonly string[]) {
  const help = { next: [{ label: "See the options", argv: ["nyte", "host", "--help"] }] };

  for (const arg of args) {
    if (arg === "--json" || arg === "--log") continue;

    if (arg.startsWith("-"))
      throw new CliError("unknown_option", `Unknown option ${arg} for nyte host.`, help);

    throw new CliError("invalid_arguments", "nyte host takes no arguments.", help);
  }

  return { json: args.includes("--json"), log: args.includes("--log") };
}

function describe(host: HostListening, log: boolean, output: Output): void {
  output.rows([
    { gutter: "done", label: "Listening", value: host.url },
    { label: "Host file", value: host.endpoint },
    ...(host.socket === undefined ? [] : [{ label: "Socket", value: host.socket }]),
    ...(log ? [{ label: "Log", value: hostLogPath() }] : []),
    ...(output.mode.interactive ? [{ label: "Stop", value: "Ctrl+C" }] : []),
  ]);
}

function taken(host: RunningHost | null): CliError {
  if (host === null)
    return new CliError("conflict", "Can't start a host. Another one is starting in this home.", {
      details: [{ label: "Lock", value: hostLockPath() }],
      next: [{ label: "Attach to it once it listens", argv: ["nyte"] }],
    });

  return new CliError(
    "conflict",
    `Can't start a host. Process ${String(host.pid)} already serves this home at ${host.url}.`,
    {
      next: [
        { label: "Attach to it", argv: ["nyte"] },
        { label: "Stop it", argv: ["kill", String(host.pid)] },
      ],
    },
  );
}
