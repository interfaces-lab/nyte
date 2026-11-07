import { QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider } from "@tanstack/react-router";
import { MotionConfig } from "motion/react";
import type { ReactElement } from "react";
import type { SessionId } from "@nyte-ai/sdk";
import { AppIcon } from "./components/app-icon.ts";
import { nyte } from "./contract/nyte.ts";
import { queryClient } from "./data/query-client.ts";
import { Shell } from "./shell/shell.tsx";
import type { AppRouter } from "./shell/routes.tsx";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { windowTabs } from "./tabs/window-tabs.ts";
import { activeTab, tabPlace } from "./tabs/model.ts";
import { activeSelection } from "./panes/pane-layout.ts";
import { workspacePathForView } from "./workbench/paths.ts";
import { workbench } from "./workbench/store.ts";
import { reattachShells } from "./workbench/terminal/terminal-store.ts";
import { watchClientPlugins } from "./canvas/client-plugins.tsx";
import { paceTranscripts } from "./data/chat-store.ts";
import { chatWindow, followStage } from "./window/index.ts";
import { useHostEvents } from "./shell/host-events.ts";

function focusedSession(): SessionId | undefined {
  const selection = activeSelection(windowTabs.controller().getSnapshot());

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
      const place = tabPlace(activeTab(windowTabs.getSnapshot()));
      const viewed = place.kind === "session" ? place.sessionId : null;

      if (viewed === reported) return;
      reported = viewed;
      attention.viewing(viewed);
    };

    report();

    return windowTabs.subscribe(report);
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
  useSavedShells();
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
