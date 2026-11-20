import { constants, realpathSync } from "node:fs";
import { access, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { asId, SdkError } from "@nyte-ai/schema";
import type { WorkspaceTarget } from "@nyte-ai/schema";
import type { EnvironmentProvider, ExecutionEnv, SnapshotsApi } from "@nyte-ai/core";
import { sha256 } from "../hash.ts";
import { pluginFilesIn } from "../plugins/loader.ts";
import { localFiles } from "./files/files.ts";
import { localGit } from "./git/git.ts";
import { localGitHub } from "./git/github.ts";
import { localLanguage } from "./language/manager.ts";
import { folderIdentity } from "./identity.ts";
import { localExec } from "./process/jobs.ts";
import { localSnapshots } from "./snapshots/snapshots.ts";
import { localWorktrees } from "./git/worktrees.ts";

const ROOT_SOURCES = [".nyte/SYSTEM.md", ".nyte/APPEND_SYSTEM.md", ".nyte/mcp.json"];

export function localProvider(options?: {
  readonly home?: string;
  readonly git?: string;
  readonly gh?: string;
  readonly ripgrep?: string;
  readonly formatter?: string;
  /** Language servers pinned by program name, such as `{ gopls: "/opt/go/bin/gopls" }`; the rest are found on PATH. */
  readonly languageServers?: Readonly<Record<string, string>>;
  /** The login shell a pty job without a command runs, read at each start; null or absent is `$SHELL`. */
  readonly shell?: () => string | null;
}): EnvironmentProvider {
  const home = options?.home ?? homedir();
  const store = join(home, ".nyte", "snapshots");
  const shared = new Map<string, SnapshotsApi>();
  let state: string | undefined;
  const github = localGitHub({ gh: options?.gh, git: options?.git });

  return {
    kind: "local",
    async inspect(target) {
      const path = readTargetPath(target);

      if (path === null)
        return {
          identity: asId<"environment-identity">(sha256(JSON.stringify(target))),
          availability: { kind: "unavailable", reason: "unsupported" },
          projectSources: [],
        };

      const identity = await folderIdentity(path);

      if (!(await readableDirectory(path)))
        return {
          identity,
          availability: { kind: "unavailable", reason: "unreachable" },
          projectSources: [],
        };

      return {
        identity,
        availability: { kind: "available" },
        projectSources: await projectSources(path),
      };
    },
    async attach(target) {
      const path = readTargetPath(target);

      if (path === null) throw new SdkError("unavailable", "A local workspace needs a path.");
      const real = await realpath(path).catch(() => null);

      if (real === null || !(await readableDirectory(real)))
        throw new SdkError("unavailable", `${path} is not a readable directory.`);
      const detached = new AbortController();

      const env: ExecutionEnv = {
        identity: await folderIdentity(real),
        cwd: real,
        files: localFiles(real, {
          ripgrep: options?.ripgrep,
          formatter: options?.formatter,
          signal: detached.signal,
        }),
        exec: localExec(real, { shell: options?.shell, signal: detached.signal }),
        close: async () => detached.abort(),
      };

      return env;
    },
    git: (env) => localGit(env, { git: options?.git }),
    github,
    language: (env) => localLanguage(env, { servers: options?.languageServers }),
    snapshots(env) {
      state ??= join(realpathOrSelf(home), ".nyte");

      if (
        nests(env.cwd, state) ||
        (nests(state, env.cwd) && !nests(join(state, "worktrees"), env.cwd))
      )
        return undefined;
      const known = shared.get(env.cwd);

      if (known !== undefined) return known;
      const snapshots = localSnapshots(env.cwd, { store, git: options?.git });
      shared.set(env.cwd, snapshots);

      return snapshots;
    },
    worktrees: localWorktrees({ home, git: options?.git }),
    realpath: (env, path) =>
      realpath(isAbsolute(path) ? path : join(env.cwd, path)).catch(() => null),
    async destroy() {
      throw new SdkError("unavailable", "A local folder is never torn down.");
    },
  };
}

function realpathOrSelf(path: string): string {
  try {
    return realpathSync(path);
  } catch {
    return path;
  }
}

function nests(outer: string, inner: string): boolean {
  const path = relative(outer, inner);

  return path === "" || (path !== ".." && !path.startsWith(`..${sep}`) && !isAbsolute(path));
}

function readTargetPath(target: WorkspaceTarget): string | null {
  return "path" in target && typeof target.path === "string" ? target.path : null;
}

async function readableDirectory(path: string): Promise<boolean> {
  const stats = await stat(path).catch(() => null);

  return (
    stats !== null &&
    stats.isDirectory() &&
    (await access(path, constants.R_OK | constants.X_OK).then(
      () => true,
      () => false,
    ))
  );
}

async function projectSources(root: string): Promise<readonly string[]> {
  const names = async (directory: string): Promise<readonly string[]> =>
    (await readdir(join(root, directory)).catch(() => [])).sort((left, right) =>
      left < right ? -1 : left > right ? 1 : 0,
    );

  const fileExists = async (path: string): Promise<boolean> =>
    (await stat(join(root, path)).catch(() => null))?.isFile() === true;

  const plugins = (await pluginFilesIn(join(root, ".nyte", "plugins"))).map((path) =>
    relative(root, path).split(sep).join("/"),
  );

  const skills = (
    await Promise.all(
      [".nyte/skills", ".agents/skills"].map(async (directory) =>
        (
          await Promise.all(
            (await names(directory)).map(async (name) => {
              const path = `${directory}/${name}/SKILL.md`;

              return (await fileExists(path)) ? [path] : [];
            }),
          )
        ).flat(),
      ),
    )
  ).flat();

  const present = await Promise.all(
    ROOT_SOURCES.map(async (path) => ((await fileExists(path)) ? [path] : [])),
  );

  return [...plugins, ...skills, ...present.flat()];
}
