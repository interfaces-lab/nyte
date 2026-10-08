import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { sanitizedGitEnv } from "../../host/src/tree-snapshot.ts";

const execute = promisify(execFile);

export async function gitOutput(cwd: string, args: readonly string[]): Promise<string> {
  const result = await execute(
    "git",
    [
      "--literal-pathspecs",
      "-c",
      "core.fsmonitor=false",
      "-c",
      "diff.external=",
      "-c",
      "core.pager=cat",
      "-c",
      "core.hooksPath=/dev/null",
      "-c",
      "core.quotepath=false",
      ...args,
    ],
    {
      cwd,
      env: sanitizedGitEnv(),
      encoding: "utf8",
      maxBuffer: 128 * 1024 * 1024,
    },
  );

  return result.stdout;
}
