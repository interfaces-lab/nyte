import { randomBytes } from "node:crypto";
import { appendFile, mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";
import process from "node:process";
import { alignedRows, ansiEnabled, statusGlyph } from "./cli-style.ts";
import { portConflict, probePort } from "@nyte-ai/service";
import {
  findRunningHost,
  hostFilePath,
  hostLogPath,
  hostSocketPath,
  publishHost,
  readHostAddress,
  saveHostAddress,
  withdrawHost,
} from "./host-endpoint.ts";
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
  if (new Set(args).size !== args.length || args.some((arg) => arg !== "--json" && arg !== "--log"))
    throw new Error("Usage: nyte host [--json] [--log]. Run `nyte host --help`.");

  const json = args.includes("--json");

  if (!args.includes("--log")) return serve(json, signal, output);
  const log = hostLogPath();
  await mkdir(dirname(log), { recursive: true, mode: 0o700 });

  const logged = {
    write: (text: string) => void appendFile(log, text, { mode: 0o600 }).catch(() => undefined),
  };

  try {
    await serve(json, signal, logged);
  } catch (cause) {
    await appendFile(
      log,
      `${new Date().toISOString()} ${cause instanceof Error ? cause.message : String(cause)}\n`,
      { mode: 0o600 },
    );

    throw cause;
  }
}

async function serve(json: boolean, signal: AbortSignal, output: Output): Promise<void> {
  const path = hostFilePath();
  const socket = process.platform === "win32" ? undefined : hostSocketPath();
  const running = await findRunningHost(path);

  if (running !== null) throw new Error(alreadyRunning(running, path));
  const addressPath = join(dirname(path), "host-address.json");
  const saved = await readHostAddress(addressPath);
  const token = saved?.token ?? randomBytes(32).toString("base64url");
  const conflict =
    saved === null ? undefined : portConflict(saved.port, await probePort(saved.port));

  const thread = await startHostThread({
    kind: "local",
    port: saved === null || conflict !== undefined ? 0 : saved.port,
    token,
    authority: OWN_TOKEN_AUTHORITY,
    socket,
  });

  const port = Number(new URL(thread.address).port);

  if (conflict !== undefined)
    process.stderr.write(
      `${conflict} Listening on port ${String(port)} instead; clients that knew the old address need ${thread.address}.\n`,
    );

  await saveHostAddress(addressPath, { port, token });

  try {
    const published = await publishHost(path, {
      url: thread.address,
      token,
      pid: process.pid,
      socket,
    });

    if (published.kind === "taken") throw new Error(alreadyRunning(published.by, path));

    try {
      output.write(
        json
          ? `${JSON.stringify({ type: "listening", url: thread.address, socket, endpoint: path, pid: process.pid })}\n`
          : listening(thread.address, path, socket),
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

function listening(url: string, path: string, socket: string | undefined): string {
  const color = ansiEnabled();

  const rows = alignedRows(
    [
      { label: "endpoint", detail: path },
      ...(socket === undefined ? [] : [{ label: "socket", detail: socket }]),
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
