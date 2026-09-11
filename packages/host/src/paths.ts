import { createHash, randomUUID } from "node:crypto";
import { access, link, mkdir, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve, sep } from "node:path";
import process from "node:process";
import { DatabaseSync } from "node:sqlite";
import type { PluginDirectory, TrustedWorkspace, WatchTarget } from "@nyte-ai/core";

export type PluginTarget =
  | { readonly kind: "home" }
  | { readonly kind: "project"; readonly workspace: TrustedWorkspace };

export function nyteHome(): string {
  return resolve(process.env.NYTE_HOME ?? join(homedir(), ".nyte"));
}

export function pluginDirectories(target: PluginTarget): PluginDirectory[] {
  const user: PluginDirectory = { path: join(nyteHome(), "plugins"), source: "user" };
  switch (target.kind) {
    case "home":
      return [user];
    case "project":
      return [user, { path: join(target.workspace.cwd, ".nyte", "plugins"), source: "project" }];
    default: {
      const _exhaustive: never = target;
      return _exhaustive;
    }
  }
}

const MANIFEST_NAME = "nyte.json";

/** User first, project last: a later file's entries win where they overlap. */
export function manifestPaths(target: PluginTarget): string[] {
  const user = join(nyteHome(), MANIFEST_NAME);
  switch (target.kind) {
    case "home":
      return [user];
    case "project":
      return [user, join(target.workspace.cwd, ".nyte", MANIFEST_NAME)];
    default: {
      const _exhaustive: never = target;
      return _exhaustive;
    }
  }
}

/**
 * Everything plugin resolution reads from, as watch targets: plugin and skill
 * directories whole, and the manifests through their parent directory (an
 * editor that saves by rename replaces the inode a direct file watch holds).
 * The home directory holds stores that churn, so only its manifest counts.
 */
export function pluginWatchTargets(target: PluginTarget): WatchTarget[] {
  const deep = [
    ...new Set([
      ...(target.kind === "project" ? [join(target.workspace.cwd, ".nyte")] : []),
      ...pluginDirectories(target).map((directory) => directory.path),
      ...skillDirectories(target),
    ]),
  ];
  return [
    { path: nyteHome(), recursive: false, names: [MANIFEST_NAME] },
    ...deep
      .filter((path) => !deep.some((other) => path.startsWith(other + sep)))
      .map((path) => ({ path, recursive: true })),
  ];
}

export function skillDirectories(target: PluginTarget): string[] {
  const user = [
    join(nyteHome(), "skills"),
    join(homedir(), ".agents", "skills"),
    join(homedir(), ".claude", "skills"),
  ];
  switch (target.kind) {
    case "home":
      return user;
    case "project":
      return [
        join(target.workspace.cwd, ".nyte", "skills"),
        join(target.workspace.cwd, ".agents", "skills"),
        join(target.workspace.cwd, ".claude", "skills"),
        ...user,
      ];
    default: {
      const _exhaustive: never = target;
      return _exhaustive;
    }
  }
}

function errnoCode(cause: unknown): string | undefined {
  return cause instanceof Error && "code" in cause && typeof cause.code === "string"
    ? cause.code
    : undefined;
}

/**
 * Every client opens one store per workspace, kept under the home directory so
 * history outlives the project and never lands in its tree. A store still
 * sitting at the project's old `.nyte/sessions.db` is copied in once.
 */
export async function workspaceStorePath(cwd: string): Promise<string> {
  const key = createHash("sha256").update(cwd).digest("hex");
  const directory = join(nyteHome(), "workspaces", key);
  const path = join(directory, "sessions.db");
  try {
    await access(path);
    return path;
  } catch (cause) {
    if (errnoCode(cause) !== "ENOENT") throw cause;
  }
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const previous = join(cwd, ".nyte", "sessions.db");
  try {
    await access(previous);
  } catch (cause) {
    if (["ENOENT", "ENOTDIR", "EACCES", "EPERM"].includes(errnoCode(cause) ?? "")) return path;
    throw cause;
  }
  // VACUUM INTO writes a consistent copy including committed WAL pages, leaves
  // the original intact, and works in every node:sqlite implementation.
  const source = new DatabaseSync(previous, { readOnly: true });
  const temporary = join(directory, `${randomUUID()}.db`);
  try {
    source.exec(`VACUUM INTO '${temporary.replaceAll("'", "''")}'`);
    await link(temporary, path).catch((cause: unknown) => {
      if (errnoCode(cause) !== "EEXIST") throw cause;
    });
  } finally {
    source.close();
    await rm(temporary, { force: true });
  }
  return path;
}
