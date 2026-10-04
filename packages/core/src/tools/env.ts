import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { constants, homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { ToolReason } from "@nyte-ai/protocol";
import type { EnvOps, ExecutionEnv, FileInfo } from "../kernel/loop/env.ts";
import { ToolError, stopReason, toolResultContent } from "../kernel/loop/tool-result.ts";
import type { EnvironmentPlugin } from "../plugins/types.ts";
import {
  getShellConfig,
  getShellEnv,
  killProcessTree,
  trackDetachedChildPid,
  untrackDetachedChildPid,
  waitForChildProcess,
} from "./support/shell.ts";

const MAX_TIMEOUT_MS = 2_147_483_647;

const MAX_TIMEOUT_SECONDS = MAX_TIMEOUT_MS / 1000;

const MissingPath = Type.Object({
  code: Type.Union([Type.Literal("ENOENT"), Type.Literal("ENOTDIR")]),
});

/** Convert Git Bash, MSYS, Cygwin, and WSL drive paths to a form native Windows APIs accept. */
function windowsShellPath(filePath: string): string {
  if (!filePath.startsWith("/") || filePath.startsWith("//") || filePath.includes("\\"))
    return filePath;
  const match = filePath.match(/^\/(?:mnt\/|cygdrive\/)?([a-z])(?:\/(.*))?$/i);

  if (!match) return filePath;
  const suffix = match[2]?.replaceAll("/", "\\");

  return `${match[1].toUpperCase()}:\\${suffix ?? ""}`;
}

/** A path as a person types one here: `~`, `file://`, and Windows shell drive forms. */
function typedPath(input: string): string {
  const path = process.platform === "win32" ? windowsShellPath(input) : input;

  if (path === "~") return homedir();

  if (path.startsWith("~/") || (process.platform === "win32" && path.startsWith("~\\")))
    return join(homedir(), path.slice(2));

  return path.startsWith("file://") ? fileURLToPath(path) : path;
}

function resolveTimeoutMs(timeout: number | undefined): number | undefined {
  if (timeout === undefined) return undefined;

  if (!Number.isFinite(timeout) || timeout <= 0) {
    throw new Error("Invalid timeout: must be a finite number of seconds");
  }

  const timeoutMs = timeout * 1000;

  if (timeoutMs > MAX_TIMEOUT_MS) {
    throw new Error(`Invalid timeout: maximum is ${MAX_TIMEOUT_SECONDS} seconds`);
  }

  return timeoutMs;
}

/** A command stopped before it could exit: the status the model reads, and why. */
function stopped(status: string, reason: ToolReason): ToolError<undefined> {
  return new ToolError({ content: toolResultContent(status), details: undefined }, reason);
}

function aborted(signal: AbortSignal): ToolError<undefined> {
  const reason = stopReason(signal);

  return stopped(`Command ${reason.kind}`, reason);
}

async function missingAsUndefined<T>(read: Promise<T>): Promise<T | undefined> {
  try {
    return await read;
  } catch (error) {
    if (Value.Check(MissingPath, error)) return undefined;
    throw error;
  }
}

function fileInfo(stats: { isFile(): boolean; isDirectory(): boolean }): FileInfo {
  return { kind: stats.isFile() ? "file" : stats.isDirectory() ? "directory" : "other" };
}

export function createLocalExecutionEnv({
  id,
  cwd,
}: {
  readonly id: string;
  readonly cwd: string;
}): ExecutionEnv {
  return { id, cwd, ...localOps(cwd) };
}

/** Provides `local` workspaces: this machine's directories, as the environment `id`. */
export function localEnvironmentPlugin({ id }: { readonly id: string }): EnvironmentPlugin {
  return {
    id: "local-environment",
    environment: {
      kind: "local",
      open: async ({ cwd }) => {
        if (!isAbsolute(cwd)) throw new Error(`Workspace directory is not absolute: ${cwd}`);

        return createLocalExecutionEnv({ id, cwd });
      },
    },
    session: () => undefined,
  };
}

/** This machine's files and shell, at `cwd`. */
export function localOps(cwd: string): EnvOps {
  return {
    resolve: (first = ".", ...rest) => resolve(cwd, typedPath(first), ...rest),
    readFile: (path) => readFile(path),
    writeFile: (path, content) => writeFile(path, content, "utf-8"),
    mkdir: (path) => mkdir(path, { recursive: true }).then(() => undefined),
    stat: async (path) => {
      const stats = await missingAsUndefined(stat(path));

      return stats === undefined ? undefined : fileInfo(stats);
    },
    readdir: (path) => readdir(path),
    realpath: (path) => missingAsUndefined(realpath(path)),
    exec: async (command, { onData, signal, timeout }) => {
      const timeoutMs = resolveTimeoutMs(timeout);

      if (signal?.aborted) throw aborted(signal);
      const shellConfig = getShellConfig();

      if ((await missingAsUndefined(stat(cwd))) === undefined) {
        throw new Error(`Working directory does not exist: ${cwd}\nCannot execute bash commands.`);
      }

      const commandFromStdin = shellConfig.commandTransport === "stdin";

      const child = spawn(
        shellConfig.shell,
        commandFromStdin ? shellConfig.args : [...shellConfig.args, command],
        {
          cwd,
          detached: process.platform !== "win32",
          env: getShellEnv(),
          stdio: [commandFromStdin ? "pipe" : "ignore", "pipe", "pipe"],
          windowsHide: true,
        },
      );

      if (commandFromStdin) {
        child.stdin?.on("error", () => {});
        child.stdin?.end(command);
      }

      if (child.pid) trackDetachedChildPid(child.pid);
      let stop: ToolError<undefined> | undefined;
      let timeoutHandle: NodeJS.Timeout | undefined;

      const onAbort = () => {
        if (signal) stop ??= aborted(signal);

        if (child.pid) killProcessTree(child.pid);
      };

      try {
        if (timeoutMs !== undefined) {
          timeoutHandle = setTimeout(() => {
            stop ??= stopped(`Command timed out after ${timeout} seconds`, { kind: "timeout" });

            if (child.pid) killProcessTree(child.pid);
          }, timeoutMs);
        }

        child.stdout?.on("data", onData);
        child.stderr?.on("data", onData);

        if (signal) {
          if (signal.aborted) onAbort();
          else signal.addEventListener("abort", onAbort, { once: true });
        }

        // Wait without hanging on inherited stdio handles held by detached descendants.
        const exitCode = await waitForChildProcess(child);

        if (stop !== undefined) throw stop;
        // A signal-killed shell has no exit code. Use the shell convention so the
        // termination is not mistaken for success.
        const signalCode = child.signalCode;

        return {
          exitCode: exitCode ?? (signalCode ? 128 + (constants.signals[signalCode] ?? 0) : 1),
        };
      } finally {
        if (child.pid) untrackDetachedChildPid(child.pid);

        if (timeoutHandle) clearTimeout(timeoutHandle);

        if (signal) signal.removeEventListener("abort", onAbort);
      }
    },
  };
}
