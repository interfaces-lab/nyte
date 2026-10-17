import type { Activation, SessionId, ValidationIssue, WorkspaceId } from "@nyte-ai/schema";
import type { Kernel, PluginRuntime } from "../contract/kernel.ts";
import type { Plugin } from "../contract/plugin.ts";
import { readWorkspace, UnavailableError } from "../env/environment.ts";
import { projectTrust } from "../env/trust.ts";
import { settle } from "../env/workspaces.ts";
import { coveredHere, requireSession } from "../store/session.ts";

const ACTIVE: Activation = { kind: "active" };

const INACTIVE: Activation = { kind: "inactive" };

export async function activateSession(
  kernel: Kernel,
  session: SessionId,
  runtime: PluginRuntime,
): Promise<void> {
  const workspace = (await requireSession(kernel.store, session)).record.workspace;

  const attached = (await coveredHere(kernel, session))
    ? kernel.environments.attach(session).then(
        () => ACTIVE,
        (error: unknown) => classifyActivationFailure(workspace, error),
      )
    : INACTIVE;

  const project = runtime.assigned() === null ? await projectPlugins(kernel, workspace) : [];

  try {
    await runtime.load([...sessionPlugins(kernel, runtime), ...project]);
  } catch (error) {
    settle(kernel, session, workspace, classifyActivationFailure(workspace, error));

    throw error;
  }

  settle(kernel, session, workspace, await attached);
}

/** The plugins a new chat in `workspace` loads: the built-ins, the host's, then the folder's own once it is trusted. */
export async function newChatPlugins(
  kernel: Kernel,
  workspace: WorkspaceId,
): Promise<readonly Plugin<"core">[]> {
  return [
    ...kernel.plugins.builtins,
    ...kernel.plugins.host,
    ...(await projectPlugins(kernel, workspace)),
  ];
}

async function projectPlugins(
  kernel: Kernel,
  workspace: WorkspaceId,
): Promise<readonly Plugin<"core">[]> {
  const record = await readWorkspace(kernel.store, workspace);

  if (
    record === null ||
    !("path" in record.target) ||
    (await projectTrust(kernel, record)) !== true
  )
    return [];
  const root = record.target.path.replace(/\/+$/u, "");
  const provider = kernel.environments.provider(record.target.kind);
  const sources = (await provider?.inspect(record.target))?.projectSources ?? [];
  const paths = sources
    .filter((source) => source.startsWith(".nyte/plugins/"))
    .map((source) => `${root}/${source}`);
  const path = `${root}/.nyte/plugins`;
  const report = (issues: readonly ValidationIssue[]): void => {
    if (issues.length > 0 || kernel.host.current().plugins.some((row) => row.id === path))
      kernel.host.report({ id: path, source: "project", path, issues });
  };

  if (paths.length === 0) {
    report([]);

    return [];
  }

  try {
    const loaded = await kernel.plugins.load(paths);
    report([]);

    return loaded;
  } catch (error) {
    report([
      {
        severity: "error",
        path: [],
        message: error instanceof Error ? error.message : String(error),
      },
    ]);

    return [];
  }
}

function classifyActivationFailure(workspace: WorkspaceId, error: unknown): Activation {
  return error instanceof UnavailableError
    ? { kind: "unavailable", workspace, reason: error.reason }
    : { kind: "failed", message: error instanceof Error ? error.message : String(error) };
}

function sessionPlugins(kernel: Kernel, runtime: PluginRuntime): readonly Plugin<"core">[] {
  return [...kernel.plugins.builtins, ...(runtime.assigned() ?? kernel.plugins.host)];
}
