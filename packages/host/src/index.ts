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
import type { Plugin, Nyte, NyteOptions, WorkspaceTrust } from "@nyte-ai/core";
import { localEnvironmentPlugin, systemPromptPlugin } from "@nyte-ai/core/plugins";
import type { EnvironmentPlugin } from "@nyte-ai/core/plugins";
import { openaiCompactionPlugin } from "@nyte-ai/plugin/openai-compaction";
import { openaiAstraContextPlugin } from "@nyte-ai/plugin/openai-astra-context";
import type { CodemodeSandboxOptions } from "@nyte-ai/plugin/codemode-runtime";
import type { Api, Model } from "@nyte-ai/schema";
import { createModelCatalog, createModelPreferencesStore } from "./catalog.ts";
import { environmentId } from "./environment-id.ts";
import { nyteHome } from "./paths.ts";
import type { PluginTarget } from "./paths.ts";
import { PluginPreparationError, resolveHostPlugins, samePluginSources } from "./plugins.ts";
import type { PluginSources, ResolvedPlugins } from "./plugins.ts";
import { providerOverrides } from "./provider-plugins.ts";
import { WorkspaceStore } from "./workspace-store.ts";
import { readCacheWarmingMode } from "./settings.ts";

export { cacheWarmingMode } from "./settings.ts";

export { environmentId } from "./environment-id.ts";

export {
  manifestPaths,
  nyteHome,
  pluginDirectories,
  pluginWatchTargets,
  skillDirectories,
  userPluginDirectory,
  workspaceStorePath,
} from "./paths.ts";

export type { PluginTarget } from "./paths.ts";

export { readManifest, resolveHostPlugins, type HostManifest } from "./plugins.ts";

export { createWorkspaceBackend } from "./workspace-backend.ts";

export {
  WorkspaceStore,
  WorkspaceTrustRequired,
  workspaceName,
  type TrustedWorkspace,
  type WorkspaceTrustResolution,
} from "./workspace-store.ts";

export { discoverMentionFiles, rankMentionFiles } from "./mention-files.ts";

