import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { holdProcessEnvironment } from "@nyte-ai/core/server";

const TIMEOUT_MS = 10_000;

const OUTPUT_LIMIT = 64 * 1024;

const SHELL_LOCAL = new Set(["PWD", "OLDPWD", "SHLVL", "_"]);

const RETRY_DELAYS_MS = [30_000, 120_000, 600_000, 3_600_000];

type ShellRead =
  | { readonly kind: "loaded"; readonly environment: Map<string, string> }
  | { readonly kind: "failed"; readonly reason: string };

let shared: (() => Promise<void>) | undefined;

/**
 * Starts reading the login shell's environment into `process.env`, once per process, and holds
 * every child spawn and provider auth env read (`processEnvironment()`) until it lands. The
 * process itself goes on: a desktop app opened from the Dock inherits launchd's bare PATH and
 * none of the rc files' API keys, and only what it spawns and what auth reads need the shell's.
 * The read gives up after 10 s and keeps the inherited environment. A failed read is logged and
 * tried again in the background, without holding anything, so a host started while the machine
 * was waking or updating still gets the shell's environment.
 */
export function completeShellEnvironment(): Promise<void> {
  if (shared === undefined) {
    shared = createShellEnvironmentRepair();
    holdProcessEnvironment(shared());
  }

  return shared();
}

export function createShellEnvironmentRepair({
  env = process.env,
  platform = process.platform,
  timeoutMs = TIMEOUT_MS,
}: {
  env?: NodeJS.ProcessEnv;
  platform?: NodeJS.Platform;
  timeoutMs?: number;
} = {}): () => Promise<void> {
  let attempt: Promise<void> | undefined;

  const repair = async (retries: readonly number[]): Promise<void> => {
    const failure = await repairShellEnvironment({ env, platform, timeoutMs });

    if (failure === undefined) return;
    const [delay, ...later] = retries;

    if (delay === undefined) {
      process.stderr.write(
        `Couldn't read the login shell's environment: ${failure}. Commands keep the environment the host started with.\n`,
      );

      return;
    }

    process.stderr.write(
      `Couldn't read the login shell's environment: ${failure}. Trying again in ${String(delay / 1000)} s.\n`,
    );
    setTimeout(() => void repair(later), delay).unref();
  };

  return () => {
    attempt ??= repair(RETRY_DELAYS_MS);

    return attempt;
  };
}

async function repairShellEnvironment({
  env,
  platform,
  timeoutMs,
}: {
  env: NodeJS.ProcessEnv;
  platform: NodeJS.Platform;
  timeoutMs: number;
}): Promise<string | undefined> {
  const shell = env.SHELL || "/bin/sh";

  if (platform === "win32" || !isAbsolute(shell)) return undefined;
  const inheritedPath = env.PATH;
  const read = await readLoginShellEnvironment({ shell, env, timeoutMs });

  if (read.kind === "failed") return `${shell} ${read.reason}`;

  for (const [name, value] of read.environment) {
    if (name !== "PATH" && !SHELL_LOCAL.has(name)) env[name] = value;
  }

  const path = read.environment.get("PATH");

  if (path === undefined || path === "") return undefined;
  env.PATH = inheritedPath ? `${path}:${inheritedPath}` : path;

  return undefined;
}

function readLoginShellEnvironment({
  shell,
  env,
  timeoutMs,
}: {
  shell: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}): Promise<ShellRead> {
  return new Promise((resolve) => {
    const marker = `nyte-env-${randomUUID()}`;
    const fence = `\0${marker}\0`;
    const printFence = `printf '\\000${marker}\\000'`;

    const child = spawn(shell, ["-ilc", `${printFence}; /usr/bin/env -0; ${printFence}`], {
      env,
      detached: true,
      stdio: ["ignore", "pipe", "ignore"],
    });

    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;

    const finish = (read: ShellRead): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.destroy();

      resolve(read);
    };

    const fail = (reason: string): void => finish({ kind: "failed", reason });

    const abandon = (reason: string): void => {
      try {
        if (child.pid === undefined) child.kill("SIGKILL");
        else process.kill(-child.pid, "SIGKILL");
      } catch {}

      fail(reason);
    };

    const timer = setTimeout(
      () => abandon(`timed out after ${String(timeoutMs / 1000)} s`),
      timeoutMs,
    );

    child.on("error", (error) => fail(`couldn't start: ${error.message}`));
    child.stdout.on("error", (error) => abandon(`stdout failed: ${error.message}`));
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.byteLength;

      if (bytes > OUTPUT_LIMIT) {
        abandon(`printed more than ${String(OUTPUT_LIMIT / 1024)} KiB`);

        return;
      }

      chunks.push(chunk);
    });
    child.on("close", (code, signal) => {
      const [, fenced, ...after] = Buffer.concat(chunks).toString("utf8").split(fence);

      if (code !== 0) {
        fail(signal === null ? `exited with code ${String(code)}` : `was killed by ${signal}`);

        return;
      }

      if (fenced === undefined || after.length === 0) {
        fail("printed no complete environment");

        return;
      }

      finish({ kind: "loaded", environment: parseEnvironment(fenced) });
    });
  });
}

function parseEnvironment(output: string): Map<string, string> {
  const loaded = new Map<string, string>();

  for (const entry of output.split("\0")) {
    const [name = "", ...value] = entry.split("=");

    if (name !== "" && value.length > 0) loaded.set(name, value.join("="));
  }

  return loaded;
}
