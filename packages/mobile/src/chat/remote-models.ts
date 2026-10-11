import type { Connection, ModelInfo } from "@nyte-ai/sdk";
import { useQuery } from "@tanstack/react-query";
import { describeHostError } from "../connection/connection.ts";

type ModelCatalogState =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; models: readonly ModelInfo[]; defaultModel: ModelInfo | undefined };

export function useModelCatalog(client: Connection, enabled = true) {
  const query = useQuery({
    queryKey: ["models"],
    enabled,
    queryFn: async () => {
      const catalog = await client.models.list();
      const models = catalog.providers.flatMap((provider) => provider.models);

      const defaultModel = models.find(
        (model) =>
          model.ref.provider === catalog.default?.provider && model.ref.id === catalog.default.id,
      );

      return { models, defaultModel };
    },
  });

  const catalog: ModelCatalogState =
    query.status === "pending"
      ? { kind: "loading" }
      : query.status === "error"
        ? { kind: "failed", message: describeHostError(query.error) }
        : { kind: "ready", models: query.data.models, defaultModel: query.data.defaultModel };

  return { catalog, refresh: query.refetch };
}
