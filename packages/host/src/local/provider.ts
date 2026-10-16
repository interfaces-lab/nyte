import { constants, realpathSync } from "node:fs";
import { access, readdir, realpath, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { isAbsolute, join, relative, sep } from "node:path";
import { asId, SdkError } from "@nyte-ai/schema";
import type { WorkspaceTarget } from "@nyte-ai/schema";
import type { EnvironmentProvider, ExecutionEnv } from "@nyte-ai/core";
import { sha256 } from "../hash.ts";
import { localFiles } from "./files.ts";
import { localGit } from "./git.ts";
import { folderIdentity } from "./identity.ts";
import { localExec } from "./jobs.ts";
import { localSnapshots } from "./snapshots.ts";

const PLUGIN_FILE = /\.(?:ts|mts|js|mjs)$/;

const ROOT_SOURCES = [".nyte/SYSTEM.md", ".nyte/APPEND_SYSTEM.md", ".nyte/mcp.json"];

/** Returns the local environment provider (`kind: "local"`): a folder on this machine. `inspect` answers a `{ kind: "local", path }` target's `folderIdentity` (§41d), `available` when the path is a readable directory (else `unavailable { unreachable }`; a target without a path `unavailable { unsupported }`, identified by the hash of its locator), and the project sources present under it, relative to it, in this order: the plugin files `.nyte/plugins/<name>.{ts,mts,js,mjs}` and `.nyte/plugins/<name>/index.<ext>`, the skills `.nyte/skills/<name>/SKILL.md` and `.agents/skills/<name>/SKILL.md`, the prompts `.nyte/prompts/<name>.md`, then `.nyte/SYSTEM.md`, `.nyte/APPEND_SYSTEM.md` and `.nyte/mcp.json`: the files project trust gates. Context files such as `AGENTS.md` load without trust and are not listed. `attach` resolves the real path (a target that is not a directory throws `SdkError("unavailable")`) and returns an `ExecutionEnv` with that identity, `cwd` the real path, `files` from `localFiles` (with `ripgrep` and `formatter`), `exec` from `localExec`, and a `close` that ends its file watches and the jobs' readers, leaving running jobs alone. `git` is `localGit` (with `git`), `snapshots` is `localSnapshots` storing tree walks under `<home>/.nyte/snapshots` (`home` default `os.homedir()`), and absent for a folder that contains `<home>/.nyte` or lies inside it (the home folder itself, its ancestors, Nyte's own state): there a snapshot would walk or stage everything under home, the store and secrets included, to report changes in the store it just wrote; no `browser` (the desktop wraps one in); `destroy` rejects with `SdkError("unavailable")`: a local folder is never torn down. */
export function localProvider(options?: {
  readonly home?: string;
  readonly git?: string;
  readonly ripgrep?: string;
  readonly formatter?: string;
  /** The login shell a pty job without a command runs, read at each start; null or absent is `$SHELL`. */
  readonly shell?: () => string | null;
}): EnvironmentProvider {
  const home = options?.home ?? homedir();
  const store = join(home, ".nyte", "snapshots");
  let state: string | undefined;

  return {
    kind: "local",
    async inspect(target) {
      const path = pathOf(target);

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
      const path = pathOf(target);

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
    snapshots(env) {
      state ??= join(realpathOrSelf(home), ".nyte");

      return nests(env.cwd, state) || nests(state, env.cwd)
        ? undefined
        : localSnapshots(env, { store, git: options?.git });
    },
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

function pathOf(target: WorkspaceTarget): string | null {
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

  const plugins = (
    await Promise.all(
      (await names(".nyte/plugins")).map(async (name) => {
        const path = `.nyte/plugins/${name}`;

        if (PLUGIN_FILE.test(name) && (await fileExists(path))) return [path];

        for (const index of ["index.ts", "index.mts", "index.js", "index.mjs"])
          if (await fileExists(`${path}/${index}`)) return [`${path}/${index}`];

        return [];
      }),
    )
  ).flat();

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

  const prompts = (await names(".nyte/prompts"))
    .filter((name) => name.endsWith(".md"))
    .map((name) => `.nyte/prompts/${name}`);

  const present = await Promise.all(
    ROOT_SOURCES.map(async (path) => ((await fileExists(path)) ? [path] : [])),
  );

  return [...plugins, ...skills, ...prompts, ...present.flat()];
}
