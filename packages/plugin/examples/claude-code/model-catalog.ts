import type { Model } from "@nyte-ai/ai";
import { Type } from "typebox";
import type { Static } from "typebox";

export const PROVIDER_ID = "anthropic";

export const API_ID = "claude-code-stream-json";

export type ClaudeCodeModel = Model<typeof API_ID>;

export const discoveredModelSchema = Type.Object({
  value: Type.String(),
  resolvedModel: Type.Optional(Type.String()),
  displayName: Type.String(),
  description: Type.String(),
  supportsEffort: Type.Optional(Type.Boolean()),
  supportedEffortLevels: Type.Optional(
    Type.Array(
      Type.Union([
        Type.Literal("low"),
        Type.Literal("medium"),
        Type.Literal("high"),
        Type.Literal("xhigh"),
        Type.Literal("max"),
      ]),
    ),
  ),
  supportsAdaptiveThinking: Type.Optional(Type.Boolean()),
  supportsFastMode: Type.Optional(Type.Boolean()),
  supportsAutoMode: Type.Optional(Type.Boolean()),
});

export type DiscoveredClaudeModel = Static<typeof discoveredModelSchema>;

function withoutContextSuffix(model: string): string {
  return model.replace(/\[1m\]$/u, "");
}

function fromBuiltin(id: string, builtin: Model<"anthropic-messages">): ClaudeCodeModel {
  const {
    api: _api,
    provider: _provider,
    baseUrl: _baseUrl,
    compat: _compat,
    ...metadata
  } = builtin;

  return {
    ...metadata,
    id,
    name: id === "default" ? `Default (${builtin.name})` : builtin.name,
    api: API_ID,
    provider: PROVIDER_ID,
    baseUrl: "process://claude-code",
  };
}

export function createClaudeModelCatalog() {
  const BUILTIN_ANTHROPIC_MODELS = new Map<string, Model<"anthropic-messages">>();

  function restoreAnthropicModels(models: readonly Model<"anthropic-messages">[]): void {
    BUILTIN_ANTHROPIC_MODELS.clear();

    for (const model of models) BUILTIN_ANTHROPIC_MODELS.set(model.id, model);
  }

  const models = new Map<
    string,
    {
      readonly route: string;
      readonly nativeToolChanges: boolean;
      readonly adaptiveThinking: boolean;
    }
  >();

  const FALLBACK_DISCOVERY: DiscoveredClaudeModel[] = [
    {
      value: "default",
      resolvedModel: "claude-opus-5-5[1m]",
      displayName: "Default (recommended)",
      description: "Opus 5.5 with 1M context · Best for everyday, complex tasks",
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
      supportsAdaptiveThinking: true,
      supportsFastMode: true,
      supportsAutoMode: true,
    },
    {
      value: "opus[1m]",
      resolvedModel: "claude-opus-5-5[1m]",
      displayName: "Opus (1M context)",
      description: "Opus 5.5 with 1M context · Best for everyday, complex tasks",
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
      supportsAdaptiveThinking: true,
      supportsFastMode: true,
      supportsAutoMode: true,
    },
    {
      value: "claude-fable-5-1[1m]",
      resolvedModel: "claude-fable-5-1",
      displayName: "Fable",
      description: "Fable 5.1 · Most capable for the hardest and longest-running tasks",
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
      supportsAdaptiveThinking: true,
      supportsAutoMode: true,
    },
    {
      value: "sonnet",
      resolvedModel: "claude-sonnet-5",
      displayName: "Sonnet",
      description: "Sonnet 5 · Efficient for routine tasks",
      supportsEffort: true,
      supportedEffortLevels: ["low", "medium", "high", "xhigh", "max"],
      supportsAdaptiveThinking: true,
      supportsAutoMode: true,
    },
    {
      value: "haiku",
      resolvedModel: "claude-haiku-4-5-20251001",
      displayName: "Haiku",
      description: "Haiku 4.5 · Fastest for quick answers",
    },
  ];

  const ALIASES: Record<string, string> = {
    sonnet: "claude-sonnet-5",
    haiku: "claude-haiku-4-5-20251001",
    "claude-haiku-4-5": "claude-haiku-4-5-20251001",
    opus: "claude-opus-5-5",
    fable: "claude-fable-5-1",
  };

  function canonicalModelId(info: DiscoveredClaudeModel): string {
    if (info.value === "default") return "default";

    return withoutContextSuffix(
      info.resolvedModel || ALIASES[withoutContextSuffix(info.value)] || info.value,
    );
  }

  function fallbackModel(info: DiscoveredClaudeModel, id: string): ClaudeCodeModel {
    const supported = info.supportedEffortLevels;

    const thinkingLevelMap = supported?.length
      ? Object.fromEntries(supported.map((level) => [level, level]))
      : undefined;

    return {
      id,
      name: `${info.displayName} (Claude Code)`,
      api: API_ID,
      provider: PROVIDER_ID,
      baseUrl: "process://claude-code",
      reasoning: info.supportsAdaptiveThinking === true || info.supportsEffort === true,
      ...(thinkingLevelMap ? { thinkingLevelMap } : {}),
      input: ["text", "image"],
      cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
      contextWindow: /\b1M context\b/iu.test(info.description) ? 1_000_000 : 200_000,
      maxTokens: 64_000,
    };
  }

  function modelFromDiscovery(info: DiscoveredClaudeModel): ClaudeCodeModel {
    const id = canonicalModelId(info);
    const builtinId = id === "default" ? withoutContextSuffix(info.resolvedModel || "") : id;
    const builtin = BUILTIN_ANTHROPIC_MODELS.get(builtinId);
    models.set(id, {
      route: info.value,
      nativeToolChanges: builtin?.compat?.supportsMidConvoToolChanges === true,
      adaptiveThinking: info.supportsAdaptiveThinking === true,
    });

    return builtin ? fromBuiltin(id, builtin) : fallbackModel(info, id);
  }

  function fallbackClaudeModels(): ClaudeCodeModel[] {
    return FALLBACK_DISCOVERY.map(modelFromDiscovery);
  }

  function nativeModel(model: string): string {
    const direct = models.get(model)?.route;

    if (direct) return direct;

    if (model === "default") return model;
    const canonical = canonicalRoute(model);

    return model.endsWith("[1m]") ? `${canonical}[1m]` : canonical;
  }

  function canonicalRoute(model: string): string {
    const withoutSuffix = withoutContextSuffix(model);

    return ALIASES[withoutSuffix] ?? withoutSuffix;
  }

  function supportsAdaptiveThinking(model: string): boolean {
    const canonical = canonicalRoute(model);

    return models.get(model)?.adaptiveThinking ?? models.get(canonical)?.adaptiveThinking ?? true;
  }

  function supportsNativeToolChanges(model: string): boolean {
    const canonical = canonicalRoute(model);

    return (
      models.get(model)?.nativeToolChanges ??
      models.get(canonical)?.nativeToolChanges ??
      BUILTIN_ANTHROPIC_MODELS.get(canonical)?.compat?.supportsMidConvoToolChanges === true
    );
  }

  return {
    restoreAnthropicModels,
    modelFromDiscovery,
    fallbackClaudeModels,
    nativeModel,
    supportsAdaptiveThinking,
    supportsNativeToolChanges,
  };
}

export type ClaudeModelCatalog = ReturnType<typeof createClaudeModelCatalog>;
