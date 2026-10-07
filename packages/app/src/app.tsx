import { QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider } from "@tanstack/react-router";
import type { ReactElement } from "react";
import type { SessionId } from "@nyte-ai/protocol";
import { Toaster, toast } from "@nyte-ai/ui/toast";
import { keys, loadLocalResources, queryClient, RECORDED_STARTS } from "./queries.ts";
import { currentRouteSession, Shell } from "./router.tsx";
import type { AppRouter } from "./router.tsx";
import { nyte } from "./nyte.ts";
import type { HostState } from "./nyte.ts";
import { useMountEffect } from "./use-mount-effect.ts";
import { activePaneController, paneControllerForWorkspace } from "./layout/pane-context.tsx";
import type { PaneController } from "./layout/pane-controller.ts";
import { windowTabs } from "./tabs/window-tabs.ts";
import { BLANK_SELECTION, activePane, activeSelection } from "./layout/pane-layout.ts";
import { reviewRecordedStarts } from "./recorded-starts.ts";
import type { StartNotice } from "./recorded-starts.ts";
import { applyBrowserEvent, applyBrowserAgentOpened } from "./workbench/browser-surfaces.ts";
import { applyTerminalEvent } from "./workbench/terminal-store.ts";
import { requestTrust } from "./chrome/open-workspace.tsx";
import { applyLoginEvent } from "./chrome/login-attempts.ts";
import { acceptHostSettings } from "./preferences/host.ts";

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
        case "catalog_changed":
          void queryClient.invalidateQueries({ queryKey: keys.catalog });
          void queryClient.invalidateQueries({ queryKey: keys.pluginCatalog });

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
        case "login_progress":
          applyLoginEvent(event);

          return;
        case "server_changed":
          void queryClient.invalidateQueries({ queryKey: keys.server });
          void queryClient.invalidateQueries({ queryKey: keys.catalog });

          return;
        // Folded by the directory feed, which subscribed before this shell mounted.
        case "session_directory":
          return;
        case "remote_access_changed":
          void queryClient.invalidateQueries({ queryKey: keys.remoteAccess });

          return;
        case "status":
          toast.add({ title: event.message });

          return;
        case "starts_changed":
          void queryClient.invalidateQueries({ queryKey: RECORDED_STARTS });
          reviewStarts(router);

          return;
        case "browser_changed":
        case "browser_download":
        case "browser_open_tab":
        case "browser_find_requested":
        case "browser_login_requested":
          applyBrowserEvent(event);

          return;
        case "browser_agent_opened":
          applyBrowserAgentOpened(event, focusedSession());

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

    // Answers that arrived before this shell mounted are on record; act on them now.
    reviewStarts(router);

    return unsubscribe;
  });
}

let reviewing: Promise<void> = Promise.resolve();

/** Answered root starts, one review at a time, so a refused message comes back once. */
function reviewStarts(router: AppRouter): void {
  const starts = nyte.host.starts;

  if (starts === undefined) return;
  reviewing = reviewing
    .then(async () => {
      const host = await nyte.host.state();
      const controller = activePaneController(host.workspace?.path);

      const notices = await reviewRecordedStarts({
        starts,
        restore: (composer) =>
          controller.viewState.restoreBlank(activePane(controller.getSnapshot().layout).id, {
            composer,
            updatedAt: Date.now(),
          }),
      });

      for (const notice of notices) showStartNotice(router, controller, notice);
    })
    .catch(() => undefined);
}

function showStartNotice(router: AppRouter, controller: PaneController, notice: StartNotice): void {
  switch (notice.kind) {
    case "accepted": {
      const id = toast.add({
        type: "success",
        title: "Chat started",
        description: notice.preview,
        actionProps: {
          children: "Open",
          onClick: () => {
            toast.close(id);
            controller.selectSession(notice.sessionId);
            void router.navigate({
              to: "/session/$sessionId",
              params: { sessionId: notice.sessionId },
            });
          },
        },
      });

      return;
    }

    case "refused":
      toast.add({
        type: "error",
        title: "Chat didn’t start",
        description: `${notice.message} The message is back in your drafts.`,
        timeout: 0,
      });

      return;
    default: {
      const _exhaustive: never = notice;

      return _exhaustive;
    }
  }
}

export function App({ appIcon, router }: { appIcon: string; router: AppRouter }): ReactElement {
  useHostEvents(router);
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
