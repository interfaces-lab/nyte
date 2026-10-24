import { randomBytes } from "node:crypto";
import process from "node:process";
import { alignedRows, ansiEnabled, statusGlyph } from "./cli-style.ts";
import { findRunningHost, hostFilePath, publishHost, withdrawHost } from "./host-endpoint.ts";
import type { RunningHost } from "./host-endpoint.ts";
import { OWN_TOKEN_AUTHORITY, startHostThread } from "./hosting.ts";

interface Output {
  readonly write: (text: string) => void;
}

/** Serves the store on 127.0.0.1 until `signal` aborts, publishing the URL and token in `host.json` for `nyte --host-url` to attach to. */
export async function hostCommand(
  args: readonly string[],
  signal: AbortSignal,
  output: Output,
): Promise<void> {
  if (args.length > 1 || args.some((arg) => arg !== "--json"))
    throw new Error("Usage: nyte host [--json]. Run `nyte host --help`.");

  const json = args[0] === "--json";
  const path = hostFilePath();
  const running = await findRunningHost(path);

  if (running !== null) throw new Error(alreadyRunning(running, path));
  const token = randomBytes(32).toString("base64url");

  const thread = await startHostThread({
    kind: "local",
    port: 0,
    token,
    authority: OWN_TOKEN_AUTHORITY,
  });

  try {
    const published = await publishHost(path, { url: thread.address, token, pid: process.pid });

    if (published.kind === "taken") throw new Error(alreadyRunning(published.by, path));

    try {
      output.write(
        json
          ? `${JSON.stringify({ type: "listening", url: thread.address, endpoint: path, pid: process.pid })}\n`
          : listening(thread.address, path),
      );

      const stopped = await Promise.race([
        aborted(signal).then(() => null),
        thread.ended.then(
          () => null,
          (cause: unknown) => (cause instanceof Error ? cause : new Error(String(cause))),
        ),
      ]);

      if (stopped !== null) throw new Error(`The host stopped: ${stopped.message}`);
    } finally {
      await withdrawHost(path, process.pid);
    }
  } finally {
    await thread.stop();
  }
}

function listening(url: string, path: string): string {
  const color = ansiEnabled();

  const rows = alignedRows(
    [
      { label: "endpoint", detail: path },
      { label: "stop", detail: "Ctrl+C" },
    ],
    color,
  );

  return `${[`${statusGlyph("ok", color)} Nyte host listening on ${url}`, ...rows].join("\n")}\n`;
}

function alreadyRunning(host: RunningHost, path: string): string {
  return `A Nyte host is already running at ${host.url} (pid ${String(host.pid)}, named in ${path}). Stop it first, or attach to it.`;
}

function aborted(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.resolve();

  return new Promise((resolve) =>
    signal.addEventListener("abort", () => resolve(), { once: true }),
  );
}
