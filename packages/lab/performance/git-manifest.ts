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

export async function readGitManifest(cwd: string, oid: string) {
  const output = await gitOutput(cwd, [
    "diff-tree",
    "-r",
    "--root",
    "--no-commit-id",
    "--name-status",
    "--find-renames",
    "--no-ext-diff",
    "--no-textconv",
    "-z",
    oid,
  ]);

  const records = output.split("\0");
  const files: { readonly path: string; readonly status: "modified" }[] = [];

  if (records.pop() !== "" || records.length % 2 !== 0) {
    throw new Error("Expected NUL-delimited name/status pairs");
  }

  for (let index = 0; index < records.length; index += 2) {
    const status = records[index];
    const path = records[index + 1];

    if (status !== "M" || path === undefined || path === "") {
      throw new Error("This fixture manifest supports modified files only");
    }

    files.push({ path, status: "modified" });
  }

  return {
    manifest: { scope: { kind: "commit" as const, oid }, files },
    discoveryBytes: Buffer.byteLength(output),
  };
}
