import type { ModelCatalogView, ModelInfo, ModelRef, Thinking } from "@nyte-ai/sdk";

export type ProviderStatus = ModelCatalogView["providers"][number];

export interface DesktopModelOption {
  readonly key: string;
  readonly provider: string;
  readonly id: string;
  readonly name: string;
  readonly contextWindow: number;
  readonly cost: ModelInfo["cost"];
  readonly thinkingLevels: readonly Thinking[];
  readonly defaultThinking: Thinking;
  readonly fastMode:
    | { readonly kind: "unavailable" }
    | { readonly kind: "available"; readonly id: string };
  readonly input: ModelInfo["input"];
  readonly capabilities: ModelInfo["capabilities"];
  readonly listed: boolean;
}

export interface DesktopCatalog {
  readonly providers: readonly ProviderStatus[];
  readonly models: readonly DesktopModelOption[];
  readonly defaults?: { readonly model: ModelRef };
}

export function toDesktopCatalog(view: ModelCatalogView): DesktopCatalog {
  const models = view.providers.flatMap((provider) =>
    provider.models.map((model): DesktopModelOption => ({
      key: `${model.ref.provider}/${model.ref.id}`,
      provider: model.ref.provider,
      id: model.ref.id,
      name: model.name,
      contextWindow: model.contextWindow,
      cost: model.cost,
      thinkingLevels: model.thinking,
      defaultThinking: model.defaultThinking,
      fastMode:
        model.fast === null ? { kind: "unavailable" } : { kind: "available", id: model.fast.id },
      input: model.input,
      capabilities: model.capabilities,
      listed: provider.credential !== "missing",
    })),
  );

  return {
    providers: view.providers,
    models,
    ...(view.default === null ? {} : { defaults: { model: view.default } }),
  };
}
