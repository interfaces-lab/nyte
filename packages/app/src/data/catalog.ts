import { useMutation, useMutationState, useQuery, useQueryClient } from "@tanstack/react-query";
import type { MutationState } from "@tanstack/react-query";
import { toast } from "@nyte-ai/ui/toast";
import type {
  ModelCatalogView,
  ModelInfo,
  ModelListing,
  ModelRef,
  SessionId,
  Thinking,
} from "@nyte-ai/sdk";
import { connected } from "./connection.ts";
import { keys, queryClient } from "./query-client.ts";
import { hostWatch } from "./watches.ts";
import { useWatchSelect } from "./watch-store.ts";

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

export const readModelCatalog = async () => (await connected()).models.list();

function newestCatalogQuery() {
  return queryClient
    .getQueryCache()
    .findAll({ queryKey: ["catalog", "models"] })
    .filter((query) => query.state.data !== undefined)
    .toSorted((left, right) => right.state.dataUpdatedAt - left.state.dataUpdatedAt)
    .at(0);
}

export function newestModelCatalog(): ModelCatalogView | undefined {
  const newest = newestCatalogQuery();

  return newest === undefined
    ? undefined
    : queryClient.getQueryData<ModelCatalogView>(newest.queryKey);
}

const DEFAULT_MODEL_MUTATION = ["catalog", "default"] as const;

const MODEL_LISTING_MUTATION = ["catalog", "listing"] as const;

export async function readStartCatalog(): Promise<DesktopCatalog> {
  const newest = newestCatalogQuery();

  const live =
    newest !== undefined && newest.state.dataUpdatedAt > 0
      ? queryClient.getQueryData<ModelCatalogView>(newest.queryKey)
      : undefined;

  return toDesktopCatalog(live ?? (await readModelCatalog()));
}

export function useCatalogGeneration(): string {
  return useWatchSelect(hostWatch("host"), (state) => state.value?.catalog) ?? "initial";
}

export function useCatalog(_sessionId?: SessionId) {
  const generation = useCatalogGeneration();

  const pending = useMutationState<MutationState<unknown, Error, ModelRef>>({
    filters: { mutationKey: DEFAULT_MODEL_MUTATION, status: "pending" },
  });

  const listings = useMutationState<MutationState<unknown, Error, ListingChange>>({
    filters: { mutationKey: MODEL_LISTING_MUTATION, status: "pending" },
  });

  return useQuery({
    queryKey: keys.modelCatalog(generation),
    queryFn: readModelCatalog,
    placeholderData: (previous) => previous ?? newestModelCatalog(),
    select: (view): DesktopCatalog => {
      const catalog = toDesktopCatalog(
        applyListings(
          view,
          listings.flatMap((change) => (change.variables === undefined ? [] : [change.variables])),
        ),
      );
      const model = pending.at(-1)?.variables;

      return model === undefined || catalog.defaults === undefined
        ? catalog
        : { ...catalog, defaults: { ...catalog.defaults, model } };
    },
  });
}

export function useSetListing() {
  const client = useQueryClient();

  return useMutation({
    mutationKey: MODEL_LISTING_MUTATION,
    mutationFn: async ({ models, listing }: ListingChange) => {
      const outcome = await (await connected()).models.setListing(models, listing);

      if (outcome.kind === "unknown-model") throw new Error("That model is no longer available");
    },
    onSettled: () => client.invalidateQueries({ queryKey: ["catalog"] }),
    onError: () => toast.add({ type: "error", title: "Couldn't save the model list. Try again." }),
  });
}

export function useSetPreference() {
  const client = useQueryClient();

  return useMutation({
    mutationKey: DEFAULT_MODEL_MUTATION,
    scope: { id: "catalog-default" },
    mutationFn: async (model: ModelRef) => {
      const outcome = await (await connected()).models.setDefault(model);

      if (outcome.kind === "unknown-model") throw new Error("That model is no longer available");
    },
    onSettled: () => client.invalidateQueries({ queryKey: ["catalog"] }),
    onError: () =>
      toast.add({ type: "error", title: "Couldn't save model preferences. Try again." }),
  });
}
