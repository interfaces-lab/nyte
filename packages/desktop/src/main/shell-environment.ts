import { spawn } from "node:child_process";
import { randomUUID } from "node:crypto";
import { userInfo } from "node:os";
import { isAbsolute } from "node:path";

const TIMEOUT_MS = 3_000;

const OUTPUT_LIMIT = 64 * 1024;

let shared: (() => Promise<void>) | undefined;

/**
 * Shared across the process: a GUI launch inherits a minimal PATH, and every
 * spawned tool needs the login shell's one. Startup kicks this off and the
 * spawn sites await it, so no window waits on a user's shell profile.
 */
export function ensureShellEnvironment(): Promise<void> {
  shared ??= createShellEnvironmentRepair();

  return shared();
}

/** One attempt per startup, including concurrent callers and failed attempts. */
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
    attempt ??= (async () => {
      if (platform === "win32") return;

      try {
        const shell = env.SHELL || userInfo().shell || "/bin/sh";

        if (!isAbsolute(shell)) return;
        const inheritedPath = env.PATH;
        const path = await readLoginShellPath(shell, env, timeoutMs);

        if (path === undefined) return;
        // Keep launcher-provided tools available after the login shell's preferred tools.
        env.PATH = inheritedPath ? `${path}:${inheritedPath}` : path;
      } catch {
        // Environment recovery must never prevent startup or expose shell output.
      }
    })();

    return attempt;
  };
}

function readLoginShellPath(
  shell: string,
  env: NodeJS.ProcessEnv,
  timeoutMs: number,
): Promise<string | undefined> {
  return new Promise((resolve) => {
    const marker = `nyte-path-${randomUUID()}`;

    const child = spawn(shell, ["-ilc", `printf '\\000${marker}\\000%s\\000' "$PATH"`], {
      env,
      detached: true,
      stdio: ["ignore", "pipe", "ignore"],
    });

    const chunks: Buffer[] = [];
    let bytes = 0;
    let settled = false;

    const finish = (path: string | undefined): void => {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      // A startup script can leave descendants holding stdout open. Do not wait for them.
      child.stdout.destroy();

      if (child.pid !== undefined) {
        try {
          process.kill(-child.pid, "SIGKILL");
        } catch {
          // The shell's process group may already have exited.
        }
      }

      resolve(path);
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
      if (settled) return;

      if (code !== 0) {
        finish(undefined);

        return;
      }

      const output = Buffer.concat(chunks).toString("utf8");
      const prefix = `\0${marker}\0`;
      const start = output.indexOf(prefix);
      const end = output.indexOf("\0", start + prefix.length);

      if (start === -1 || end === -1) {
        finish(undefined);

        return;
      }

      const path = output.slice(start + prefix.length, end);
      finish(path === "" ? undefined : path);
    });
  });
}
