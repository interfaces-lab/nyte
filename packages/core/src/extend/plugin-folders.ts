import { SdkError } from "@nyte-ai/schema";
import type { SessionId, WorkspaceId } from "@nyte-ai/schema";
import type { PluginDirectory, PluginFile } from "../contract/host.ts";
import type { Kernel, PluginFailure, PluginRuntime } from "../contract/kernel.ts";
import type { Plugin } from "../contract/plugin.ts";
import type { AssignedPlugin } from "../contract/records.ts";
import { readWorkspace } from "../env/environment.ts";
import { projectTrust } from "../env/trust.ts";
import { sessionRef } from "../store/refs.ts";
import { attempt, put, requireSession, STALE } from "../store/session.ts";
import { commit } from "../watch/commit.ts";

export const PLUGIN_FOLDER = ".nyte/plugins";

export function userPluginFolder(home: string): string {
  return `${home.replace(/\/+$/u, "")}/${PLUGIN_FOLDER}`;
}

async function projectPluginFolder(kernel: Kernel, workspace: WorkspaceId): Promise<string | null> {
  const record = await readWorkspace(kernel.store, workspace);

  if (record === null || !("path" in record.target)) return null;

  if ((await projectTrust(kernel, record)) !== true) return null;

  return `${record.target.path.replace(/\/+$/u, "")}/${PLUGIN_FOLDER}`;
}

export async function sessionPlugins(
  kernel: Kernel,
  session: SessionId,
  runtime: PluginRuntime,
  workspace: WorkspaceId,
): Promise<readonly Plugin<"core">[]> {
  const assigned = runtime.assigned();

  if (assigned === null) return newChatPlugins(kernel, workspace);

  return [...kernel.plugins.builtins, ...(await loadAssigned(kernel, session, assigned))];
}

/** Loads a session's assigned plugins: a file from its path, an id from the objects this process was handed for the session, then from the host's own plugins. */
export async function loadAssigned(
  kernel: Kernel,
  session: SessionId,
  assigned: readonly AssignedPlugin[],
): Promise<readonly Plugin<"core">[]> {
  const known = [...(kernel.plugins.state.inline.get(session) ?? []), ...kernel.plugins.host];

  return loadPlugins(
    kernel,
    assigned.map((entry) => {
      if ("path" in entry) return entry;
      const plugin = known.find((candidate) => candidate.id === entry.id);

      if (plugin === undefined) {
        throw new SdkError("unavailable", `No plugin named ${entry.id} is loaded on this host.`);
      }

      return plugin;
    }),
  );
}

/** Writes a session's plugins into its record, so whichever process activates the session next loads them, and keeps the objects among them for this process. */
export async function assignPlugins(
  kernel: Kernel,
  session: SessionId,
  requested: readonly (Plugin<"core"> | PluginFile)[],
): Promise<void> {
  const plugins = requested.map((plugin): AssignedPlugin =>
    "id" in plugin ? { id: plugin.id } : { path: plugin.path },
  );

  await attempt(`Assigning plugins to ${session}`, async () => {
    const current = await requireSession(kernel.store, session);

    const outcome = await commit(kernel, [
      {
        name: sessionRef(session),
        target: await put(kernel.store, "session", { ...current.record, plugins }),
        expect: current.ref.revision,
      },
    ]);

    return outcome.kind === "set" ? true : STALE;
  });

  const inline = requested.flatMap((plugin) => ("id" in plugin ? [plugin] : []));

  if (inline.length === 0) kernel.plugins.state.inline.delete(session);
  else kernel.plugins.state.inline.set(session, inline);
}

export async function loadPlugins(
  kernel: Kernel,
  plugins: readonly (Plugin<"core"> | PluginFile)[],
): Promise<readonly Plugin<"core">[]> {
  const files = plugins.flatMap((plugin) => ("id" in plugin ? [] : [plugin.path]));
  const loaded = files.length === 0 ? [] : await kernel.plugins.load(files);

  return plugins.flatMap((plugin) =>
    "id" in plugin ? [plugin] : (loaded[files.indexOf(plugin.path)] ?? []),
  );
}

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

  if (issues.length > 0 || kernel.host.current().plugins.some((row) => row.id === folder)) {
    kernel.host.report({ id: folder, source: "project", path: folder, issues });
  }

  return found.loaded.map((entry) => entry.plugin);
}

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

  for (const plugin of sources.keys()) {
    if (!kernel.plugins.host.includes(plugin)) sources.delete(plugin);
  }

  const refused = report.plugins.flatMap((outcome): PluginFailure[] => {
    const entry = found.loaded.find((candidate) => candidate.plugin.id === outcome.id);

    return outcome.kind === "activated" || entry === undefined
      ? []
      : [{ path: entry.path, issues: outcome.issues }];
  });

  reportUserPluginFailures(kernel, loaded, refused, failed);
}

export function reportUserPluginFailures(
  kernel: Kernel,
  plugins: readonly Plugin<"core">[],
  refused: readonly PluginFailure[],
  failed: readonly PluginFailure[],
): void {
  const rows = [...failed, ...refused];
  const failing = rows.map((row) => row.path);

  for (const id of kernel.plugins.state.user.failing) {
    if (!failing.includes(id)) kernel.host.report({ id, source: "user", path: id, issues: [] });
  }

  for (const row of rows) {
    kernel.host.report({ id: row.path, source: "user", path: row.path, issues: row.issues });
  }
  kernel.plugins.state.user = { plugins, refused, failing };
}

export function samePlugins(
  left: readonly Plugin<"core">[],
  right: readonly Plugin<"core">[],
): boolean {
  return left.length === right.length && left.every((plugin, index) => plugin === right[index]);
}
