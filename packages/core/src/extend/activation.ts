import { SdkError } from "@nyte-ai/schema";
import type { Activation, SessionId, WorkspaceId } from "@nyte-ai/schema";
import type { PluginFile } from "../contract/host.ts";
import type { Kernel, PluginRuntime } from "../contract/kernel.ts";
import type { Plugin } from "../contract/plugin.ts";
import { UnavailableError } from "../env/environment.ts";
import { settle } from "../env/workspaces.ts";
import { coveredHere, requireSession } from "../store/session.ts";
import { loadPlugins, newChatPlugins } from "./plugin-folders.ts";

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

  const assigned = runtime.assigned();

  try {
    await runtime.load(
      assigned === null
        ? await newChatPlugins(kernel, workspace)
        : [...kernel.plugins.builtins, ...(await loadAssigned(kernel, assigned))],
    );
  } catch (error) {
    settle(kernel, session, workspace, classifyActivationFailure(workspace, error));

    throw error;
  }

  settle(kernel, session, workspace, await attached);
}

/** A session's assigned plugins may be what holds it to a policy, so one that no longer loads fails the activation: the session refuses work until it loads again rather than run without it. */
async function loadAssigned(
  kernel: Kernel,
  plugins: readonly (Plugin<"core"> | PluginFile)[],
): Promise<readonly Plugin<"core">[]> {
  return loadPlugins(kernel, plugins).catch((error: unknown) => {
    throw new SdkError(
      "unavailable",
      `The plugins assigned to this session did not load: ${error instanceof Error ? error.message : String(error)}`,
    );
  });
}

function classifyActivationFailure(workspace: WorkspaceId, error: unknown): Activation {
  return error instanceof UnavailableError
    ? { kind: "unavailable", workspace, reason: error.reason }
    : { kind: "failed", message: error instanceof Error ? error.message : String(error) };
}
