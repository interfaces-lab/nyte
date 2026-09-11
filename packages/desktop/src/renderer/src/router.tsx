/**
 * One mounted shell — titlebar, rail, stage — around one workspace-lifetime
 * pane stage. There is no separate home screen: with no workspace open the
 * stage shows the blank pane's "open a folder" state and the rail lists recent
 * projects, so opening a project never swaps the surface. Memory history fits
 * an Electron window with no URL bar. The shell also owns the app-wide keys —
 * ⌘N and ⌘[ return to the blank pane, ⌘B shows or hides the rail, ⌘, opens
 * Settings, ⌘D and ⇧⌘D split the stage — because the renderer owns chords.
 */
import * as stylex from "@stylexjs/stylex";
import { Tooltip } from "@nyte-ai/ui/tooltip";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Matches,
  redirect,
  useMatch,
  useRouter,
} from "@tanstack/react-router";
import { useEffect } from "react";
import { AboutDialog } from "./chrome/about-dialog.tsx";
import type { ReactElement } from "react";
import { WorkspaceDialogHost } from "./chrome/open-workspace.tsx";
import { isSettingsSection } from "./chrome/settings-navigation.tsx";
import { shellActions, useShellState } from "./chrome/shell-state.ts";
import { SidebarPane } from "./chrome/sidebar-pane.tsx";
import { Sidebar } from "./chrome/sidebar.tsx";
import { Titlebar } from "./chrome/titlebar.tsx";
import { PaneControllerProvider, usePaneActions, useCanSplitPane } from "./layout/pane-context.tsx";
import { SessionDndProvider } from "./layout/session-dnd.tsx";
import { keys, queryClient, useHostState, warmThread } from "./queries.ts";
import type { SessionPage } from "./session-directory.ts";
import { getStartupDestination, startupSession } from "./startup-preference.ts";
import { WorkspaceStage } from "./shell/workspace-stage.tsx";
import { t } from "./theme/vars.stylex.ts";
import { sessionId } from "@nyte-ai/protocol";
import { nyte } from "./nyte.ts";
import { macPlatform } from "./platform.ts";
import { activateOutbox } from "./use-outbox.ts";
import { resolveClientAction } from "../../shared/client-actions.ts";

import { CustomizeSurface } from "./chrome/customize.tsx";
import { SettingsSurface } from "./chrome/appearance-settings.tsx";

const styles = stylex.create({
  shell: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    backgroundColor: t.bgSidebar,
  },
  stage: {
    display: "flex",
    flex: 1,
    minHeight: 0,
  },
  surface: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: t.bgBase,
    overflow: "hidden",
  },
});

export function Shell(): ReactElement {
  const host = useHostState();
  const workspacePath = host.data?.workspace?.path;

  useEffect(() => {
    if (host.data === undefined) return;
    void activateOutbox(workspacePath);
  }, [host.data, workspacePath]);

  return (
    <Tooltip.Provider delay={600} closeDelay={0} timeout={400}>
      <PaneControllerProvider workspaceKey={host.data?.workspace?.path}>
        <ShellChrome />
      </PaneControllerProvider>
    </Tooltip.Provider>
  );
}

