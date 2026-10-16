import { QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider } from "@tanstack/react-router";
import type { ReactElement } from "react";
import type { SessionId } from "@nyte-ai/sdk";
import { Toaster, toast } from "@nyte-ai/ui/toast";
import { keys, loadLocalResources, queryClient } from "./queries.ts";
import { Shell } from "./router.tsx";
import type { AppRouter } from "./router.tsx";
import { nyte } from "./nyte.ts";
import { useMountEffect } from "./use-mount-effect.ts";
import { windowTabs } from "./tabs/window-tabs.ts";
import { activeSelection } from "./layout/pane-layout.ts";
import {
  applyBrowserEvent,
  applyBrowserAgentOpened,
  applyBrowserKey,
} from "./workbench/browser-surfaces.ts";
import { applyBrowserHistory } from "./workbench/browser-history.ts";
import { workbenchController } from "./workbench/controller.ts";
import { requestTrust } from "./chrome/open-workspace.tsx";
import { acceptHostSettings } from "./preferences/host.ts";
import { watchClientPlugins } from "./client-plugins.tsx";

function focusedSession(): SessionId | undefined {
  const selection = activeSelection(windowTabs.controller().getSnapshot().layout);

  return selection.kind === "session" ? selection.sessionId : undefined;
}

/**
 * Host events reshape the world; queries re-read it. A folder opening or
 * closing only refreshes caches, then asks the active route to decide again
 * against the newest host state.
 */
function useHostEvents(router: AppRouter): void {
  useMountEffect(() => {
    const unsubscribe = nyte.host.onEvent((event) => {
      switch (event.kind) {
        case "workspace_trust_required":
          requestTrust(event.path);

          return;
        case "workspace_opened":
        case "workspace_closed":
          void loadLocalResources()
            .then(() => router.invalidate())
            .catch(() => undefined);

          return;
        case "update_changed":
          queryClient.setQueryData(keys.updates, event.state);

          return;
        case "settings_changed":
          acceptHostSettings(event.settings);

          return;
        case "github_changed":
          void queryClient.invalidateQueries({ queryKey: keys.github });

          return;
        case "server_changed":
          void queryClient.invalidateQueries({ queryKey: keys.server });

          return;
        case "remote_access_changed":
          void queryClient.invalidateQueries({ queryKey: keys.remoteAccess });

          return;
        case "status":
          toast.add({ title: event.message });

          return;
        case "browser_changed":
        case "browser_download":
        case "browser_open_tab":
        case "browser_login_requested":
          applyBrowserEvent(event);

          return;
        case "browser_key":
          applyBrowserKey(event);

          return;
        case "browser_history_changed":
          applyBrowserHistory(event);

          return;
        case "browser_agent_opened":
          applyBrowserAgentOpened(workbenchController, event);

          return;
        default: {
          const _exhaustive: never = event;

          return _exhaustive;
        }
      }
    });

    return unsubscribe;
  });
}

function useClientPlugins(): void {
  useMountEffect(() => watchClientPlugins(focusedSession, windowTabs.subscribe));
}

export function App({ appIcon, router }: { appIcon: string; router: AppRouter }): ReactElement {
  useHostEvents(router);
  useClientPlugins();
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
        <Shell appIcon={appIcon} />
        <Toaster />
      </RouterContextProvider>
    </QueryClientProvider>
  );
}
