import { asId, SdkError } from "@nyte-ai/schema";
import type {
  Json,
  SessionId,
  WorkspaceCatalogView,
  WorkspaceCommandOutcome,
  WorkspaceId,
} from "@nyte-ai/schema";
import type { ConnectionContext } from "../contract/host.ts";
import type { Kernel, PluginRuntime } from "../contract/kernel.ts";
import { readWorkspace } from "../env/environment.ts";
import { newChatPlugins } from "./activation.ts";
import { createHookDispatch } from "./hooks.ts";
import { activateApart } from "./plugin-runtime.ts";
import { commandInfos, createRegistrySet, invokeCommand, skillInfos } from "./registry.ts";
import { scanWorkspaceResources } from "./resources.ts";
import { settingHandle } from "./settings.ts";

/** The commands and skills a new chat in `workspace` would offer, read before the chat exists. */
export function readWorkspaceCatalog(
  kernel: Kernel,
  workspace: WorkspaceId,
): Promise<WorkspaceCatalogView> {
  return withNewChatPlugins(kernel, workspace, async ({ registries }) => ({
    commands: commandInfos(registries),
    skills: skillInfos(registries),
  }));
}

/** Runs command `name` as a new chat in `workspace` would offer it, without the chat: a prompt it answers with comes back for the chat it starts. */
export function runWorkspaceCommand(
  kernel: Kernel,
  context: ConnectionContext,
  workspace: WorkspaceId,
  name: string,
  args: Json | undefined,
): Promise<WorkspaceCommandOutcome> {
  return withNewChatPlugins(kernel, workspace, async (plugins) => {
    const invoked = await invokeCommand(kernel, context, plugins.session, plugins, name, args);

    if (invoked.kind !== "returned") return invoked;
    const { result } = invoked;

    if (typeof result === "string") return { kind: "ran", output: result };

    if (result === undefined) return { kind: "ran", output: null };

    return { kind: "prompt", content: result.prompt };
  });
}

/**
 * Activates the plugins a new chat in `workspace` would load under a stand-in chat id no chat
 * has, over the resources that chat would read, hands them to `work`, then disposes them. A
 * plugin whose activation needs the chat fails here and contributes nothing; its issues stay with
 * the chats that load it.
 */
async function withNewChatPlugins<T>(
  kernel: Kernel,
  workspace: WorkspaceId,
  work: (
    plugins: Pick<PluginRuntime, "registries" | "api"> & { readonly session: SessionId },
  ) => Promise<T>,
): Promise<T> {
  if ((await readWorkspace(kernel.store, workspace)) === null)
    throw new SdkError("unknown", `Workspace ${workspace} is not registered.`);

  const session = asId<"session">(crypto.randomUUID());
  const ended = new AbortController();

  const registries = createRegistrySet({
    onChange: () => {},
    setting: (definition, owner) =>
      settingHandle(kernel, definition, { owner, session: null, signal: ended.signal }),
    report: () => {},
  });

  const host = { registries, hooks: createHookDispatch(kernel, session), report: () => {} };
  const [plugins, inputs] = await Promise.all([
    newChatPlugins(kernel, workspace),
    scanWorkspaceResources(kernel, workspace),
  ]);
  const activated = await activateApart(kernel, session, host, plugins, inputs);

  try {
    await registries.materialize();

    return await work({ session, registries, api: activated.api });
  } finally {
    activated.dispose();
    ended.abort();
  }
}
