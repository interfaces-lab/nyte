/**
 * From flags and settings to a composed host: which provider answers, which
 * model and thinking level a run starts from, and the workspace's plugin set.
 */
import { join } from "node:path";
import process from "node:process";
import { clampThinkingLevel, createNyteModels } from "@nyte-ai/ai";
import type { Api, Model, Models, MutableModels, Provider } from "@nyte-ai/ai";
import { isThinkingLevel, sessionId } from "@nyte-ai/core";
import type { Nyte, SessionInfo, ThinkingLevel, TrustedWorkspace } from "@nyte-ai/core";
import {
  DEFAULT_PROVIDER_ID,
  DEFAULT_THINKING_LEVEL,
  loadProviderCatalog,
  requireModel,
  requireProvider,
} from "./catalog.ts";
import type { ResumeTarget, RunFlags } from "./flags.ts";
import { Host } from "./host.ts";
import { resolveWorkspacePlugins } from "./plugins.ts";
import type { ResolvedSettings } from "./settings.ts";

export interface Runtime {
  readonly models: MutableModels;
  readonly provider: Provider;
}

export function runProviderCandidates(
  models: Models,
  providerId: string | undefined,
  settings: ResolvedSettings | undefined,
): readonly Provider[] {
  if (providerId !== undefined) return [requireProvider(models, providerId)];
  const providers = models.getProviders();
  if (settings?.defaultProvider === undefined) return providers;
  const preferred = models.getProvider(settings.defaultProvider);
  if (preferred === undefined) return providers;
  return [preferred, ...providers.filter((provider) => provider.id !== preferred.id)];
}

function resolveRunModelId(
  models: Models,
  providerId: string,
  sources: {
    readonly flag: string | undefined;
    readonly environment: string | undefined;
    readonly settings: ResolvedSettings;
  },
): string | undefined {
  const override = sources.flag ?? sources.environment;
  if (override !== undefined) return override;
  if (sources.settings.defaultProvider !== providerId) return undefined;
  if (sources.settings.defaultModel === undefined) return undefined;
  return models.getModel(providerId, sources.settings.defaultModel)?.id;
}

/** The first provider with a stored credential, in preference order. */
export async function resolveRuntime(
  flags: RunFlags,
  settings: ResolvedSettings,
): Promise<Runtime | undefined> {
  const models = createNyteModels();
  for (const provider of runProviderCandidates(models, flags.provider, settings)) {
    const auth = await models.getAuth(provider.id);
    if (auth !== undefined) {
      await loadProviderCatalog(models, provider.id);
      return { models, provider };
    }
  }
  return undefined;
}

/**
 * The runtime a signed-out launch starts from: the preferred provider over
 * its baked catalog, so the shell can open and offer `/login`.
 */
export async function signedOutRuntime(
  flags: RunFlags,
  settings: ResolvedSettings,
): Promise<Runtime> {
  const models = createNyteModels();
  const provider =
    runProviderCandidates(models, flags.provider, settings)[0] ??
    requireProvider(models, DEFAULT_PROVIDER_ID);
  await loadProviderCatalog(models, provider.id);
  return { models, provider };
}

export interface HostFallbacks {
  readonly model: Model<Api>;
  readonly thinkingLevel: ThinkingLevel;
}

/** Resolve the composition fallbacks a workspace launch starts from. */
export function hostFallbacks(
  runtime: Runtime,
  settings: ResolvedSettings,
  flags: Pick<RunFlags, "model" | "effort">,
): HostFallbacks {
  const modelId = resolveRunModelId(runtime.models, runtime.provider.id, {
    flag: flags.model,
    environment: process.env["NYTE_MODEL"],
    settings,
  });
  const model = requireModel(runtime.models, runtime.provider.id, modelId);
  const requested = flags.effort ?? process.env["NYTE_EFFORT"];
  const effort =
    requested !== undefined && isThinkingLevel(requested)
      ? requested
      : (settings.defaultThinkingLevel ?? DEFAULT_THINKING_LEVEL);
  return { model, thinkingLevel: clampThinkingLevel(model, effort) };
}

export interface OpenWorkspaceHostOptions {
  readonly workspace: TrustedWorkspace;
  readonly settings: ResolvedSettings;
  readonly runtime: Runtime;
  readonly model: Model<Api>;
  readonly thinkingLevel: ThinkingLevel;
  /** Plugin load failures. */
  readonly report: (message: string) => void;
}

export function sessionStorePath(cwd: string): string {
  return join(cwd, ".nyte", "sessions.db");
}

/**
 * Compose the host for one workspace: its store, its plugin set behind trust,
 * and the model fallbacks the caller resolved.
 */
export async function openWorkspaceHost(options: OpenWorkspaceHostOptions): Promise<Host> {
  const { workspace, runtime } = options;
  const resolved = await resolveWorkspacePlugins(workspace, {
    model: options.model,
    models: runtime.models,
  });
  for (const failure of resolved.failures) {
    options.report(`plugin ${failure.path}: ${failure.error}`);
  }
  return Host.open({
    cwd: workspace.cwd,
    storePath: sessionStorePath(workspace.cwd),
    streamFn: (model, context, streamOptions) =>
      runtime.models.streamSimple(model, context, streamOptions),
    models: {
      getModels: (provider) => runtime.models.getModels(provider),
      getModel: (provider, id) => runtime.models.getModel(provider, id),
    },
    model: options.model,
    thinkingLevel: options.thinkingLevel,
    plugins: resolved.plugins,
    compaction: options.settings.compaction,
    streamOptions: { transport: options.settings.transport },
  });
}

/** The session a launch targets, through SDK verbs alone. */
export async function targetSession(nyte: Nyte, target: ResumeTarget): Promise<SessionInfo> {
  switch (target.kind) {
    case "new":
      return nyte.sessions.create();
    case "latest": {
      // Skip sessions that were created by a launch and never written to.
      const { items } = await nyte.sessions.list();
      const used = items
        .filter((info) => info.heads.some((head) => head.tip !== null))
        .toSorted((left, right) => right.lastActivityAt - left.lastActivityAt)[0];
      return used ?? nyte.sessions.create();
    }
    case "session": {
      const info = await nyte.sessions.get({ sessionId: sessionId(target.id) });
      if (info === undefined) throw new Error(`Session not found: ${target.id}`);
      return info;
    }
    default: {
      const _exhaustive: never = target;
      return _exhaustive;
    }
  }
}
