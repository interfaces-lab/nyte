/**
 * One mounted shell — titlebar, rail, stage — around one workspace-lifetime
 * pane stage. There is no separate home screen: with no workspace open the
 * stage shows the blank pane's "open a folder" state and the rail lists recent
 * projects, so opening a project never swaps the surface. Memory history fits
 * an Electron window with no URL bar. The shell also owns the app-wide keys —
 * ⌘N and ⌘[ return to the blank pane, ⌘B shows or hides the rail, ⌘, opens
 * Settings, ⌘D and ⇧⌘D split the stage — because the renderer owns chords.
 */
import { create, props } from "@stylexjs/stylex";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import {
  createMemoryHistory,
  createRootRoute,
  createRoute,
  createRouter,
  Matches,
  redirect,
  useRouter,
} from "@tanstack/react-router";
// oxlint-disable-next-line no-restricted-imports -- shortcuts act on the current pane state
import { useEffect } from "react";
import { AboutDialog } from "./chrome/about-dialog.tsx";
import type { ReactElement } from "react";
import { WorkspaceDialogHost } from "./chrome/open-workspace.tsx";
import { isSettingsSection } from "./chrome/settings-navigation.tsx";
import { shellActions, subscribeShellStage, useShellState } from "./chrome/shell-state.ts";
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
import { sessionId } from "@nyte-ai/protocol";
import type { SessionId } from "@nyte-ai/protocol";
import { nyte } from "./nyte.ts";
import { macPlatform } from "./platform.ts";
import { clientCapabilities, resolveClientAction } from "./client-actions.ts";

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

  return (
    <TooltipProvider>
      <PaneControllerProvider workspaceKey={host.data?.workspace?.path}>
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
  const { stage: shellStage, about } = useShellState();
  // Customize and Environments cover the stage; Back and a sidebar row both leave them.
  const stageOpen = shellStage.kind !== "workspace";
  const mac = macPlatform(host.data?.platform);

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

      const action = resolveClientAction(
        event,
        mac,
        settingsOpen ? "settings" : shellStage.kind,
        clientCapabilities(nyte.host),
      );

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
        closeSettings(shellRouter);
      } else if (action.id === "back" && shellRouter.history.canGoBack()) {
        event.preventDefault();
        shellRouter.history.back();
      } else if (action.id === "back" && stageOpen) {
        event.preventDefault();
        shellActions.showWorkspace();
      } else if (
        action.id === "forward" &&
        shellRouter.history.location.state.__TSR_index < shellRouter.history.length - 1
      ) {
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
  }, [canSplit, stageOpen, mac, panes, shellRouter, shellStage.kind]);

  return (
    <div data-nyte-shell {...props(styles.shell)}>
      <Titlebar />
      <div
        {...props(styles.stage)}
        onClickCapture={(event) => {
          if (!stageOpen || !(event.target instanceof Element)) return;

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
          <main {...props(styles.surface)}>
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

const rootRoute = createRootRoute({
  validateSearch: (
    search: Record<string, unknown>,
  ): { customize?: string; environment?: string } => ({
    customize: typeof search.customize === "string" ? search.customize : undefined,
    environment: typeof search.environment === "string" ? search.environment : undefined,
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

let startupDestinationPending = true;

const indexRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/",
  beforeLoad: async ({ search }) => {
    if (search.customize !== undefined || search.environment !== undefined) return;
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

function ThreadRouteError(): ReactElement {
  const threadRouter = useRouter();

  return (
    <div role="alert" {...props(styles.loadError)}>
      <p {...props(styles.loadErrorText)}>Couldn&rsquo;t open this chat.</p>
      <Button variant="outline" onClick={() => void threadRouter.invalidate()}>
        Try Again
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
  errorComponent: ThreadRouteError,
  // Route intent starts this before navigation. Direct navigation keeps the
  // current screen until the complete thread frame is ready.
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

function initialChromeRoute(): string {
  try {
    return window.sessionStorage.getItem("nyte.chrome.route") ?? "/";
  } catch {
    return "/";
  }
}

const history = createMemoryHistory({ initialEntries: [initialChromeRoute()] });

export const router = createRouter({
  routeTree,
  history,
  defaultPreload: "intent",
  defaultPreloadDelay: 0,
  // The loader only warms a query; the query layer owns staleness, so every
  // hover may re-check rather than the router skipping preloads for 30s.
  defaultPreloadStaleTime: 0,
  defaultStructuralSharing: true,
});

function restoreChromeStage(): void {
  const search = new URLSearchParams(router.state.location.searchStr);
  if (search.has("customize")) shellActions.openCustomize(currentRouteSession());
  else if (search.has("environment")) shellActions.openEnvironments();
  else shellActions.showWorkspace();
}

subscribeShellStage((stage) => {
  const search = new URLSearchParams(router.state.location.searchStr);
  if (
    (stage.kind === "customize" && search.has("customize") && !search.has("environment")) ||
    (stage.kind === "environments" && search.has("environment") && !search.has("customize")) ||
    (stage.kind === "workspace" && !search.has("customize") && !search.has("environment"))
  )
    return;
  void router.navigate({
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

router.subscribe("onResolved", () => {
  if (!router.state.matches.some((match) => match.routeId === settingsRoute.id))
    rememberWorkspaceHref(router.state.location.href);
  restoreChromeStage();
  try {
    if (
      router.state.location.searchStr.includes("customize=") ||
      router.state.location.searchStr.includes("environment=")
    ) {
      window.sessionStorage.setItem("nyte.chrome.route", router.state.location.href);
    } else window.sessionStorage.removeItem("nyte.chrome.route");
  } catch {}
});
restoreChromeStage();

/** The chat the current location shows, if it is one. */
export function currentRouteSession(): SessionId | undefined {
  for (const match of router.state.matches) {
    if (match.routeId === threadRoute.id) return match.params.sessionId;
  }

  return undefined;
}

declare module "@tanstack/react-router" {
  interface Register {
    router: typeof router;
  }
}
