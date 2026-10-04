import { isAbsolute, resolve } from "node:path/posix";
import { ToolError, stopReason, toolResultContent } from "@nyte-ai/core/plugins";
import type { EnvironmentPlugin, ExecutionEnv, FileInfo, Workspace } from "@nyte-ai/core/plugins";

export interface VercelSandboxCommand {
  logs(): AsyncIterable<{ stream: "stdout" | "stderr"; data: string }>;
  wait(): Promise<{ exitCode: number }>;
  kill(signal?: "SIGKILL"): Promise<void>;
}

export interface VercelSandbox {
  readonly fs: {
    mkdir(path: string, options: { recursive: true }): Promise<unknown>;
  };
  readFileToBuffer(file: { path: string }): Promise<Buffer | null>;
  writeFiles(files: { path: string; content: Buffer }[]): Promise<unknown>;
  runCommand(params: {
    cmd: string;
    args: string[];
    cwd: string;
    detached: true;
    timeoutMs?: number | undefined;
  }): Promise<VercelSandboxCommand>;
}

export interface VercelSandboxOptions {
  /**
   * The Sandbox the application owns for `workspace`, reconnected from its `locator`. Called for
   * every operation, so memoize it; reject when the Sandbox cannot reach the files `id` names.
   */
  readonly connect: (workspace: Workspace) => Promise<VercelSandbox>;
}

const STAT_SCRIPT =
  'if [ -f "$1" ]; then echo file; elif [ -d "$1" ]; then echo directory; elif [ -e "$1" ]; then echo other; fi';

const READDIR_SCRIPT = `find -H "$1" -mindepth 1 -maxdepth 1 -printf '%f\\0'`;

const REALPATH_SCRIPT = 'if [ -e "$1" ]; then realpath -e -- "$1"; fi';

function resolveTimeoutMs(timeout: number | undefined): number | undefined {
  if (timeout === undefined) return undefined;

  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error("Invalid timeout: must be a finite number of seconds");
  }

  return timeout * 1000;
}

function aborted(signal: AbortSignal): ToolError<undefined> {
  const reason = stopReason(signal);

  return new ToolError(
    { content: toolResultContent(`Command ${reason.kind}`), details: undefined },
    reason,
  );
}

/** Provides `vercel-sandbox` workspaces under the `id` the host assigned them. */
export function vercelSandboxPlugin({ connect }: VercelSandboxOptions): EnvironmentPlugin {
  return {
    id: "vercel-sandbox",
    environment: {
      kind: "vercel-sandbox",
      open: async (workspace) => {
        if (!isAbsolute(workspace.cwd))
          throw new Error(`Workspace directory is not absolute: ${workspace.cwd}`);

        return sandboxEnv(() => connect(workspace), workspace);
      },
    },
    session: () => undefined,
  };
}

function sandboxEnv(connect: () => Promise<VercelSandbox>, { id, cwd }: Workspace): ExecutionEnv {
  const at = (...paths: string[]) => resolve(cwd, ...paths);

  /** Runs `script` with `path` as `$1`, returning its stdout; a non-zero exit throws its stderr. */
  const sh = async (script: string, path: string): Promise<string> => {
    const sandbox = await connect();

    const command = await sandbox.runCommand({
      cmd: "/bin/sh",
      args: ["-c", script, "sh", at(path)],
      cwd: "/",
      detached: true,
    });

    const output = { stdout: "", stderr: "" };

    const [, { exitCode }] = await Promise.all([
      (async () => {
        for await (const log of command.logs()) output[log.stream] += log.data;
      })(),
      command.wait(),
    ]);

    if (exitCode !== 0) throw new Error(output.stderr.trim() || `sh exited with ${exitCode}`);

    return output.stdout;
  };

  return {
    id,
    cwd,
    resolve: at,
    readFile: async (path) => {
      const content = await (await connect()).readFileToBuffer({ path: at(path) });

      if (content === null)
        throw new Error(`ENOENT: no such file or directory, open '${at(path)}'`);

      return content;
    },
    writeFile: async (path, content) => {
      const sandbox = await connect();

      await sandbox.writeFiles([{ path: at(path), content: Buffer.from(content, "utf-8") }]);
    },
    mkdir: async (path) => {
      await (await connect()).fs.mkdir(at(path), { recursive: true });
    },
    stat: async (path): Promise<FileInfo | undefined> => {
      const kind = (await sh(STAT_SCRIPT, path)).trim();

      if (kind === "") return undefined;

      return { kind: kind === "file" || kind === "directory" ? kind : "other" };
    },
    readdir: async (path) => (await sh(READDIR_SCRIPT, path)).split("\0").slice(0, -1),
    realpath: async (path) => {
      const real = await sh(REALPATH_SCRIPT, path);

      return real === "" ? undefined : real.replace(/\n$/, "");
    },
    exec: async (command, { onData, signal, timeout }) => {
      const timeoutMs = resolveTimeoutMs(timeout);

      if (signal?.aborted) throw aborted(signal);
      const sandbox = await connect();

      if (signal?.aborted) throw aborted(signal);
      const started = Date.now();

      const running = await sandbox.runCommand({
        cmd: "/bin/bash",
        args: ["-lc", command],
        cwd,
        detached: true,
        timeoutMs,
      });

      const kill = () => void running.kill("SIGKILL").catch(() => undefined);

      signal?.addEventListener("abort", kill, { once: true });

      if (signal?.aborted) kill();

      try {
        const [, { exitCode }] = await Promise.all([
          (async () => {
            for await (const log of running.logs()) onData(Buffer.from(log.data));
          })(),
          running.wait(),
        ]);

        if (signal?.aborted) throw aborted(signal);

        if (timeoutMs !== undefined && exitCode === 137 && Date.now() - started >= timeoutMs) {
          throw new ToolError(
            {
              content: toolResultContent(`Command timed out after ${timeout} seconds`),
              details: undefined,
            },
            { kind: "timeout" },
          );
        }

        return { exitCode };
      } finally {
        signal?.removeEventListener("abort", kill);
      }
    },
  };
}
