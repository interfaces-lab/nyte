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
import { runWindowCommand, windowCommand } from "./shell/window-commands.ts";
import { shellActions, useOverlays, useStagePage } from "./chrome/shell-state.ts";
import { SidebarPane } from "./chrome/sidebar-pane.tsx";
import { Sidebar } from "./chrome/sidebar.tsx";
import { Button } from "@nyte-ai/ui/button";
import { Titlebar } from "./chrome/titlebar.tsx";
import { PaneControllerProvider } from "./layout/pane-context.tsx";
import { SessionDndProvider } from "./layout/session-dnd.tsx";
import { keys, queryClient, readSession, useHostRelease } from "./queries.ts";
import { routeChatExists } from "./route-session.ts";
import { directoryWatch } from "./sdk.tsx";
import { startupConnection } from "./startup.ts";
import { preferences, useSetting } from "./preferences/index.ts";
import { loadHostSettings } from "./preferences/host.ts";
import type { ShellSearch } from "./shell/search.ts";
import { ThreadScreen } from "./screens/thread.tsx";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { shell } from "./theme/schema.stylex.ts";
import type { SessionId, SessionInfo } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { nyte } from "./nyte.ts";
import { clientCapabilities, resolveClientAction, resolveTabShortcut } from "./client-actions.ts";
import { activeTab, tabPlace } from "./tabs/model.ts";
import { placeHref } from "./tabs/places.ts";
import { useWindowTabsSync } from "./tabs/use-window-tabs.tsx";
import { windowTabs } from "./tabs/window-tabs.ts";

import { CustomizeSurface } from "./chrome/customize.tsx";
import { EnvironmentsSurface } from "./chrome/environments.tsx";
import {
  closeSettings,
  showsSettingsSection,
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

function ReleaseNotice(): ReactElement | null {
  const release = useHostRelease();

  if (release === undefined) return null;

  return (
    <div role="status" {...props(styles.connectionFailure)}>
      <span>
        This host runs Nyte {release.version}, another release than this app. Update both to see
        everything.
      </span>
    </div>
  );
}

export function Shell({ appIcon }: { appIcon: string }): ReactElement {
  return (
    <TooltipProvider>
      <PaneControllerProvider>
        <ShellChrome appIcon={appIcon} />
      </PaneControllerProvider>
    </TooltipProvider>
  );
}

function ShellChrome({ appIcon }: { appIcon: string }): ReactElement {
  const shellRouter = useRouter();
  const page = useStagePage();
  const { about } = useOverlays();
  const sidebarVisible = useSetting(preferences.sidebarVisible);
  const mac = nyte.platform === "darwin";
  const strip = windowTabs.strip;
  useWindowTabsSync();

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

      const shortcut = strip && !settingsOpen ? resolveTabShortcut(event, mac) : undefined;

      if (shortcut !== undefined) {
        event.preventDefault();
        windowTabs.dispatch(shortcut);

        return;
      }

      const action = resolveClientAction(
        event,
        mac,
        settingsOpen ? "settings" : (page?.kind ?? "workspace"),
        clientCapabilities(nyte.host),
      );

      const command = action === undefined ? undefined : windowCommand(action.id);

      if (command !== undefined && runWindowCommand(shellRouter, command)) event.preventDefault();
    };

    window.addEventListener("keydown", onKeyDown);

    return () => {
      window.removeEventListener("keydown", onKeyDown);
    };
  }, [mac, page?.kind, shellRouter, strip]);

  useEffect(
    () =>
      nyte.host.onMenuCommand((command) => {
        shellActions.showAbout(command.kind === "about" ? command.info : undefined);

        if (command.kind === "action") runWindowCommand(shellRouter, command.action);
      }),
    [shellRouter],
  );

  return (
    <div data-nyte-shell {...props(styles.shell)}>
      <Titlebar />
      <div {...props(styles.stage)}>
        <SessionDndProvider>
          <SidebarPane>
            <Sidebar />
          </SidebarPane>
          <main
            {...props(
              styles.surface,
              strip && styles.card,
              strip && !sidebarVisible && styles.cardSidebarHidden,
            )}
          >
            <ConnectionFailure />
            <ReleaseNotice />
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
  const page = useStagePage();

  if (page === undefined) return <ThreadScreen />;

  switch (page.kind) {
    case "customize":
      return <CustomizeSurface sessionId={page.sessionId} />;
    case "environments":
      return <EnvironmentsSurface />;
    default: {
      const _exhaustive: never = page;

      return _exhaustive;
    }
  }
}

const searchText = Type.String();

interface StartupContext {
  pending: boolean;
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

    if (!windowTabs.startupDestination) return;

    if (search.customize !== undefined || search.environment !== undefined) return;

    if (preferences.startupDestination.get() === "new-chat") return;

    const directory =
      directoryWatch("roots").value ??
      queryClient.getQueryData<readonly SessionInfo[]>(keys.firstFrameRoots);

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

function lastChat(directory: readonly SessionInfo[]): SessionId | undefined {
  return directory.find((session) => session.parent === null && !session.archived)?.id;
}

function openLastChatOnArrival(router: AppRouter): void {
  const directory = directoryWatch("roots");
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

function leaveMissingChat(router: AppRouter): void {
  const sessionId = currentRouteSession(router);

  if (sessionId === undefined) return;
  void routeChatExists({
    client: queryClient,
    sessionId,
    listed: readDirectory,
    read: () => readSession(sessionId),
  }).then(
    (exists) => {
      if (!exists && currentRouteSession(router) === sessionId)
        void router.navigate({ to: indexRoute.to, replace: true });
    },
    () => undefined,
  );
}

async function readDirectory(): Promise<readonly SessionInfo[]> {
  const directory = directoryWatch("roots");
  const answered = Promise.withResolvers<void>();

  const leave = directory.subscribe(() => {
    if (directory.value !== undefined || directory.error !== undefined) answered.resolve();
  });

  if (directory.value === undefined && directory.error === undefined) await answered.promise;
  leave();

  return directory.value ?? [];
}

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: "/settings/$section",
  params: {
    parse: ({ section }) => {
      if (!showsSettingsSection(section)) {
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

export function startWindowTabs(firstWindow: boolean): void {
  windowTabs.start(firstWindow);
}

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
    leaveMissingChat(router);
  });

  return router;
}

export type AppRouter = ReturnType<typeof createAppRouter>;

function currentRouteSession(router: AppRouter): SessionId | undefined {
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
