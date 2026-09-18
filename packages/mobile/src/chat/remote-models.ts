import type { NyteClient } from "@nyte-ai/client";
import type { ModelInfo } from "@nyte-ai/protocol";
import { useQuery } from "@tanstack/react-query";
import { describeHostError } from "../connection/connection.ts";

type ModelCatalogState =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; models: readonly ModelInfo[]; defaultModel: ModelInfo | undefined };

export function useModelCatalog(client: NyteClient, enabled = true) {
  const query = useQuery({
    queryKey: ["models"],
    enabled,
    queryFn: async () => {
      const [models, defaultModel] = await Promise.all([
        client.provider.models.list(),
        client.provider.models.default(),
      ]);
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
