import { spawn } from "node:child_process";
import type { ChildProcess, SpawnOptions } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, extname, isAbsolute, join } from "node:path";
import { SdkError } from "@nyte-ai/schema";
import { processEnvironment } from "@nyte-ai/core";

export type Ran = {
  readonly code: number | null;
  readonly stdout: Buffer;
  readonly stderr: string;
  readonly truncated: boolean;
};

export async function run(
  file: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env?: Readonly<Record<string, string>>;
    readonly input?: string | Uint8Array;
    readonly limit?: number;
    /** Kills the command after this long; it then ends with a null code. */
    readonly timeoutMs?: number;
  },
): Promise<Ran> {
  await processEnvironment();
  const resolved = process.platform === "win32" ? ((await findExecutable(file)) ?? file) : file;

  return new Promise((resolve, reject) => {
    const child = spawnCommand(resolved, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
      timeout: options.timeoutMs,
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const limit = options.limit ?? Number.POSITIVE_INFINITY;
    let size = 0;
    let truncated = false;

    child.on("error", (error) =>
      reject(new SdkError("unavailable", `Cannot run ${file}: ${error.message}`)),
    );
    child.stdout?.on("data", (chunk: Buffer) => {
      if (truncated) return;
      size += chunk.byteLength;

      if (size > limit) {
        truncated = true;
        stdout.push(chunk.subarray(0, chunk.byteLength - (size - limit)));
        child.kill("SIGKILL");

        return;
      }

      stdout.push(chunk);
    });
    child.stderr?.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.stdin?.on("error", () => undefined);
    child.on("close", (code) =>
      resolve({
        code,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr).toString("utf8"),
        truncated,
      }),
    );
    child.stdin?.end(options.input);
  });
}

/** Spawns `file` as `spawn` does, except that on Windows a `.cmd` or `.bat` file runs through `cmd.exe` with its arguments escaped, as Node no longer starts batch files without a shell. */
export function spawnCommand(
  file: string,
  args: readonly string[],
  options: SpawnOptions,
): ChildProcess {
  if (process.platform !== "win32" || !/\.(cmd|bat)$/i.test(file))
    return spawn(file, args, options);
  const shim = /node_modules[\\/]\.bin[\\/][^\\/]+\.cmd$/i.test(file);
  const line = [escapeCommand(file), ...args.map((arg) => escapeArgument(arg, shim))].join(" ");

  return spawn(process.env.ComSpec ?? "cmd.exe", ["/d", "/s", "/c", `"${line}"`], {
    ...options,
    windowsVerbatimArguments: true,
  });
}

/** Ends `child` with `signal`; on Windows, which has no signals, it ends the child's whole process tree with `taskkill /T /F`, as `kill` alone would leave what a batch file or a shell started running. */
export function killTree(child: ChildProcess, signal: NodeJS.Signals): void {
  if (process.platform !== "win32" || child.pid === undefined) {
    child.kill(signal);

    return;
  }

  spawn("taskkill", ["/pid", String(child.pid), "/T", "/F"], {
    stdio: "ignore",
    windowsHide: true,
  }).on("error", () => child.kill(signal));
}

const CMD_META = /([()\][%!^"`<>&|;, *?])/g;

function escapeCommand(command: string): string {
  return command.replace(CMD_META, "^$1");
}

function escapeArgument(argument: string, twice: boolean): string {
  const quoted = `"${argument.replace(/(\\*)"/g, '$1$1\\"').replace(/(\\*)$/, "$1$1")}"`;
  const escaped = quoted.replace(CMD_META, "^$1");

  return twice ? escaped.replace(CMD_META, "^$1") : escaped;
}

export async function findExecutable(
  name: string,
  directories: readonly string[] = [],
): Promise<string | null> {
  const pathext = (process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";").filter((ext) => ext !== "");

  const extensions =
    process.platform !== "win32" ? [""] : extname(name) === "" ? pathext : ["", ...pathext];

  if (isAbsolute(name)) {
    for (const extension of extensions)
      if (await executable(`${name}${extension}`)) return `${name}${extension}`;

    return null;
  }

  await processEnvironment();
  const path = (process.env.PATH ?? "").split(delimiter).filter((entry) => entry !== "");

  for (const directory of [...directories, ...path])
    for (const extension of extensions) {
      const candidate = join(directory, `${name}${extension}`);

      if (await executable(candidate)) return candidate;
    }

  return null;
}

async function executable(path: string): Promise<boolean> {
  const found = await stat(path).catch(() => null);

  return (
    found !== null &&
    found.isFile() &&
    (await access(path, constants.X_OK).then(
      () => true,
      () => false,
    ))
  );
}
