import { spawn } from "node:child_process";
import { mkdir, readFile, readdir, realpath, stat, writeFile } from "node:fs/promises";
import { constants, hostname } from "node:os";
import { Type } from "typebox";
import type { TSchema } from "typebox";
import { Value } from "typebox/value";
import type { ToolReason } from "@nyte-ai/protocol";
import type { ExecutionEnv, FileInfo } from "../kernel/loop/env.ts";
import { ToolError, stopReason, toolResultContent } from "../kernel/loop/tool-result.ts";
import type { AgentTool, ToolCall, ToolDefinition } from "../kernel/loop/types.ts";
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

/** The call's environment; a tool that reaches files or processes without one fails. */
export function requireEnv(call: Pick<ToolCall, "env">): ExecutionEnv {
  if (call.env === undefined) throw new Error("Tool call has no execution environment");

  return call.env;
}

/** The tool with `env` on every call it executes. */
export function withExecutionEnv<P extends TSchema, D>(
  tool: AgentTool<P, D>,
  env: ExecutionEnv,
): AgentTool<P, D>;
export function withExecutionEnv<P extends TSchema, D>(
  tool: ToolDefinition<P, D>,
  env: ExecutionEnv,
): ToolDefinition<P, D>;
export function withExecutionEnv<P extends TSchema, D>(
  tool: ToolDefinition<P, D>,
  env: ExecutionEnv,
): ToolDefinition<P, D> {
  return { ...tool, execute: (input, call) => tool.execute(input, { ...call, env }) };
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

export interface LocalExecutionEnvOptions {
  readonly cwd: string;
  /** An explicit shell; default: bash as `getShellConfig` finds it. */
  readonly shellPath?: string;
}

/** This machine's filesystem and shell, at `cwd`. */
export function createLocalExecutionEnv(options: LocalExecutionEnvOptions): ExecutionEnv {
  const { cwd, shellPath } = options;

  return {
    fs: `local:${hostname()}`,
    cwd,
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
      const shellConfig = getShellConfig(shellPath);

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
