import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { isAbsolute } from "node:path";

const TIMEOUT_MS = 10_000;

const OUTPUT_LIMIT = 64 * 1024;

const SHELL_LOCAL = new Set(["PWD", "OLDPWD", "SHLVL", "_"]);

let shared: (() => Promise<void>) | undefined;

export function ensureShellEnvironment(): Promise<void> {
  shared ??= createShellEnvironmentRepair();

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
      // A startup script can leave descendants holding stdout open. Do not wait for them.
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
      const output = Buffer.concat(chunks).toString("utf8");
      const start = output.indexOf(fence);
      const end = output.indexOf(fence, start + fence.length);

      if (code !== 0 || start === -1 || end === -1) {
        finish(undefined);

        return;
      }

      finish(parseEnvironment(output.slice(start + fence.length, end)));
    });
  });
}

function parseEnvironment(output: string): Map<string, string> {
  const loaded = new Map<string, string>();

  for (const entry of output.split("\0")) {
    const separator = entry.indexOf("=");

    if (separator > 0) loaded.set(entry.slice(0, separator), entry.slice(separator + 1));
  }

  return loaded;
}
