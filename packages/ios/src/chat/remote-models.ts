import type { NyteClient } from "@nyte-ai/client";
import type { ModelInfo } from "@nyte-ai/protocol";
import { useCallback, useEffect, useRef, useState } from "react";
import { AppState } from "react-native";
import { describeHostError } from "../connection/connection.ts";

type ModelCatalogState =
  | { kind: "loading" }
  | { kind: "failed"; message: string }
  | { kind: "ready"; models: readonly ModelInfo[]; defaultModel: ModelInfo | undefined };

export function useModelCatalog(client: NyteClient, open: boolean) {
  const [view, setView] = useState<{ client: NyteClient; catalog: ModelCatalogState }>();
  const request = useRef<{ client: NyteClient } | undefined>(undefined);
  const refresh = useCallback(() => {
    if (request.current?.client === client) return;
    const attempt = { client };
    request.current = attempt;
    setView({ client, catalog: { kind: "loading" } });
    void Promise.all([client.provider.models.list(), client.provider.models.default()])
      .then(([models, defaultModel]) => {
        if (request.current !== attempt) return;
        setView({ client, catalog: { kind: "ready", models, defaultModel } });
      })
      .catch((cause: unknown) => {
        if (request.current !== attempt) return;
        setView({ client, catalog: { kind: "failed", message: describeHostError(cause) } });
      })
      .finally(() => {
        if (request.current === attempt) request.current = undefined;
      });
  }, [client]);

  useEffect(() => {
    refresh();
    const subscription = AppState.addEventListener("change", (status) => {
      if (status === "active") refresh();
    });
    return () => {
      request.current = undefined;
      subscription.remove();
    };
  }, [refresh]);

  useEffect(() => {
    if (open) refresh();
  }, [open, refresh]);

  const catalog: ModelCatalogState = view?.client === client ? view.catalog : { kind: "loading" };
  return { catalog, refresh };
}
