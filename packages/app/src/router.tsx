import { create, props } from "@stylexjs/stylex";
import { Type } from "typebox";
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
import { useEffect, useSyncExternalStore } from "react";
import { AboutDialog } from "./chrome/about-dialog.tsx";
import type { ReactElement } from "react";
import { WorkspaceDialogHost } from "./chrome/open-workspace.tsx";
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
import { queryClient, readSession, useHostState } from "./queries.ts";
import { readRouteSession } from "./route-session.ts";
import { directoryWatch } from "./sdk.tsx";
import { startupConnection } from "./startup.ts";
import { preferences } from "./preferences/index.ts";
import { loadHostSettings } from "./preferences/host.ts";
import type { ShellSearch } from "./shell/search.ts";
import { WorkspaceStage } from "./shell/workspace-stage.tsx";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { shell } from "./theme/schema.stylex.ts";
import type { SessionId, SessionInfo } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { nyte } from "./nyte.ts";
import { macPlatform } from "./platform.ts";
import { clientCapabilities, resolveClientAction, resolveTabShortcut } from "./client-actions.ts";
import { activeTab, currentView, tabPlace } from "./tabs/model.ts";
import { placeHref } from "./tabs/places.ts";
import { useWindowTabsSync } from "./tabs/use-window-tabs.tsx";
import { windowTabs } from "./tabs/window-tabs.ts";

import { CustomizeSurface } from "./chrome/customize.tsx";
import { EnvironmentsSurface } from "./chrome/environments.tsx";
import {
  closeSettings,
  isSettingsSection,
  rememberWorkspaceHref,
  SettingsSurface,
} from "./settings/index.ts";

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
    overflow: "clip",
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
    gap: space.s3,
    color: role.contentPrimary,
  },
  loadErrorText: {
    margin: 0,
    color: role.contentSecondary,
    fontSize: type.fontBase,
  },
  connectionFailure: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s3,
    flexShrink: 0,
    paddingBlock: space.s2,
    color: role.contentPrimary,
    fontSize: type.fontBase,
  },
});

/** The host connection failed after the shell mounted; the stage stays, drafts included. */
function ConnectionFailure(): ReactElement | null {
  const connection = useSyncExternalStore(startupConnection.subscribe, startupConnection.read);

  if (connection.kind !== "failed") return null;

  return (
    <div role="alert" {...props(styles.connectionFailure)}>
      <span>Couldn&rsquo;t open your workspace.</span>
      <Button variant="outline" onClick={connection.retry}>
        Try Again
      </Button>
    </div>
  );
}

/** `appIcon` is the host's product mark, shown in About; the host bundles it. */
export function Shell({ appIcon }: { appIcon: string }): ReactElement {
  const host = useHostState();

  const activeTabId = useSyncExternalStore(
    windowTabs.subscribe,
    () => windowTabs.getSnapshot().activeTabId,
  );

  return (
    <TooltipProvider>
      <PaneControllerProvider
        workspaceKey={host.data?.workspace?.path}
        controller={windowTabs.enabled ? windowTabs.controller(activeTabId) : undefined}
      >
        <ShellChrome appIcon={appIcon} />
      </PaneControllerProvider>
    </TooltipProvider>
  );
}

/**
 * The window chrome around the stage. Customize and Environments cover the
 * stage; Back and a sidebar row both leave them, except in a tab, whose page
 * is left by the navigation the row makes rather than by the click.
 */
function ShellChrome({ appIcon }: { appIcon: string }): ReactElement {
  const host = useHostState();
  const shellRouter = useRouter();
  const panes = usePaneActions();
  const canSplit = useCanSplitPane();
  const { stage: shellStage, about, sidebarVisible } = useShellState();
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
            <ConnectionFailure />
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

interface StartupContext {
  pending: boolean;
  /** Move to the last chat once the directory arrives, if the user has not started on a new one. */
  readonly openLastChatOnArrival: () => void;
}

const rootRoute = createRootRouteWithContext<{ startup: StartupContext }>()({
  errorComponent: RouteError,
  notFoundComponent: RouteNotFound,
  validateSearch: (search): ShellSearch => ({
    customize: Value.Check(searchText, search.customize) ? search.customize : undefined,
    environment: Value.Check(searchText, search.environment) ? search.environment : undefined,
    usage: Value.Check(searchText, search.usage) ? search.usage : undefined,
    usageRange: Value.Check(searchText, search.usageRange) ? search.usageRange : undefined,
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

    if (windowTabs.enabled && !windowTabs.startupDestination) return;

    if (search.customize !== undefined || search.environment !== undefined) return;

    if (preferences.startupDestination.get() === "new-chat") return;
    const directory = directoryWatch("all").value;

    if (directory === undefined) {
      context.startup.openLastChatOnArrival();

      return;
    }

    const sessionId = lastChat(directory);

    if (sessionId !== undefined) {
      throw redirect({
        to: threadRoute.to,
        params: { sessionId },
        replace: true,
      });
    }
  },
});

/** The directory is newest-first, so its first open root is the last chat. */
function lastChat(directory: readonly SessionInfo[]): SessionId | undefined {
  return directory.find((session) => session.parent === null && !session.archived)?.id;
}

/**
 * Startup shows a new chat until the directory arrives, then moves to the
 * last chat, unless the user has started typing or clicking in the meantime:
 * a draft in the new chat outranks the startup destination.
 */
function openLastChatOnArrival(router: AppRouter): void {
  const directory = directoryWatch("all");
  const controller = new AbortController();
  const options = { capture: true, signal: controller.signal } as const;
  const stop = (): void => controller.abort();
  window.addEventListener("keydown", stop, options);
  window.addEventListener("pointerdown", stop, options);

  const leave = directory.subscribe(() => {
    const { value, error } = directory;

    if (value === undefined && error === undefined) return;
    stop();
    const sessionId = value === undefined ? undefined : lastChat(value);

    if (sessionId === undefined || router.state.location.pathname !== "/") return;
    void router.navigate({ to: threadRoute.to, params: { sessionId }, replace: true });
  });

  controller.signal.addEventListener("abort", leave, { once: true });
}

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
    parse: (params) => ({ sessionId: asId<"session">(params.sessionId) }),
    stringify: ({ sessionId }) => ({ sessionId }),
  },
  errorComponent: RouteError,
});

/**
 * A chat route renders at once, before the host has said the chat exists;
 * one it no longer has returns the window to a new chat when the answer
 * arrives.
 */
function leaveMissingChat(router: AppRouter): void {
  const sessionId = currentRouteSession(router);

  if (sessionId === undefined) return;
  void readRouteSession({
    client: queryClient,
    sessionId,
    read: () => readSession(sessionId),
  }).then(
    (session) => {
      if (session === null && currentRouteSession(router) === sessionId)
        void router.navigate({ to: indexRoute.to, replace: true });
    },
    () => undefined,
  );
}

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
  loader: () => loadHostSettings(),
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
    context: {
      startup: {
        pending: history.location.pathname === "/",
        openLastChatOnArrival: () => openLastChatOnArrival(router),
      },
    },
    defaultPreload: "intent",
    defaultPreloadDelay: 0,
    defaultPreloadStaleTime: 0,
    defaultStructuralSharing: true,
  });

  router.subscribe("onResolved", () => {
    if (!router.state.matches.some((match) => match.routeId === settingsRoute.id))
      rememberWorkspaceHref(router.state.location.href);
    restoreChromeStage(router);
    leaveMissingChat(router);
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
