/**
 * From flags and settings to a composed host: which provider answers, which
 * model and thinking level a run starts from, and the workspace's plugin set.
 */
import process from "node:process";
import { clampThinkingLevel, createNyteModels } from "@nyte-ai/ai";
import type { Api, Model, Models, MutableModels, Provider } from "@nyte-ai/ai";
import { isThinkingLevel, sessionId } from "@nyte-ai/core";
import type { Nyte, SessionInfo, ThinkingLevel, TrustedWorkspace } from "@nyte-ai/core";
import type { Plugin } from "@nyte-ai/core/plugins";
import { workspaceStorePath } from "@nyte-ai/host";
import { notificationsPlugin } from "@nyte-ai/plugin/examples/notifications";
import { warmingPlugin } from "@nyte-ai/plugin/examples/warming";
import type { TelemetryContext } from "@nyte-ai/telemetry";
import {
  DEFAULT_PROVIDER_ID,
  DEFAULT_THINKING_LEVEL,
  loadProviderCatalog,
  requireModel,
  requireProvider,
} from "./catalog.ts";
import type { ResumeTarget, RunFlags } from "./flags.ts";
import { Host } from "./host.ts";
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

/** Choose configured auth locally; refreshing OAuth belongs to the request path. */
export async function resolveRuntime(
  flags: RunFlags,
  settings: ResolvedSettings,
): Promise<Runtime | undefined> {
  const models = createNyteModels();
  for (const provider of runProviderCandidates(models, flags.provider, settings)) {
    const auth = await models.checkAuth(provider.id);
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

/** The terminal's own built-ins, after the shared set: attention comes through the shell. */
export function tuiPlugins(models: Models): Plugin[] {
  return [warmingPlugin({ models }), notificationsPlugin];
}

export interface OpenWorkspaceHostOptions {
  readonly telemetry?: TelemetryContext;
  readonly workspace: TrustedWorkspace;
  readonly settings: ResolvedSettings;
  readonly runtime: Runtime;
  readonly model: Model<Api>;
  readonly thinkingLevel: ThinkingLevel;
  /** Plugin load failures. */
  readonly report: (message: string) => void;
}

/**
 * Compose the host for one workspace: its store, its plugin set behind trust,
 * and the model fallbacks the caller resolved.
 */
export async function openWorkspaceHost(options: OpenWorkspaceHostOptions): Promise<Host> {
  const { workspace, runtime } = options;
  return Host.open({
    cwd: workspace.cwd,
    storePath: await workspaceStorePath(workspace.cwd),
    models: runtime.models,
    model: options.model,
    thinkingLevel: options.thinkingLevel,
    telemetry: options.telemetry,
    plugins: {
      kind: "workspace",
      target: { kind: "project", workspace },
      extra: tuiPlugins(runtime.models),
      onFailure: (failure) => options.report(`plugin ${failure.path}: ${failure.error}`),
    },
    compaction: options.settings.compaction,
    streamOptions: { transport: options.settings.transport },
  });
}

/** The session a launch targets, through SDK operations alone. */
export async function targetSession(nyte: Nyte, target: ResumeTarget): Promise<SessionInfo> {
  switch (target.kind) {
    case "new":
      return nyte.sessions.create();
    case "latest": {
      // Skip sessions that were created by a launch and never written to,
      // and subagent children, which resume under their parent's task call.
      const { items } = await nyte.sessions.list({ parent: null });
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
