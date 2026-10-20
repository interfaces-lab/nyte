import type { ModelCatalogView, ModelInfo, ModelListing, ModelRef, Thinking } from "@nyte-ai/sdk";

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
  readonly listing: ModelListing;
  readonly listed: boolean;
}

export interface ListingChange {
  readonly models: readonly ModelRef[];
  readonly listing: ModelListing;
}

export function applyListings(
  view: ModelCatalogView,
  changes: readonly ListingChange[],
): ModelCatalogView {
  if (changes.length === 0) return view;

  return {
    ...view,
    providers: view.providers.map((provider) => {
      const listings = new Map(Object.entries(provider.listings));

      for (const { models, listing } of changes)
        for (const model of models) {
          if (model.provider !== provider.id) continue;

          if (listing === "shown") listings.delete(model.id);
          else listings.set(model.id, listing);
        }

      return { ...provider, listings: Object.fromEntries(listings) };
    }),
  };
}

export interface DesktopCatalog {
  readonly providers: readonly ProviderStatus[];
  readonly models: readonly DesktopModelOption[];
  readonly defaults?: { readonly model: ModelRef };
}

export function toDesktopCatalog(view: ModelCatalogView): DesktopCatalog {
  const models = view.providers.flatMap((provider) =>
    provider.models.map((model): DesktopModelOption => {
      const listing = provider.listings[model.ref.id] ?? "shown";

      return {
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
        listing,
        listed: provider.credential !== "missing" && listing !== "hidden",
      };
    }),
  );

  return {
    providers: view.providers,
    models,
    ...(view.default === null ? {} : { defaults: { model: view.default } }),
  };
}
