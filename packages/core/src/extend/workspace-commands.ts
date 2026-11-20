import { asId, SdkError } from "@nyte-ai/schema";
import type {
  CommandCompletion,
  SessionId,
  WorkspaceCatalogView,
  WorkspaceCommandOutcome,
  WorkspaceId,
} from "@nyte-ai/schema";
import type { ConnectionContext } from "../contract/host.ts";
import type { Kernel, PluginRuntime } from "../contract/kernel.ts";
import type { Resources } from "../contract/workspace.ts";
import { readWorkspace } from "../env/environment.ts";
import { newChatPlugins } from "./plugin-folders.ts";
import { createHookDispatch } from "./hooks.ts";
import { activateApart } from "./plugin-runtime.ts";
import {
  commandInfos,
  completeCommand,
  createRegistrySet,
  invokeCommand,
  skillInfos,
} from "./registry.ts";
import { scanWorkspaceResources } from "./resources.ts";
import { readSettingValues } from "./setting-definitions.ts";
import { settingHandle } from "./settings.ts";

export function readWorkspaceCatalog(
  kernel: Kernel,
  workspace: WorkspaceId,
): Promise<WorkspaceCatalogView> {
  return withNewChatPlugins(kernel, workspace, false, async ({ registries, inputs }) => ({
    commands: commandInfos(registries),
    skills: skillInfos(registries),
    docs: inputs.docs,
    contextFiles: inputs.contextFiles.map((file) => ({
      id: file.id,
      name: file.path.slice(file.path.lastIndexOf("/") + 1),
      scope: file.scope,
      location: file.path,
    })),
  }));
}

export function runWorkspaceCommand(
  kernel: Kernel,
  context: ConnectionContext,
  workspace: WorkspaceId,
  name: string,
  text: string,
): Promise<WorkspaceCommandOutcome> {
  return withNewChatPlugins(kernel, workspace, true, async (plugins) => {
    const invoked = await invokeCommand(kernel, context, plugins.session, plugins, name, text);

    if (invoked.kind !== "returned") return invoked;
    const { result } = invoked;

    switch (result.kind) {
      case "text":
        return { kind: "ran", output: result.output };
      case "prompt":
        return { kind: "prompt", content: result.content };
      case "move":
        return (await readWorkspace(kernel.store, result.workspace)) === null
          ? { kind: "failed", message: "That folder isn't registered on this host." }
          : { kind: "moved", workspace: result.workspace, output: result.output };
      default: {
        const _exhaustive: never = result;

        return _exhaustive;
      }
    }
  });
}

export function completeWorkspaceCommand(
  kernel: Kernel,
  context: ConnectionContext,
  workspace: WorkspaceId,
  name: string,
  prefix: string,
): Promise<readonly CommandCompletion[]> {
  return withNewChatPlugins(kernel, workspace, false, (plugins) =>
    completeCommand(kernel, context, plugins.session, plugins, name, prefix),
  );
}

async function withNewChatPlugins<T>(
  kernel: Kernel,
  workspace: WorkspaceId,
  attach: boolean,
  work: (
    plugins: Pick<PluginRuntime, "registries" | "api"> & {
      readonly session: SessionId;
      readonly inputs: Resources;
    },
  ) => Promise<T>,
): Promise<T> {
  if ((await readWorkspace(kernel.store, workspace)) === null)
    throw new SdkError("unknown", `Workspace ${workspace} is not registered.`);

  const session = asId<"session">(crypto.randomUUID());
  const ended = new AbortController();

  let settings: Readonly<Record<string, unknown>> = {};

  const registries = createRegistrySet({
    chat: () => ({ parent: null, settings }),
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

  const env = attach ? await kernel.environments.attachWorkspace(workspace) : null;
  const activated = await activateApart(kernel, session, host, plugins, inputs, env);

  try {
    registries.settings.materialize(registries);

    settings = await readSettingValues(
      kernel,
      null,
      registries.settings.drafted().map((entry) => entry.item),
    );
    await registries.materialize();

    return await work({ session, registries, api: activated.api, inputs });
  } finally {
    activated.dispose();
    ended.abort();
  }
}
