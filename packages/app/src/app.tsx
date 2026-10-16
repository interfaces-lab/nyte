import { QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider } from "@tanstack/react-router";
import type { ReactElement } from "react";
import type { SessionId } from "@nyte-ai/sdk";
import { Toaster, toast } from "@nyte-ai/ui/toast";
import { keys, loadLocalResources, queryClient } from "./queries.ts";
import { currentRouteSession, Shell } from "./router.tsx";
import type { AppRouter } from "./router.tsx";
import { nyte } from "./nyte.ts";
import type { HostState } from "./nyte.ts";
import { useMountEffect } from "./use-mount-effect.ts";
import { activePaneController, paneControllerForWorkspace } from "./layout/pane-context.tsx";
import { windowTabs } from "./tabs/window-tabs.ts";
import { BLANK_SELECTION, activeSelection } from "./layout/pane-layout.ts";
import {
  applyBrowserEvent,
  applyBrowserAgentOpened,
  applyBrowserKey,
} from "./workbench/browser-surfaces.ts";
import { applyBrowserHistory } from "./workbench/browser-history.ts";
import { workbenchController } from "./workbench/controller.ts";
import { applyTerminalEvent } from "./workbench/terminal-store.ts";
import { requestTrust } from "./chrome/open-workspace.tsx";
import { acceptHostSettings } from "./preferences/host.ts";
import { mountClientPlugins, observeRunEnds } from "./client-plugins.tsx";
import { directoryWatch } from "./sdk.tsx";

/**
 * The route owns what the stage shows. A folder the host opened on its own
 * (Open folder…, a trust grant) binds a controller nobody selected into; the
 * current route is applied to it, as a sidebar click applies its selection
 * before it navigates.
 */
function bindRouteToOpenFolder(router: AppRouter): void {
  // A window tab keeps its own places whichever folder is current.
  if (windowTabs.enabled) return;
  const workspacePath = queryClient.getQueryData<HostState>(keys.host)?.workspace?.path;
  const sessionId = currentRouteSession(router);
  paneControllerForWorkspace(workspacePath).syncSelection(
    sessionId === undefined ? BLANK_SELECTION : { kind: "session", sessionId },
  );
}

function focusedSession(): SessionId | undefined {
  const workspacePath = queryClient.getQueryData<HostState>(keys.host)?.workspace?.path;
  const selection = activeSelection(activePaneController(workspacePath).getSnapshot().layout);

  return selection.kind === "session" ? selection.sessionId : undefined;
}

/** Host events reshape the world; queries re-read it. */
function useHostEvents(router: AppRouter): void {
  useMountEffect(() => {
    const unsubscribe = nyte.host.onEvent((event) => {
      switch (event.kind) {
        case "workspace_trust_required":
          requestTrust(event.path);

          return;
        case "workspace_opened":
        case "workspace_closed":
          // The route owns availability and replacement semantics. A host
          // event only refreshes caches, then asks the active route to decide
          // again against the newest host state.
          void loadLocalResources()
            .then(() => {
              bindRouteToOpenFolder(router);

              return router.invalidate();
            })
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

    return unsubscribe;
  });
}

function useClientPlugins(): void {
  useMountEffect(() => {
    mountClientPlugins(focusedSession);
    const directory = directoryWatch("all");
    let previous = directory.value ?? [];

    return directory.subscribe(() => {
      const next = directory.value ?? [];
      observeRunEnds(previous, next);
      previous = next;
    });
  });
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
