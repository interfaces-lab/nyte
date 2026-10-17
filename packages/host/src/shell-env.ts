import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";
import { holdProcessEnvironment } from "@nyte-ai/core/server";

const TIMEOUT_MS = 10_000;

const OUTPUT_LIMIT = 64 * 1024;

const SHELL_LOCAL = new Set(["PWD", "OLDPWD", "SHLVL", "_"]);

let shared: (() => Promise<void>) | undefined;

/**
 * Starts reading the login shell's environment into `process.env`, once per process, and holds
 * every child spawn and provider auth env read (`processEnvironment()`) until it lands. The
 * process itself goes on: a desktop app opened from the Dock inherits launchd's bare PATH and
 * none of the rc files' API keys, and only what it spawns and what auth reads need the shell's.
 * The read gives up after 10 s and keeps the inherited environment.
 */
export function completeShellEnvironment(): Promise<void> {
  if (shared === undefined) {
    shared = createShellEnvironmentRepair();
    holdProcessEnvironment(shared());
  }

  return shared();
}

/** Returns a repair that merges the login shell's environment into `env` on its first call; later calls share that attempt. */
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

  return () => {
    attempt ??= repairShellEnvironment({ env, platform, timeoutMs });

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
}): Promise<void> {
  const shell = env.SHELL || "/bin/sh";

  if (platform === "win32" || !isAbsolute(shell)) return;
  const inheritedPath = env.PATH;
  const loaded = await readLoginShellEnvironment({ shell, env, timeoutMs });

  if (loaded === undefined) return;

  for (const [name, value] of loaded) {
    if (name !== "PATH" && !SHELL_LOCAL.has(name)) env[name] = value;
  }

  const path = loaded.get("PATH");

  if (path === undefined || path === "") return;
  env.PATH = inheritedPath ? `${path}:${inheritedPath}` : path;
}

/**
 * Runs `shell -ilc` and reads the environment it prints between two random fences. It settles
 * at the first of exit, the timeout or 64 KiB of output, and kills the shell then without
 * waiting for descendants a startup script left holding stdout open.
 */
function readLoginShellEnvironment({
  shell,
  env,
  timeoutMs,
}: {
  shell: string;
  env: NodeJS.ProcessEnv;
  timeoutMs: number;
}): Promise<Map<string, string> | undefined> {
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

    const finish = (loaded: Map<string, string> | undefined): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      child.stdout.destroy();
      child.kill("SIGKILL");

      resolve(loaded);
    };

    const timer = setTimeout(() => finish(undefined), timeoutMs);
    child.on("error", () => finish(undefined));
    child.stdout.on("error", () => finish(undefined));
    child.stdout.on("data", (chunk: Buffer) => {
      bytes += chunk.byteLength;

      if (bytes > OUTPUT_LIMIT) {
        finish(undefined);

        return;
      }

      chunks.push(chunk);
    });
    child.on("close", (code) => {
      const [, fenced, ...after] = Buffer.concat(chunks).toString("utf8").split(fence);

      if (code !== 0 || fenced === undefined || after.length === 0) {
        finish(undefined);

        return;
      }

      finish(parseEnvironment(fenced));
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
