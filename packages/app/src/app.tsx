import { QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import type { ReactElement } from "react";
import type { SessionId } from "@nyte-ai/sdk";
import { AppIcon } from "./components/app-icon.ts";
import { nyte } from "./contract/nyte.ts";
import { keys, queryClient } from "./data/query-client.ts";
import type { HostState } from "./contract/bridge.ts";
import { Shell } from "./shell/shell.tsx";
import type { AppRouter } from "./shell/routes.tsx";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { windowTabs } from "./tabs/window-tabs.ts";
import { activeSelection } from "./panes/pane-layout.ts";
import { homeFolder, subscribeHomeFolder } from "./data/workspaces.ts";
import { WORKBENCH_HOME_VIEW_KEY, workspacePathForView } from "./workbench/paths.ts";
import { workbench } from "./workbench/store.ts";
import { watchUnsavedEdits } from "./editor/file-store.ts";
import { reattachShells } from "./workbench/terminal/terminal-store.ts";
import { watchClientPlugins } from "./canvas/client-plugins.tsx";
import { paceTranscripts } from "./data/chat-store.ts";
import { releaseStartupReads } from "./data/startup.ts";
import { chatWindow, followStage, viewedChat } from "./window/index.ts";
import { useHostEvents } from "./shell/host-events.ts";

function focusedSession(): SessionId | undefined {
  const selection = activeSelection(windowTabs.panes().layout.getSnapshot());

  return selection.kind === "session" ? selection.sessionId : undefined;
}

function useClientPlugins(): void {
  useMountEffect(() => watchClientPlugins(focusedSession, windowTabs.subscribe));
}

function useChatWindowStage(router: AppRouter): void {
  useMountEffect(() => {
    paceTranscripts(() => chatWindow.getSnapshot().shown);

    return followStage(router);
  });
}

function useViewedChat(): void {
  useMountEffect(() => {
    const attention = nyte.host.attention;

    if (attention === undefined) return undefined;
    let reported: SessionId | null | undefined;

    const report = (): void => {
      const viewed = viewedChat(windowTabs.getSnapshot());

      if (viewed === reported) return;
      reported = viewed;
      attention.viewing(viewed);
    };

    report();

    return windowTabs.subscribe(report);
  });
}

function useShownWorkspace(): void {
  useMountEffect(() => {
    const show = nyte.host.setWorkspacePath;

    if (show === undefined) return undefined;
    let reported: string | null | undefined;

    const report = (): void => {
      const path = queryClient.getQueryData<HostState>(keys.host)?.workspace?.path ?? null;

      if (path === reported) return;
      reported = path;
      show(path);
    };

    report();

    return queryClient.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] === keys.host[0]) report();
    });
  });
}

function useHomeWorkbench(): void {
  useMountEffect(() => {
    const fold = (): void => {
      const home = homeFolder();

      if (home !== undefined) workbench.move(WORKBENCH_HOME_VIEW_KEY, home.path);
    };

    fold();

    return subscribeHomeFolder(fold);
  });
}

function useSavedShells(): void {
  useMountEffect(() => {
    reattachShells(
      [...workbench.getSnapshot().views].flatMap(([key, view]) =>
        view.tabs.flatMap((tab) =>
          tab.kind === "terminal" && tab.owner.kind === "user"
            ? [{ id: tab.id, workspacePath: workspacePathForView(key) ?? null }]
            : [],
        ),
      ),
    );
  });
}

export function App({ appIcon, router }: { appIcon: string; router: AppRouter }): ReactElement {
  useHostEvents();
  useChatWindowStage(router);
  useClientPlugins();
  useViewedChat();
  useShownWorkspace();
  useHomeWorkbench();
  useSavedShells();
  useMountEffect(() => watchUnsavedEdits((held) => nyte.host.setUnsavedEdits?.(held)));
  useMountEffect(releaseStartupReads);
  useMountEffect(() => {
    const frame = requestAnimationFrame(() => {
      performance.mark("nyte:shell-ready");
      performance.measure("nyte:startup-to-shell", "nyte:startup", "nyte:shell-ready");
    });

    return () => cancelAnimationFrame(frame);
  });

  return (
    <MotionConfig reducedMotion="user">
      <QueryClientProvider client={queryClient}>
        <RouterContextProvider router={router}>
          <AppIcon value={appIcon}>
            <Shell appIcon={appIcon} />
          </AppIcon>
        </RouterContextProvider>
      </QueryClientProvider>
    </MotionConfig>
  );
}
