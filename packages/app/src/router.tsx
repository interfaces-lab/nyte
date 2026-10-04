import { create, props } from "@stylexjs/stylex";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  Matches,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";
// oxlint-disable-next-line no-restricted-imports -- shortcuts act on the current pane state
import { useEffect } from "react";
import { AboutDialog } from "./chrome/about-dialog.tsx";
import type { ReactElement } from "react";
import { WorkspaceDialogHost } from "./chrome/open-workspace.tsx";
import { isSettingsSection } from "./chrome/settings-navigation.tsx";
import {
  applyShellStage,
  shellActions,
  subscribeShellStage,
  useShellState,
} from "./chrome/shell-state.ts";
import { SidebarPane } from "./chrome/sidebar-pane.tsx";
import { Sidebar } from "./chrome/sidebar.tsx";
import { Button } from "@nyte-ai/ui/button";
import { Titlebar } from "./chrome/titlebar.tsx";
import { PaneControllerProvider, usePaneActions, useCanSplitPane } from "./layout/pane-context.tsx";
import { SessionDndProvider } from "./layout/session-dnd.tsx";
import { warmThread } from "./live.ts";
import { keys, queryClient, useHostState } from "./queries.ts";
import { readRouteSession } from "./route-session.ts";
import type { SessionPage } from "./session-directory.ts";
import { getStartupDestination, startupSession } from "./startup-preference.ts";
import { WorkspaceStage } from "./shell/workspace-stage.tsx";
import { role, type } from "@nyte-ai/ui/vars.stylex";
import { radius } from "@nyte-ai/ui/schema.stylex";
import { shell } from "./theme/schema.stylex.ts";
import { sessionId } from "@nyte-ai/protocol";
import type { SessionId } from "@nyte-ai/protocol";
import { nyte } from "./nyte.ts";
import { macPlatform } from "./platform.ts";
import { clientCapabilities, resolveClientAction, resolveTabShortcut } from "./client-actions.ts";
import { activeTab, currentView, tabPlace } from "./tabs/model.ts";
import { placeHref } from "./tabs/places.ts";
import { useWindowTabsState, useWindowTabsSync } from "./tabs/use-window-tabs.tsx";
import { windowTabs } from "./tabs/window-tabs.ts";

import { CustomizeSurface } from "./chrome/customize.tsx";
import { EnvironmentsSurface } from "./chrome/environments.tsx";
import { SettingsSurface } from "./chrome/appearance-settings.tsx";
import { closeSettings, rememberWorkspaceHref } from "./chrome/settings-return.ts";

const styles = create({
  shell: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    backgroundColor: role.sidebarMaterial,
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
    backgroundColor: role.bgBase,
    overflow: "hidden",
  },
  /** With window tabs the main area is a card set into the chrome, which the titlebar shares. */
  card: {
    marginInlineEnd: shell.cardInset,
    marginBlockEnd: shell.cardInset,
    borderRadius: radius.card,
    boxShadow: `0 0 0 1px ${role.borderSecondaryTranslucent}`,
  },
  cardSidebarHidden: { marginInlineStart: shell.cardInset },
  loadError: {
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    flex: 1,
    gap: 12,
    color: role.contentPrimary,
  },
  loadErrorText: {
    margin: 0,
    color: role.contentSecondary,
    fontSize: type.fontBase,
  },
});

/** `appIcon` is the host's product mark, shown in About; the host bundles it. */
export function Shell({ appIcon }: { appIcon: string }): ReactElement {
  const host = useHostState();
  const tabs = useWindowTabsState();

  return (
    <TooltipProvider>
      <PaneControllerProvider
        workspaceKey={host.data?.workspace?.path}
        controller={windowTabs.enabled ? windowTabs.controller(tabs.activeTabId) : undefined}
      >
        <ShellChrome appIcon={appIcon} />
      </PaneControllerProvider>
    </TooltipProvider>
  );
}

