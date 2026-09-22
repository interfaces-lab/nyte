/**
 * `@nyte-ai/host`: one composition of a `Nyte` for every Nyte host. Core
 * stays the kernel; this package owns the choices a host makes on top of it:
 * which model catalog answers, which plugins load from where, and what a
 * workspace must have granted before project code runs.
 */
import { homedir } from "node:os";
import { join } from "node:path";
import process from "node:process";
import type { MutableModels } from "@nyte-ai/ai";
import { createNyte } from "@nyte-ai/core";
import type {
  ActivationRequirement,
  ActiveSessionActivation,
  LoadedPlugin,
  Nyte,
  NyteOptions,
  ResolvedPlugins,
  SessionActivation,
} from "@nyte-ai/core";
import { inlinePlugin, systemPromptPlugin } from "@nyte-ai/core/plugins";
import type { Plugin, PluginEnv } from "@nyte-ai/core/plugins";
import { openaiCompactionPlugin } from "@nyte-ai/plugin/openai-compaction";
import { openaiAstraContextPlugin } from "@nyte-ai/plugin/openai-astra-context";
import type { Api, Model } from "@nyte-ai/schema";
import { nyteHome } from "./paths.ts";
import type { PluginTarget } from "./paths.ts";
import { resolveHostPlugins } from "./plugins.ts";
import { providerOverrides } from "./provider-plugins.ts";
import { WorkspaceStore } from "./workspace-store.ts";

export {
  manifestPaths,
  nyteHome,
  pluginDirectories,
  pluginWatchTargets,
  skillDirectories,
  workspaceStorePath,
} from "./paths.ts";

export type { PluginTarget } from "./paths.ts";

export { readManifest, resolveHostPlugins, type HostManifest } from "./plugins.ts";

export {
  WorkspaceStore,
  WorkspaceTrustRequired,
  workspaceName,
  type WorkspaceTrustResolution,
} from "./workspace-store.ts";

export { discoverMentionFiles, rankMentionFiles } from "./mention-files.ts";

export {
  MAX_WORKSPACE_FILE_BYTES,
  readWorkspaceFile,
  resolveWorkspaceFile,
  saveWorkspaceFile,
  WorkspaceFileError,
} from "./workspace-files.ts";

export { searchWorkspaceFiles, WorkspaceSearchError } from "./workspace-search.ts";

export {
  createTreeSnapshot,
  type TreeSnapshot,
  type TreeSnapshotOptions,
} from "./tree-snapshot.ts";

export { createGitVcs, type GitVcsOptions } from "./git.ts";

export { InvalidRipgrepPattern } from "./ripgrep.ts";

export type DeferredPluginTarget =
  | PluginTarget
  | { readonly kind: "inactive" }
  | { readonly kind: "requires"; readonly requirement: ActivationRequirement };

export type HostPlugins =
  /** No local data: a system prompt and provider context policies. `env.cwd` is informational. */
  | { readonly kind: "chat"; readonly system?: string }
  /** The workspace set behind trust: shared built-ins, user and project plugin directories, skills. */
  | {
      readonly kind: "workspace";
      readonly target:
        | PluginTarget
        /** Storage opens now; the target (and so trust) is resolved when the first session activates. */
        | { readonly kind: "deferred"; readonly resolve: () => Promise<DeferredPluginTarget> };
      /** Client-specific built-ins, appended after the shared set. */
      readonly extra?: readonly Plugin[];
      readonly onFailure?: (failure: ResolvedPlugins["failures"][number]) => void;
    }
  /** Plugins the caller loaded itself (an embedded product, a test), passed through unchanged. */
  | { readonly kind: "custom"; readonly plugins: readonly LoadedPlugin[]; readonly env: PluginEnv };

export type HostOptions = Omit<
  NyteOptions,
  "streamFn" | "models" | "plugins" | "env" | "resolveActivation"
> & {
  /** Supplies both the catalog and the stream function. */
  readonly models: MutableModels;
  readonly plugins: HostPlugins;
};

export function createWorkspaceStore(): WorkspaceStore {
  return new WorkspaceStore(join(nyteHome(), "workspaces.json"));
}

