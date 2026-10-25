import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { Value } from "typebox/value";
import { findRunningHost, hostFilePath } from "../src/host-endpoint.ts";
import type { RunningHost } from "../src/host-endpoint.ts";
import { onEnding } from "../src/lifecycle.ts";

const TUI = fileURLToPath(new URL("..", import.meta.url));

const BINARY = process.env["NYTE_BINARY"] ?? join(homedir(), ".nyte", "bin", "nyte");

const HOST_STOP_MS = 12_000;

const ListeningType = Type.Object({ type: Type.Literal("listening"), pid: Type.Integer() });

interface Attached {
  readonly host: RunningHost;
  stop(): Promise<void>;
}

/**
 * Runs this worktree's TUI from source as a client of the installed binary's `nyte host`: the
 * one already running, else one started here and stopped when the TUI exits. The installed code
 * owns the store and the runs; this process only renders. A story (`NYTE_STORY`) needs no host,
 * so it runs from source without one.
 */
async function live(): Promise<number> {
  if (process.env["NYTE_STORY"] !== undefined) return fromSource([], {});

  const path = hostFilePath();
  const running = await findRunningHost(path);

  const attached: Attached =
    running === null ? await startHost(path) : { host: running, stop: async () => undefined };

  const { host } = attached;

  try {
    process.stderr.write(
      `${running === null ? "started" : "attaching to"} the Nyte host at ${host.url} (pid ${String(host.pid)})\n`,
    );

    return await fromSource(["--host-url", host.url], { NYTE_HOST_TOKEN: host.token });
  } finally {
    await attached.stop();
  }
}

/** Runs `src/index.ts` with `dev/preload.ts` like `pnpm dev:tui`, this command's arguments then `args`, and forwards the signals that end it. */
async function fromSource(
  args: readonly string[],
  env: Readonly<Record<string, string>>,
): Promise<number> {
  const tui = Bun.spawn(
    [
      process.execPath,
      "--preload",
      join(TUI, "dev", "preload.ts"),
      join(TUI, "src", "index.ts"),
      ...process.argv.slice(2),
      ...args,
    ],
    { env: { ...process.env, ...env }, stdio: ["inherit", "inherit", "inherit"] },
  );

  const stopForwarding = onEnding((ending) => tui.kill(ending));
  const status = await tui.exited;
  stopForwarding();

  return status;
}

async function startHost(path: string): Promise<Attached> {
  if (!(await Bun.file(BINARY).exists()))
    throw new Error(`No installed nyte at ${BINARY}. Run \`pnpm install:nyte\`, then retry.`);

  const probe = Bun.spawn([BINARY, "host", "--help"], {
    stdin: "ignore",
    stdout: "ignore",
    stderr: "ignore",
  });

  if ((await probe.exited) !== 0)
    throw new Error(
      `${BINARY} is too old to run \`nyte host\`. Run \`pnpm install:nyte\` or \`nyte update\`, then retry.`,
    );

  const child = Bun.spawn([BINARY, "host", "--json"], {
    stdin: "ignore",
    stdout: "pipe",
    stderr: "pipe",
  });

  const stderr = drain(child.stderr);
  const pid = await listeningPid(child.stdout);

  if (pid === null) {
    const status = await child.exited;

    throw new Error(
      `${BINARY} host exited with ${String(status)} before it listened.\n${(await stderr).trim()}`,
    );
  }

  const host = await findRunningHost(path);

  if (host === null || host.pid !== pid) {
    child.kill("SIGTERM");

    throw new Error(`${BINARY} host listened but ${path} doesn't name it.`);
  }

  return {
    host,
    async stop() {
      child.kill("SIGTERM");
      const timer = setTimeout(() => child.kill("SIGKILL"), HOST_STOP_MS);
      await child.exited;
      clearTimeout(timer);
    },
  };
}

/** Reads `stdout` to the host's `listening` line and returns its pid, or `null` if it closes first; the rest drains in the background. */
async function listeningPid(stdout: ReadableStream<Uint8Array>): Promise<number | null> {
  const reader = stdout.getReader();
  const decoder = new TextDecoder();
  let buffered = "";

  for (;;) {
    const read = await reader.read();

    if (read.done) return null;
    buffered += decoder.decode(read.value, { stream: true });
    const newline = buffered.indexOf("\n");

    if (newline < 0) continue;
    const text = buffered.slice(0, newline);

    void (async () => {
      while (!(await reader.read()).done);
    })();

    const line: unknown = JSON.parse(text);

    if (!Value.Check(ListeningType, line)) throw new Error(`${BINARY} host printed ${text}`);

    return line.pid;
  }
}

/** Keeps reading `stream` so the host never blocks on a full pipe, and returns its last 4 KB once it closes. */
async function drain(stream: ReadableStream<Uint8Array>): Promise<string> {
  const decoder = new TextDecoder();
  let tail = "";

  for await (const chunk of stream)
    tail = `${tail}${decoder.decode(chunk, { stream: true })}`.slice(-4_096);

  return tail;
}

try {
  process.exitCode = await live();
} catch (cause) {
  process.stderr.write(`error: ${cause instanceof Error ? cause.message : String(cause)}\n`);
  process.exitCode = 1;
}
