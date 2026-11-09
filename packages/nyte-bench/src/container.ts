import { execFile } from "node:child_process";
import { access, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import process from "node:process";
import { promisify } from "node:util";
import type { ExecutionEnv, Plugin } from "@nyte-ai/core";

const run = promisify(execFile);

/** Runs the docker CLI and returns its stdout. A failing command rejects with its stderr. */
export async function docker(args: readonly string[]): Promise<string> {
  const result = await run("docker", args, { maxBuffer: 64 * 1024 * 1024 });

  return result.stdout;
}

/**
 * Copies a task image's `/app` to `template` once, so each attempt can clone it instead of copying
 * the image again. This Mac's disk ignores case, so a repository with two paths that differ only
 * in case is refused rather than silently merged.
 */
export async function extractApp(image: string, template: string): Promise<void> {
  const found = await access(template).then(
    () => true,
    () => false,
  );

  if (found) return;
  const name = `nyte-deepswe-extract-${process.pid}-${Date.now()}`;
  await mkdir(dirname(template), { recursive: true });
  await docker(["create", "--platform", "linux/amd64", "--name", name, image]);

  try {
    await docker(["cp", "--quiet", `${name}:/app`, template]);
  } finally {
    await docker(["rm", "--force", name]);
  }

  const files = await run("git", ["-c", "safe.directory=*", "ls-files"], {
    cwd: template,
    maxBuffer: 256 * 1024 * 1024,
  });

  const lower = files.stdout.split("\n").map((path) => path.toLowerCase());

  if (new Set(lower).size !== lower.length)
    throw new Error(`${image} has paths that differ only in case, which this Mac's disk merges.`);
}

/** Clones `template` to `workspace` with APFS copy-on-write, which takes no time or space up front. */
export async function cloneApp(template: string, workspace: string): Promise<void> {
  await mkdir(dirname(workspace), { recursive: true });
  await run("/bin/cp", ["-cR", template, workspace]);
}

/**
 * Starts a task's image as a long-lived container with no network, the way DeepSWE runs its agent,
 * with `workspace` mounted at `/app` and at its own path, so a path the host's file tools use also
 * works in a command that runs inside. The mounted files belong to this Mac's user rather than the
 * container's root, so git inside trusts every directory.
 */
export async function startContainer(
  name: string,
  image: string,
  workspace: string,
): Promise<void> {
  await docker([
    "run",
    "--detach",
    "--name",
    name,
    "--platform",
    "linux/amd64",
    "--network",
    "none",
    "--cpus",
    "2",
    "--memory",
    "8g",
    "--volume",
    `${workspace}:/app`,
    "--volume",
    `${workspace}:${workspace}`,
    image,
    "sleep",
    "infinity",
  ]);
  await docker(["exec", name, "git", "config", "--system", "--add", "safe.directory", "*"]);
}

export async function removeContainer(name: string): Promise<void> {
  await docker(["rm", "--force", name]);
}

/**
 * Runs every command a session starts inside `container` instead of on this Mac, so the agent
 * builds and tests with the task image's toolchain. File reads and edits stay on the host and
 * reach the same files through the mount.
 */
export function containerExec(container: string): Plugin<"core"> {
  return {
    id: "deepswe-container",
    activate(api) {
      api.wrapEnv((inner) => ({
        identity: inner.identity,
        cwd: inner.cwd,
        files: inner.files,
        exec: (command, options) =>
          inner.exec(dockerExec(container, inner.cwd, command, options), {
            signal: options?.signal,
            pty: options?.pty,
            stdio: options?.stdio,
          }),
        close: () => inner.close(),
      }));
    },
  };
}

function dockerExec(
  container: string,
  root: string,
  command: string | readonly string[],
  options: Parameters<ExecutionEnv["exec"]>[1],
): readonly string[] {
  const flags = [
    "--interactive",
    ...(options?.pty === undefined ? [] : ["--tty"]),
    "--workdir",
    resolve(root, options?.cwd ?? "."),
    ...Object.entries(options?.env ?? {}).flatMap((entry) => ["--env", `${entry[0]}=${entry[1]}`]),
  ];

  const argv =
    typeof command === "string"
      ? ["bash", "-c", command]
      : command.length === 0
        ? ["bash", "-l"]
        : command;

  return ["docker", "exec", ...flags, container, ...argv];
}
