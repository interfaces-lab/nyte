import { QueryClientProvider } from "@tanstack/react-query";
import { RouterContextProvider } from "@tanstack/react-router";
import type { ReactElement } from "react";
import type { SessionId } from "@nyte-ai/sdk";
import { Toaster } from "@nyte-ai/ui/toast";
import { queryClient } from "./data/query-client.ts";
import { Shell } from "./shell/shell.tsx";
import type { AppRouter } from "./shell/routes.tsx";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { windowTabs } from "./tabs/window-tabs.ts";
import { activeSelection } from "./panes/pane-layout.ts";
import { workspacePathForView } from "./workbench/paths.ts";
import { workbench } from "./workbench/store.ts";
import { reattachShells } from "./workbench/terminal/terminal-store.ts";
import { watchClientPlugins } from "./canvas/client-plugins.tsx";
import { paceTranscripts } from "./data/watches.ts";
import { chatWindow, followStage } from "./window/index.ts";
import { useHostEvents } from "./shell/host-events.ts";

function focusedSession(): SessionId | undefined {
  const selection = activeSelection(windowTabs.controller().getSnapshot().layout);

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
  useSavedShells();
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
