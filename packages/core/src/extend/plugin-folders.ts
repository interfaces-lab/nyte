import type { WorkspaceId } from "@nyte-ai/schema";
import type { PluginDirectory, PluginFile } from "../contract/host.ts";
import type { Kernel, PluginFailure, PluginRuntime } from "../contract/kernel.ts";
import type { Plugin } from "../contract/plugin.ts";
import { readWorkspace } from "../env/environment.ts";
import { projectTrust } from "../env/trust.ts";

/** The folder, under the home and under a trusted workspace, whose files are plugins. */
export const PLUGIN_FOLDER = ".nyte/plugins";

/** `<home>/.nyte/plugins`. */
export function userPluginFolder(home: string): string {
  return `${home.replace(/\/+$/u, "")}/${PLUGIN_FOLDER}`;
}

/** A trusted local workspace's `.nyte/plugins`, or null for one untrusted or not on this machine. */
async function projectPluginFolder(kernel: Kernel, workspace: WorkspaceId): Promise<string | null> {
  const record = await readWorkspace(kernel.store, workspace);

  if (record === null || !("path" in record.target)) return null;

  if ((await projectTrust(kernel, record)) !== true) return null;

  return `${record.target.path.replace(/\/+$/u, "")}/${PLUGIN_FOLDER}`;
}

/** The plugins `runtime`'s session would load now: its assigned plugins, each file loaded again, or else a new chat's in `workspace`. */
export async function sessionPlugins(
  kernel: Kernel,
  runtime: PluginRuntime,
  workspace: WorkspaceId,
): Promise<readonly Plugin<"core">[]> {
  const assigned = runtime.assigned();

  if (assigned === null) return newChatPlugins(kernel, workspace);

  return [...kernel.plugins.builtins, ...(await loadPlugins(kernel, assigned))];
}

/** Returns `plugins` with each file loaded through the host's plugin loader, in order. */
export async function loadPlugins(
  kernel: Kernel,
  plugins: readonly (Plugin<"core"> | PluginFile)[],
): Promise<readonly Plugin<"core">[]> {
  const each = await Promise.all(
    plugins.map(async (plugin) => ("id" in plugin ? [plugin] : kernel.plugins.load([plugin.path]))),
  );

  return each.flat();
}

/** The plugins a new chat in `workspace` loads: the built-ins, the host's, then the folder's own once it is trusted. */
export async function newChatPlugins(
  kernel: Kernel,
  workspace: WorkspaceId,
): Promise<readonly Plugin<"core">[]> {
  return [
    ...kernel.plugins.builtins,
    ...kernel.plugins.host,
    ...(await loadProjectPlugins(kernel, workspace)),
  ];
}

/** The plugins in a trusted workspace's `.nyte/plugins`, each file on its own: a file that fails is reported on the folder's row and the others still load. */
async function loadProjectPlugins(
  kernel: Kernel,
  workspace: WorkspaceId,
): Promise<readonly Plugin<"core">[]> {
  const folder = await projectPluginFolder(kernel, workspace);

  if (folder === null) return [];

  const found = await kernel.plugins.directory(folder).catch((error: unknown): PluginDirectory => ({
    loaded: [],
    failed: [
      {
        path: folder,
        issue: {
          severity: "error",
          path: [],
          message: error instanceof Error ? error.message : String(error),
        },
      },
    ],
  }));

  const issues = found.failed.map((entry) => entry.issue);

  if (issues.length > 0 || kernel.host.current().plugins.some((row) => row.id === folder))
    kernel.host.report({ id: folder, source: "project", path: folder, issues });

  return found.loaded.map((entry) => entry.plugin);
}

/**
 * Reloads the host's plugins from `<home>/.nyte/plugins` after a change there: the files that
 * load take the place of those loaded before, beside the host's other plugins, and nothing
 * reloads while every file gives the plugin its last load gave, whether the host took it or not.
 * A file that fails, or whose plugin the host refuses, is reported on its own row, and a row whose
 * file no longer fails is withdrawn.
 */
export async function reloadUserPlugins(kernel: Kernel): Promise<void> {
  const home = kernel.home;

  if (home === null) return;
  const found = await kernel.plugins.directory(userPluginFolder(home));
  const last = kernel.plugins.state.user;
  const loaded = found.loaded.map((entry) => entry.plugin);
  const failed = found.failed.map((entry) => ({ path: entry.path, issues: [entry.issue] }));

  if (samePlugins(last.plugins, loaded)) {
    reportUserPluginFailures(kernel, loaded, last.refused, failed);

    return;
  }

  const sources = kernel.plugins.sources;
  const others = kernel.plugins.host.filter((plugin) => !sources.has(plugin));

  for (const entry of found.loaded) sources.set(entry.plugin, { source: "user", path: entry.path });
  const report = await kernel.plugins.replace([...others, ...loaded]);

  for (const plugin of sources.keys())
    if (!kernel.plugins.host.includes(plugin)) sources.delete(plugin);

  const refused = report.plugins.flatMap((outcome): PluginFailure[] => {
    const entry = found.loaded.find((candidate) => candidate.plugin.id === outcome.id);

    return outcome.kind === "activated" || entry === undefined
      ? []
      : [{ path: entry.path, issues: outcome.issues }];
  });

  reportUserPluginFailures(kernel, loaded, refused, failed);
}

/** Records a load of `<home>/.nyte/plugins` as the one the next load compares against, puts each file that failed or was refused on its own row, and withdraws the rows of the files that no longer do. */
export function reportUserPluginFailures(
  kernel: Kernel,
  plugins: readonly Plugin<"core">[],
  refused: readonly PluginFailure[],
  failed: readonly PluginFailure[],
): void {
  const rows = [...failed, ...refused];
  const failing = rows.map((row) => row.path);

  for (const id of kernel.plugins.state.user.failing)
    if (!failing.includes(id)) kernel.host.report({ id, source: "user", path: id, issues: [] });

  for (const row of rows)
    kernel.host.report({ id: row.path, source: "user", path: row.path, issues: row.issues });
  kernel.plugins.state.user = { plugins, refused, failing };
}

/** Whether two plugin lists hold the same objects in the same order. */
export function samePlugins(
  left: readonly Plugin<"core">[],
  right: readonly Plugin<"core">[],
): boolean {
  return left.length === right.length && left.every((plugin, index) => plugin === right[index]);
}