/** `"provider/id"` to a catalog model, restoring persisted data before trying the network. */
export async function resolveModel(models: MutableModels, ref: string): Promise<Model<Api>> {
  const slash = ref.indexOf("/");

  if (slash === -1) throw new Error(`Model must be "provider/id": ${ref}`);
  const provider = ref.slice(0, slash);
  const modelId = ref.slice(slash + 1);
  await models.refresh({ providers: [provider], allowNetwork: false });
  const restored = models.getModel(provider, modelId);

  if (restored !== undefined) return restored;
  await models.refresh({ providers: [provider] });
  const refreshed = models.getModel(provider, modelId);

  if (refreshed === undefined) throw new Error(`Unknown model: ${ref}`);

  return refreshed;
}

export async function createHost(options: HostOptions): Promise<Nyte> {
  const { models, plugins, ...base } = options;
  const providers = providerOverrides(models);

  const create = async (input: NyteOptions): Promise<Nyte> => {
    const resolveActivation = input.resolveActivation;

    const sdk = await (resolveActivation === undefined
      ? createNyte({ ...input, plugins: providers.wrap(input.plugins ?? []) })
      : createNyte({
          ...input,
          resolveActivation: async (target) => {
            const activation = await resolveActivation(target);

            return activation.kind === "active"
              ? { ...activation, plugins: providers.wrap(activation.plugins) }
              : activation;
          },
        }));

    const setPlugins = sdk.setPlugins.bind(sdk);
    const relocate = sdk.relocate.bind(sdk);
    sdk.setPlugins = (next, target) => setPlugins(providers.wrap(next), target);
    sdk.relocate = (target) => relocate({ ...target, plugins: providers.wrap(target.plugins) });

    return sdk;
  };

  // Delegation can choose a provider other than the parent before any picker opens.
  await models.refresh({ allowNetwork: false });

  const shared = {
    ...base,
    models,
    drain: "all",
    streamFn: providers.stream,
  } satisfies Partial<NyteOptions>;

  switch (plugins.kind) {
    case "chat":
      return create({
        ...shared,
        plugins: [
          inlinePlugin(systemPromptPlugin(plugins.system)),
          inlinePlugin(openaiCompactionPlugin({ models })),
          inlinePlugin(openaiAstraContextPlugin()),
        ],
        env: { cwd: process.cwd() },
      });
    case "custom":
      return create({ ...shared, plugins: plugins.plugins, env: plugins.env });
    case "workspace": {
      const activate = async (target: PluginTarget): Promise<ActiveSessionActivation> => {
        const resolved = await resolveHostPlugins(target, {
          models,
          model: options.model,
          extra: plugins.extra,
        });

        for (const failure of resolved.failures) plugins.onFailure?.(failure);

        return {
          kind: "active",
          plugins: resolved.plugins,
          env: { cwd: target.kind === "project" ? target.workspace.cwd : homedir() },
        };
      };

      const { target } = plugins;

      switch (target.kind) {
        case "home":
        case "project":
          return activate(target).then((active) =>
            create({ ...shared, plugins: active.plugins, env: active.env }),
          );
        case "deferred": {
          let active: ActiveSessionActivation | undefined;
          let resolving: Promise<SessionActivation> | undefined;

          return create({
            ...shared,
            resolveActivation: () => {
              if (active !== undefined) return active;

              if (resolving !== undefined) return resolving;
              resolving = target
                .resolve()
                .then(async (resolved): Promise<SessionActivation> => {
                  switch (resolved.kind) {
                    case "home":
                    case "project": {
                      const composition = await activate(resolved);
                      active = composition;

                      return composition;
                    }

                    case "inactive":
                    case "requires":
                      return resolved;
                    default: {
                      const _exhaustive: never = resolved;

                      return _exhaustive;
                    }
                  }
                })
                .finally(() => {
                  resolving = undefined;
                });

              return resolving;
            },
          });
        }

        default: {
          const _exhaustive: never = target;

          return _exhaustive;
        }
      }
    }

    default: {
      const _exhaustive: never = plugins;

      return _exhaustive;
    }
  }
}