function ShellChrome(): ReactElement {
  const host = useHostState();
  const shellRouter = useRouter();
  const panes = usePaneActions();
  const canSplit = useCanSplitPane();
  const { stage: shellStage, about } = useShellState();
  const customizeOpen = shellStage.kind === "customize";
  const mac = macPlatform(host.data?.platform);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const settingsOpen = shellRouter.state.matches.some(
        (match) => match.routeId === settingsRoute.id,
      );
      const action = resolveClientAction(event, mac, settingsOpen ? "settings" : shellStage.kind);
      if (action === undefined) return;
      if (action.id === "split-right" || action.id === "split-down") {
        if (!canSplit) return;
        event.preventDefault();
        panes.split(action.id === "split-down" ? "down" : "right");
        return;
      }
      if (action.id === "focus-pane") {
        if (panes.focusNext()) event.preventDefault();
        return;
      }
      if (action.id === "new-chat") {
        event.preventDefault();
        panes.newChat();
      } else if (action.id === "back" && settingsOpen) {
        event.preventDefault();
        shellRouter.history.back();
      } else if (action.id === "back" && customizeOpen) {
        event.preventDefault();
        shellActions.showWorkspace();
      } else if (action.id === "back" && shellRouter.history.canGoBack()) {
        event.preventDefault();
        shellActions.showWorkspace();
        shellRouter.history.back();
      } else if (
        action.id === "forward" &&
        shellRouter.history.location.state.__TSR_index < shellRouter.history.length - 1
      ) {
        event.preventDefault();
        shellActions.showWorkspace();
        shellRouter.history.forward();
      } else if (action.id === "sidebar") {
        event.preventDefault();
        shellActions.toggleSidebar();
      } else if (action.id === "settings") {
        event.preventDefault();
        void shellRouter.navigate({
          to: "/settings/$section",
          params: { section: "general" },
        });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [canSplit, customizeOpen, mac, panes, shellRouter, shellStage.kind]);

  return (
    <div data-nyte-shell {...stylex.props(styles.shell)}>
      <Titlebar />
      <div
        {...stylex.props(styles.stage)}
        onClickCapture={(event) => {
          if (!customizeOpen || !(event.target instanceof Element)) return;
          const sidebarAction = event.target.closest(
            'nav[aria-label="Sessions and workspaces"] button',
          );
          if (sidebarAction === null || sidebarAction.getAttribute("aria-haspopup") === "dialog")
            return;
          shellActions.showWorkspace();
        }}
      >
        <SessionDndProvider>
          <SidebarPane>
            <Sidebar />
          </SidebarPane>
          <main {...stylex.props(styles.surface)}>
            <StageContent shellStage={shellStage} />
          </main>
        </SessionDndProvider>
      </div>
      <WorkspaceDialogHost />
      {about !== undefined && (
        <AboutDialog info={about} onClose={() => shellActions.showAbout(undefined)} />
      )}
    </div>
  );
}

function StageContent({
  shellStage,
}: {
  readonly shellStage: ReturnType<typeof useShellState>["stage"];
}): ReactElement {
  const settings = useMatch({ from: "/settings/$section", shouldThrow: false });
  if (settings !== undefined) return <Matches />;
  if (shellStage.kind === "workspace") return <Matches />;
  return <CustomizeSurface sessionId={shellStage.sessionId} />;
}

export const rootRoute = createRootRoute();

/**
 * The stage route. `workspace` is undefined until a folder opens; the stage
 * stays mounted either way and only its data binding changes.
 */
export const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_workspace",
  component: WorkspaceStage,
});

let startupDestinationPending = true;

export const indexRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/",
  beforeLoad: async () => {
    if (!startupDestinationPending) return;
    startupDestinationPending = false;
    if (getStartupDestination() === "new-chat") return;

    const sessions = queryClient.getQueryData<SessionPage>(keys.sessionPreview);
    const sessionId = startupSession(
      "last-session",
      sessions?.items.filter((session) => !session.archived) ?? [],
    );
    if (sessionId !== undefined) {
      throw redirect({
        to: threadRoute.to,
        params: { sessionId },
        replace: true,
      });
    }
  },
});

export const threadRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/session/$sessionId",
  params: {
    parse: (params) => ({ sessionId: sessionId(params.sessionId) }),
    stringify: ({ sessionId }) => ({ sessionId }),
  },
  beforeLoad: async ({ params }) => {
    const session = await nyte.sessions.get({ sessionId: params.sessionId });
    queryClient.setQueryData(keys.session(params.sessionId), session ?? null);
    if (session === undefined) throw redirect({ to: indexRoute.to, replace: true });
  },
  // Route intent and navigation both warm the coherent snapshot. The loader
  // deliberately returns now: local data may finish later and never gates the
  // pending route commit.
  loader: ({ params }) => warmThread(params.sessionId),
});

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/$section",
  pendingMs: Infinity,
  params: {
    parse: ({ section }) => {
      if (!isSettingsSection(section)) {
        throw redirect({
          to: "/settings/$section",
          params: { section: "general" },
          replace: true,
        });
      }
      return { section };
    },
    stringify: ({ section }) => ({ section }),
  },
  component: SettingsSurface,
});

const workspaceRouteTree = workspaceRoute.addChildren([indexRoute, threadRoute]);
const routeTree = rootRoute.addChildren([workspaceRouteTree, settingsRoute]);
const history = createMemoryHistory({ initialEntries: ["/"] });

export const router = createRouter({
  routeTree,
  history,
  defaultPreload: "intent",
  defaultPreloadDelay: 50,
  // The loader only warms a query; the query layer owns staleness, so every
  // hover may re-check rather than the router skipping preloads for 30s.
  defaultPreloadStaleTime: 0,
  defaultStructuralSharing: true,
});

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
