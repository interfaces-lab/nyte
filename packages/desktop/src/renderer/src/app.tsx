import { QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider } from "@tanstack/react-router";
import { lazy, Suspense, useEffect } from "react";
import type { ReactElement } from "react";
import { toast } from "@nyte-ai/ui/sonner";
import { keys, loadLocalResources, queryClient } from "./queries.ts";
import { router, Shell } from "./router";
import { nyte } from "./nyte.ts";
import { applyBrowserEvent } from "./workbench/browser-surfaces.ts";
import { applyTerminalEvent } from "./workbench/terminal-store.ts";
import { handleOpenOutcome } from "./chrome/open-workspace.tsx";

const Toaster = lazy(() =>
  import("./components/toaster.tsx").then((module) => ({ default: module.Toaster })),
);

/** Host events reshape the world; queries re-read it. */
function useHostEvents(): void {
  useEffect(() => {
    return nyte.host.onEvent((event) => {
      switch (event.kind) {
        case "workspace_trust_required":
          handleOpenOutcome({ kind: "needs_trust", path: event.path });
          return;
        case "workspace_opened":
        case "workspace_closed":
          // The route owns availability and replacement semantics. A host
          // event only refreshes caches, then asks the active route to decide
          // again against the newest host state.
          void loadLocalResources()
            .then(() => router.invalidate())
            .catch(() => undefined);
          return;
        case "catalog_changed":
          void queryClient.invalidateQueries({ queryKey: keys.catalog });
          void queryClient.invalidateQueries({ queryKey: keys.pluginCatalog });
          return;
        case "github_changed":
          void queryClient.invalidateQueries({ queryKey: keys.github });
          return;
        case "status":
          toast(event.message);
          return;
        case "browser_changed":
        case "browser_download_refused":
          applyBrowserEvent(event);
          return;
        case "terminal_data":
        case "terminal_exit":
          applyTerminalEvent(event);
          return;
        default: {
          const _exhaustive: never = event;
          return _exhaustive;
        }
      }
    });
  }, []);
}

export function App(): ReactElement {
  useHostEvents();
  return (
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <Shell />
        <Suspense fallback={null}>
          <Toaster />
        </Suspense>
      </RouterContextProvider>
    </QueryClientProvider>
  );
}