export {
  blameWorkspaceFile,
  formatWorkspaceFile,
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

export {
  createGitHubService,
  runGitHubCommand,
  type GitHubCommandRequest,
  type GitHubCommandResult,
  type GitHubCommandRunner,
  type GitHubOperations,
  type GitHubService,
  type GitHubServiceOptions,
} from "./github.ts";

export { InvalidRipgrepPattern } from "./ripgrep.ts";

export type DeferredPluginTarget =
  | PluginTarget
  | Exclude<WorkspaceTrust, { readonly kind: "trusted" }>;

export type HostPlugins =
  /** No local data: a system prompt and provider context policies. Sessions start in `process.cwd()`. */
  | { readonly kind: "chat"; readonly system?: string }
  /** The workspace set behind trust: shared built-ins, user and project plugin directories, skills. */
  | {
      readonly kind: "workspace";
      readonly target:
        | PluginTarget
        /** Storage opens now; the target (and so trust) is resolved when the host first opens `cwd`. */
        | {
            readonly kind: "deferred";
            readonly cwd: string;
            readonly resolve: () => Promise<DeferredPluginTarget>;
          };
      /** Client-specific built-ins, appended after the shared set. */
      readonly extra?: readonly Plugin[];
      readonly sources?: PluginSources<unknown>;
      readonly codemode?: Pick<CodemodeSandboxOptions, "workerUrl" | "wasm">;
      readonly onFailure?: (failure: ResolvedPlugins["failures"][number]) => void;
    }
  /** Plugins the caller loaded itself (an embedded product, a test), installed as given. Sessions start in `cwd`. */
  | { readonly kind: "custom"; readonly plugins: readonly Plugin[]; readonly cwd: string };

export type HostOptions = Omit<
  NyteOptions,
  "streamFn" | "models" | "plugins" | "defaultWorkspace" | "trust"
> & {
  /** Supplies both the catalog and the stream function. */
  readonly models: MutableModels;
  readonly plugins: HostPlugins;
  /** Environment providers installed after this machine's, in every mode. */
  readonly environments?: readonly EnvironmentPlugin[];
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
  const { models, plugins, environments = [], ...base } = options;
  const providers = providerOverrides(models);
  const id = await environmentId();
  const local = localEnvironmentPlugin({ id });

  // Delegation can choose a provider other than the parent before any picker opens.
  await models.refresh({ allowNetwork: false });

  let cacheWarming = options.cacheWarming;
  if (cacheWarming === undefined) {
    const mode = await readCacheWarmingMode();
    cacheWarming = () => mode;
  }
  const shared = {
    ...base,
    cacheWarming,
    models: createModelCatalog(models, createModelPreferencesStore()),
    drain: "all",
    streamFn: providers.stream,
  } satisfies Partial<NyteOptions>;

  const create = async (
    cwd: string,
    bootstrap: readonly Plugin[],
    trust: NonNullable<NyteOptions["trust"]>,
  ): Promise<Nyte> => {
    if (plugins.kind !== "workspace" || plugins.target.kind !== "deferred")
      await options.workspace?.touch(cwd);

    const sdk = await createNyte({
      ...shared,
      plugins: [local, ...environments, ...providers.wrap(bootstrap)],
      defaultWorkspace: { kind: "local", id, cwd },
      trust,
    });

    const setPlugins = sdk.setPlugins.bind(sdk);
    sdk.setPlugins = (next, target) =>
      setPlugins([local, ...environments, ...providers.wrap(next)], target);

    return sdk;
  };

  /** Without a trust store, `cwd` and other environments are trusted; this machine's other folders wait for a grant. */
  const trustCwd =
    (cwd: string): NonNullable<NyteOptions["trust"]> =>
    (workspace) =>
      workspace.id !== id || workspace.cwd === cwd
        ? { kind: "trusted" }
        : { kind: "requires", requirement: { kind: "workspace_trust", cwd: workspace.cwd } };

  switch (plugins.kind) {
    case "chat": {
      const cwd = process.cwd();

      return create(
        cwd,
        [
          systemPromptPlugin(plugins.system),
          openaiCompactionPlugin({ models }),
          openaiAstraContextPlugin(),
        ],
        trustCwd(cwd),
      );
    }

    case "custom":
      return create(plugins.cwd, plugins.plugins, trustCwd(plugins.cwd));
    case "workspace": {
      const workspaces = createWorkspaceStore();
      const { target } = plugins;

      const cwd =
        target.kind === "home"
          ? homedir()
          : target.kind === "project"
            ? target.workspace.cwd
            : target.cwd;

      /** Loads `resolved`'s plugins through the opened environment, the same objects while their sources are unchanged. */
      const trusted = (resolved: PluginTarget): WorkspaceTrust => {
        let snapshot: readonly Plugin[] | undefined;

        return {
          kind: "trusted",
          plugins: async (env) => {
            const next = await resolveHostPlugins(resolved, {
              models,
              model: options.model,
              extra: plugins.extra,
              sources: plugins.sources,
              codemode: plugins.codemode,
              env,
            }).catch((cause: unknown) => {
              const failures =
                cause instanceof PluginPreparationError
                  ? cause.failures
                  : [
                      {
                        path: "plugins",
                        error: cause instanceof Error ? cause.message : String(cause),
                      },
                    ];

              for (const failure of failures) plugins.onFailure?.(failure);
              // Paths and plugin errors stay on the host; the session's activation reaches clients.
              throw new Error("Plugins failed to load");
            });

            if (snapshot === undefined || !samePluginSources(snapshot, next.plugins))
              snapshot = next.plugins;

            return providers.wrap(snapshot);
          },
        };
      };

      const trustTarget = async (): Promise<WorkspaceTrust> => {
        if (target.kind !== "deferred") return trusted(target);
        const resolved = await target.resolve();

        return resolved.kind === "home" || resolved.kind === "project"
          ? trusted(resolved)
          : resolved;
      };

      return create(cwd, [], async (workspace) => {
        // Another environment runs the host's own plugins, never a project folder's.
        if (workspace.id !== id) return trusted({ kind: "home" });

        if (workspace.cwd === cwd) return trustTarget();
        // A folder that is gone or unreadable waits, as an unavailable workspace does.
        const resolution = await workspaces.resolve(workspace.cwd).catch(() => undefined);

        if (resolution === undefined) return { kind: "inactive" };

        return resolution.kind === "trusted"
          ? trusted({ kind: "project", workspace: resolution.workspace })
          : { kind: "requires", requirement: { kind: "workspace_trust", cwd: resolution.cwd } };
      });
    }

    default: {
      const _exhaustive: never = plugins;

      return _exhaustive;
    }
  }
}