function ShellChrome({ appIcon }: { appIcon: string }): ReactElement {
  const host = useHostState();
  const shellRouter = useRouter();
  const panes = usePaneActions();
  const canSplit = useCanSplitPane();
  const { stage: shellStage, about, sidebarVisible } = useShellState();
  // Customize and Environments cover the stage; Back and a sidebar row both leave them.
  const stageOpen = shellStage.kind !== "workspace";
  const mac = macPlatform(host.data?.platform);
  const tabbed = windowTabs.enabled;
  useWindowTabsSync();

  useEffect(() => {
    restoreChromeStage(shellRouter);

    return subscribeShellStage((stage) => {
      const search = shellRouter.state.location.search;

      if (
        (stage.kind === "customize" &&
          search.customize !== undefined &&
          search.environment === undefined) ||
        (stage.kind === "environments" &&
          search.environment !== undefined &&
          search.customize === undefined) ||
        (stage.kind === "workspace" &&
          search.customize === undefined &&
          search.environment === undefined)
      )
        return;

      void shellRouter.navigate({
        to: ".",
        search: (previous) => {
          const { customize, environment, ...rest } = previous;

          if (stage.kind === "customize") return { ...rest, customize: customize ?? "plugins" };

          if (stage.kind === "environments")
            return { ...rest, environment: environment ?? "connections" };

          return rest;
        },
      });
    });
  }, [shellRouter]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      const settingsOpen = shellRouter.state.matches.some(
        (match) => match.routeId === settingsRoute.id,
      );

      if (settingsOpen && event.key === "Escape" && !event.defaultPrevented && !event.isComposing) {
        event.preventDefault();
        closeSettings(shellRouter);

        return;
      }

      const shortcut = tabbed && !settingsOpen ? resolveTabShortcut(event, mac) : undefined;

      if (shortcut !== undefined) {
        event.preventDefault();
        windowTabs.dispatch(shortcut);

        return;
      }

      const action = resolveClientAction(
        event,
        mac,
        settingsOpen ? "settings" : shellStage.kind,
        clientCapabilities(nyte.host),
      );

      if (action === undefined) return;

      if (action.id === "new-tab" || action.id === "close-tab" || action.id === "reopen-tab") {
        if (!tabbed) return;
        event.preventDefault();

        if (action.id === "new-tab") windowTabs.dispatch({ kind: "new-tab" });
        else if (action.id === "reopen-tab") windowTabs.dispatch({ kind: "reopen-tab" });
        else
          windowTabs.dispatch({ kind: "close-tab", tabId: windowTabs.getSnapshot().activeTabId });

        return;
      }

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
        closeSettings(shellRouter);
      } else if ((action.id === "back" || action.id === "forward") && tabbed) {
        if (settingsOpen) return;
        event.preventDefault();
        windowTabs.dispatch({ kind: "travel", step: action.id === "back" ? -1 : 1 });
      } else if (action.id === "back" && shellRouter.history.canGoBack()) {
        event.preventDefault();
        shellRouter.history.back();
      } else if (action.id === "back" && stageOpen) {
        event.preventDefault();
        shellActions.showWorkspace();
      } else if (action.id === "forward") {
        event.preventDefault();
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
  }, [canSplit, stageOpen, mac, panes, shellRouter, shellStage.kind, tabbed]);

  return (
    <div data-nyte-shell {...props(styles.shell)}>
      <Titlebar />
      <div
        {...props(styles.stage)}
        onClickCapture={(event) => {
          // A tab's page is left by the navigation the row makes, not by the click.
          if (tabbed || !stageOpen || !(event.target instanceof Element)) return;

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
          <main
            {...props(
              styles.surface,
              tabbed && styles.card,
              tabbed && !sidebarVisible && styles.cardSidebarHidden,
            )}
          >
            <Matches />
          </main>
        </SessionDndProvider>
      </div>
      <WorkspaceDialogHost />
      {about !== undefined && (
        <AboutDialog
          info={about}
          icon={appIcon}
          onClose={() => shellActions.showAbout(undefined)}
        />
      )}
    </div>
  );
}

function WorkspaceRouteStage(): ReactElement {
  const { stage: shellStage } = useShellState();

  switch (shellStage.kind) {
    case "workspace":
      return <WorkspaceStage />;
    case "customize":
      return <CustomizeSurface sessionId={shellStage.sessionId} />;
    case "environments":
      return <EnvironmentsSurface />;
    default: {
      const _exhaustive: never = shellStage;

      return _exhaustive;
    }
  }
}

const searchText = Type.String();

const shellSearch = Type.Object({
  customize: Type.Optional(searchText),
  environment: Type.Optional(searchText),
  usage: Type.Optional(searchText),
  usageWhere: Type.Optional(searchText),
  usageTool: Type.Optional(searchText),
});

export type ShellSearch = Static<typeof shellSearch>;

const rootRoute = createRootRouteWithContext<{ startup: { pending: boolean } }>()({
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
  validateSearch: (search): ShellSearch => ({
    customize: Value.Check(searchText, search.customize) ? search.customize : undefined,
    environment: Value.Check(searchText, search.environment) ? search.environment : undefined,
    usage: Value.Check(searchText, search.usage) ? search.usage : undefined,
    usageWhere: Value.Check(searchText, search.usageWhere) ? search.usageWhere : undefined,
    usageTool: Value.Check(searchText, search.usageTool) ? search.usageTool : undefined,
  }),
});

/**
 * The stage route. `workspace` is undefined until a folder opens; the stage
 * stays mounted either way and only its data binding changes.
 */
const workspaceRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: "_workspace",
  component: WorkspaceRouteStage,
});

const indexRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/",
  beforeLoad: ({ context, preload, search }) => {
    if (preload || !context.startup.pending) return;
    context.startup.pending = false;

    // A restored strip, or a window opened beside others, already knows what it shows.
    if (windowTabs.enabled && !windowTabs.startupDestination) return;

    if (search.customize !== undefined || search.environment !== undefined) return;

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

function RouteError(): ReactElement {
  const router = useRouter();

  return (
    <div role="alert" {...props(styles.loadError)}>
      <p {...props(styles.loadErrorText)}>Couldn&rsquo;t open this page.</p>
      <Button variant="outline" onClick={() => void router.invalidate()}>
        Try Again
      </Button>
    </div>
  );
}

function RouteNotFound(): ReactElement {
  const router = useRouter();

  return (
    <div {...props(styles.loadError)}>
      <p {...props(styles.loadErrorText)}>Page not found.</p>
      <Button variant="outline" onClick={() => void router.navigate({ to: "/", replace: true })}>
        New Chat
      </Button>
    </div>
  );
}

const threadRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/session/$sessionId",
  params: {
    parse: (params) => ({ sessionId: sessionId(params.sessionId) }),
    stringify: ({ sessionId }) => ({ sessionId }),
  },
  beforeLoad: async ({ params }) => {
    const session = await readRouteSession({
      client: queryClient,
      sessionId: params.sessionId,
      read: () => nyte.sessions.get({ sessionId: params.sessionId }),
    });

    if (session === null) throw redirect({ to: indexRoute.to, replace: true });
  },
  errorComponent: RouteError,
  // Route intent starts this before navigation. Direct navigation keeps the
  // current screen until the complete thread frame is ready.
  loader: ({ params }) => warmThread(params.sessionId),
});

export const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/$section",
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

/** Desktop windows show tabs: restore this window's strip before the router starts. */
export function startWindowTabs(): Promise<void> {
  return windowTabs.start();
}

/** The route the active window tab shows. */
export function windowTabRoute(): string {
  return placeHref(tabPlace(activeTab(windowTabs.getSnapshot())));
}

export function createAppRouter({ history }: { history: RouterHistory }) {
  const router = createRouter({
    routeTree,
    history,
    context: { startup: { pending: history.location.pathname === "/" } },
    defaultPreload: "intent",
    defaultPreloadDelay: 0,
    defaultPreloadStaleTime: 0,
    defaultStructuralSharing: true,
  });

  router.subscribe("onResolved", () => {
    if (!router.state.matches.some((match) => match.routeId === settingsRoute.id))
      rememberWorkspaceHref(router.state.location.href);
    restoreChromeStage(router);
  });

  restoreChromeStage(router);

  return router;
}

export type AppRouter = ReturnType<typeof createAppRouter>;

function restoreChromeStage(router: AppRouter): void {
  const { customize, environment } = router.state.location.search;

  if (customize !== undefined)
    applyShellStage({ kind: "customize", sessionId: customizeSession(router) });
  else if (environment !== undefined) applyShellStage({ kind: "environments" });
  else applyShellStage({ kind: "workspace" });
}

/** A tab's Customize page remembers the chat it opened from; elsewhere the route names it. */
function customizeSession(router: AppRouter): SessionId | undefined {
  if (!windowTabs.enabled) return currentRouteSession(router);
  const view = currentView(activeTab(windowTabs.getSnapshot()));

  return view.kind === "page" && view.page.kind === "customize" ? view.page.sessionId : undefined;
}

/** The chat the current location shows, if it is one. */
export function currentRouteSession(router: AppRouter): SessionId | undefined {
  for (const match of router.state.matches) {
    if (match.routeId === threadRoute.id) return match.params.sessionId;
  }

  return undefined;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: AppRouter;
  }
}
