import { SdkError } from "@nyte-ai/schema";
import type { Activation, SessionId, WorkspaceId } from "@nyte-ai/schema";
import type { Kernel, PluginRuntime } from "../contract/kernel.ts";
import { UnavailableError } from "../env/environment.ts";
import { settle } from "../env/workspaces.ts";
import { coveredHere, requireSession } from "../store/session.ts";
import { loadAssigned, newChatPlugins } from "./plugin-folders.ts";

const ACTIVE: Activation = { kind: "active" };

const INACTIVE: Activation = { kind: "inactive" };

export async function activateSession(
  kernel: Kernel,
  session: SessionId,
  runtime: PluginRuntime,
): Promise<void> {
  const { record } = await requireSession(kernel.store, session);
  const workspace = record.workspace;

  const attached = (await coveredHere(kernel, session))
    ? kernel.environments.attach(session).then(
        () => ACTIVE,
        (error: unknown) => classifyActivationFailure(workspace, error),
      )
    : INACTIVE;

  const assigned = record.plugins ?? null;

  try {
    await runtime.load(
      assigned === null
        ? await newChatPlugins(kernel, workspace)
        : [
            ...kernel.plugins.builtins,
            ...(await loadAssigned(kernel, session, assigned).catch((error: unknown) => {
              throw new SdkError(
                "unavailable",
                `The plugins assigned to this session did not load: ${error instanceof Error ? error.message : String(error)}`,
              );
            })),
          ],
      assigned,
    );
  } catch (error) {
    settle(kernel, session, workspace, classifyActivationFailure(workspace, error));

    throw error;
  }

  settle(kernel, session, workspace, await attached);
}

function classifyActivationFailure(workspace: WorkspaceId, error: unknown): Activation {
  return error instanceof UnavailableError
    ? { kind: "unavailable", workspace, reason: error.reason }
    : { kind: "failed", message: error instanceof Error ? error.message : String(error) };
}
