import { spawn } from "node:child_process";
import { constants } from "node:fs";
import { access, stat } from "node:fs/promises";
import { delimiter, isAbsolute, join } from "node:path";
import { SdkError } from "@nyte-ai/core";

export type Ran = {
  readonly code: number | null;
  readonly stdout: Buffer;
  readonly stderr: string;
  readonly truncated: boolean;
};

export function run(
  file: string,
  args: readonly string[],
  options: {
    readonly cwd: string;
    readonly env?: Readonly<Record<string, string>>;
    readonly input?: string | Uint8Array;
    readonly limit?: number;
  },
): Promise<Ran> {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, {
      cwd: options.cwd,
      env: { ...process.env, ...options.env },
      stdio: ["pipe", "pipe", "pipe"],
      windowsHide: true,
    });

    const stdout: Buffer[] = [];
    const stderr: Buffer[] = [];
    const limit = options.limit ?? Number.POSITIVE_INFINITY;
    let size = 0;
    let truncated = false;

    child.on("error", (error) =>
      reject(new SdkError("unavailable", `Cannot run ${file}: ${error.message}`)),
    );
    child.stdout.on("data", (chunk: Buffer) => {
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
    child.stderr.on("data", (chunk: Buffer) => stderr.push(chunk));
    child.stdin.on("error", () => undefined);
    child.on("close", (code) =>
      resolve({
        code,
        stdout: Buffer.concat(stdout),
        stderr: Buffer.concat(stderr).toString("utf8"),
        truncated,
      }),
    );
    child.stdin.end(options.input);
  });
}

export async function findExecutable(
  name: string,
  directories: readonly string[] = [],
): Promise<string | null> {
  if (isAbsolute(name)) return (await executable(name)) ? name : null;
  const path = (process.env.PATH ?? "").split(delimiter).filter((entry) => entry !== "");

  const extensions =
    process.platform === "win32"
      ? ["", ...(process.env.PATHEXT ?? ".EXE;.CMD;.BAT").split(";")]
      : [""];

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
