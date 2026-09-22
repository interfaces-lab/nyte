import { QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { toast } from "@nyte-ai/ui/sonner";
import { keys, loadLocalResources, queryClient } from "./queries.ts";
import { currentRouteSession, router, Shell } from "./router";
import { nyte } from "./nyte.ts";
import type { HostState } from "./nyte.ts";
import { useMountEffect } from "./use-mount-effect.ts";
import { paneControllerForWorkspace } from "./layout/pane-context.tsx";
import { BLANK_SELECTION } from "./layout/pane-layout.ts";
import { applyBrowserEvent, applyBrowserAgentOpened } from "./workbench/browser-surfaces.ts";
import { applyTerminalEvent } from "./workbench/terminal-store.ts";
import { handleOpenOutcome } from "./chrome/open-workspace.tsx";
import { applyLoginEvent } from "./chrome/login-attempts.ts";

import { Toaster } from "./components/toaster.tsx";

/**
 * The route owns what the stage shows. A folder the host opened on its own
 * (Open folder…, a trust grant) binds a controller nobody selected into; the
 * current route is applied to it, as a sidebar click applies its selection
 * before it navigates.
 */
function bindRouteToOpenFolder(): void {
  const workspacePath = queryClient.getQueryData<HostState>(keys.host)?.workspace?.path;
  const sessionId = currentRouteSession();
  paneControllerForWorkspace(workspacePath).syncSelection(
    sessionId === undefined ? BLANK_SELECTION : { kind: "session", sessionId },
  );
}

/** Host events reshape the world; queries re-read it. */
function useHostEvents(): void {
  useMountEffect(() => {
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
            .then(() => {
              bindRouteToOpenFolder();

              return router.invalidate();
            })
            .catch(() => undefined);

          return;
        case "catalog_changed":
          void queryClient.invalidateQueries({ queryKey: keys.catalog });
          void queryClient.invalidateQueries({ queryKey: keys.pluginCatalog });

          return;
        case "github_changed":
          void queryClient.invalidateQueries({ queryKey: keys.github });

          return;
        case "login_progress":
          applyLoginEvent(event);

          return;
        case "server_changed":
          void queryClient.invalidateQueries({ queryKey: keys.server });
          void queryClient.invalidateQueries({ queryKey: keys.catalog });
          void queryClient.invalidateQueries({ queryKey: keys.sessionDirectory });

          return;
        case "mobile_share_changed":
          void queryClient.invalidateQueries({ queryKey: keys.mobileShare });

          return;
        case "status":
          toast(event.message);

          return;
        case "browser_changed":
        case "browser_download_refused":
          applyBrowserEvent(event);

          return;
        case "browser_agent_opened":
          applyBrowserAgentOpened(event);

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
  });
}

export function App(): ReactElement {
  useHostEvents();
  useMountEffect(() => {
    const frame = requestAnimationFrame(() => {
      performance.mark("nyte:shell-ready");
      performance.measure("nyte:startup-to-shell", "nyte:startup", "nyte:shell-ready");
    });

    return () => cancelAnimationFrame(frame);
  });

  return (
    <QueryClientProvider client={queryClient}>
      <RouterContextProvider router={router}>
        <Shell />
        <Toaster />
      </RouterContextProvider>
    </QueryClientProvider>
  );
}
