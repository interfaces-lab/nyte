import { create, props } from "@stylexjs/stylex";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { Type } from "typebox";
import { Value } from "typebox/value";
import {
  createRootRouteWithContext,
  createRoute,
  createRouter,
  redirect,
  useRouter,
} from "@tanstack/react-router";
import type { RouterHistory } from "@tanstack/react-router";
import type { ReactElement } from "react";
import { useStagePage } from "../tabs/shell-state.ts";
import { Button } from "@nyte-ai/ui/button";
import { queryClient } from "../data/query-client.ts";
import { readSession, sessionRows } from "../data/session-rows.ts";
import { routeSessionExists } from "./route-session.ts";
import { sessionsWatch } from "../data/watches.ts";
import { preferences } from "../preferences/index.ts";
import { loadHostSettings } from "../preferences/host.ts";
import type { ShellSearch } from "../tabs/search.ts";
import { SessionScreen } from "../panes/session-screen.tsx";
import type { SessionId, SessionInfo } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { activeTab, tabPlace } from "../tabs/model.ts";
import { placeHref } from "../tabs/places.ts";
import { windowTabs } from "../tabs/window-tabs.ts";
import type { DesktopWindow } from "../contract/desktop-window.ts";
import { CustomizeSurface } from "../customize/customize.tsx";
import { showsSettingsSection, rememberWorkspaceHref, SettingsSurface } from "../settings/index.ts";

const styles = create({
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
    lineHeight: type.leadingBase,
  },
});

function WorkspaceRouteStage(): ReactElement {
  const page = useStagePage();

  if (page === undefined) return <SessionScreen />;

  return <CustomizeSurface sessionId={page.sessionId} />;
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

    if (search.customize !== undefined) return;

    if (preferences.startupDestination.get() === "new-chat") return;

    const directory = sessionRows().roots;

    if (directory === undefined) {
      context.startup.openLastChatOnArrival();

      return;
    }

    const sessionId = lastSession(directory);

    if (sessionId !== undefined) {
      throw redirect({
        to: sessionRoute.to,
        params: { sessionId },
        replace: true,
      });
    }
  },
});

function lastSession(directory: readonly SessionInfo[]): SessionId | undefined {
  return directory.find((session) => session.parent === null && !session.archived)?.id;
}

function openLastChatOnArrival(router: AppRouter): void {
  const directory = sessionsWatch("roots");
  const controller = new AbortController();
  const options = { capture: true, signal: controller.signal } as const;
  const stop = (): void => controller.abort();
  window.addEventListener("keydown", stop, options);
  window.addEventListener("pointerdown", stop, options);

  const leave = directory.subscribe(() => {
    const { value, error } = directory;

    if (value === undefined && error === undefined) return;
    stop();
    const sessionId = value === undefined ? undefined : lastSession(value);

    if (sessionId === undefined || router.state.location.pathname !== "/") return;
    void router.navigate({ to: sessionRoute.to, params: { sessionId }, replace: true });
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

const sessionRoute = createRoute({
  getParentRoute: () => workspaceRoute,
  path: "/session/$sessionId",
  params: {
    parse: (params) => ({ sessionId: asId<"session">(params.sessionId) }),
    stringify: ({ sessionId }) => ({ sessionId }),
  },
  errorComponent: RouteError,
});

function leaveMissingSession(router: AppRouter): void {
  const sessionId = currentRouteSession(router);

  if (sessionId === undefined) return;
  void routeSessionExists({
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
  const directory = sessionsWatch("roots");
  const answered = Promise.withResolvers<void>();

  const leave = directory.subscribe(() => {
    if (directory.value !== undefined || directory.error !== undefined) answered.resolve();
  });

  if (directory.value === undefined && directory.error === undefined) await answered.promise;
  leave();

  return directory.value ?? [];
}

export const settingsRoute = createRoute({
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

const workspaceRouteTree = workspaceRoute.addChildren([indexRoute, sessionRoute]);

const routeTree = rootRoute.addChildren([workspaceRouteTree, settingsRoute]);

export function startWindowTabs(desktopWindow: DesktopWindow): void {
  windowTabs.start(desktopWindow);
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
    leaveMissingSession(router);
  });

  return router;
}

export type AppRouter = ReturnType<typeof createAppRouter>;

function currentRouteSession(router: AppRouter): SessionId | undefined {
  for (const match of router.state.matches) {
    if (match.routeId === sessionRoute.id) return match.params.sessionId;
  }

  return undefined;
}
