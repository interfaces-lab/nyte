import { create, props } from "@stylexjs/stylex";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { Matches, useRouter } from "@tanstack/react-router";
import { useEffectEvent, useRef, useState, useSyncExternalStore } from "react";
import { AboutDialog } from "./about-dialog.tsx";
import type { ReactElement } from "react";
import { followLight, keepCodeWorkbench } from "../commands/apps.ts";
import { WorkspaceDialogHost } from "../panes/open-workspace.tsx";
import { ProjectDialogHost } from "../projects/project-dialog.tsx";
import { performAction } from "../commands/offered-actions.ts";
import { arriveInWindow, openFileInEditor, runAction } from "../commands/window-commands.ts";
import { appActions } from "../data/app-actions.ts";
import { shellActions, useOverlays, useStagePage } from "../tabs/shell-state.ts";
import { SidebarPane } from "../sidebar/sidebar-pane.tsx";
import { useSidebar } from "../sidebar/use-sidebar.ts";
import { sidebarPush, useSidebarSwipe } from "../sidebar/sidebar-swipe.ts";
import { Sidebar } from "../sidebar/sidebar.tsx";
import { Button } from "@nyte-ai/ui/button";
import { Loader } from "@nyte-ai/ui/loader";
import { ToastProvider } from "@nyte-ai/ui/toast";
import { Titlebar } from "./titlebar.tsx";
import { PaneControllerProvider } from "../panes/pane-context.tsx";
import { SessionDndProvider } from "../panes/session-dnd.tsx";
import { useHostProcess, useHostBuildMismatch } from "../data/host.ts";
import { useHostProcessAction } from "../environments/host-process.tsx";
import { startupConnection } from "../data/startup.ts";
import type { StartupProblem } from "../data/startup.ts";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { shell, sidebar } from "../theme/schema.stylex.ts";
import { nyte, windowApp } from "../contract/nyte.ts";
import {
  clientCapabilities,
  resolveClientAction,
  resolveTabShortcut,
} from "../contract/client-actions.ts";
import { useWindowTabsSync } from "../tabs/use-window-tabs.tsx";
import { windowTabs } from "../tabs/window-tabs.ts";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { closeSettings } from "../settings/index.ts";
import { settingsRoute } from "./routes.tsx";
import { BrowserGuestHost } from "../browser/browser-guests.tsx";
import { noteFocusRegion } from "../workbench/focus-region.ts";

const styles = create({
  shell: {
    display: "flex",
    flexDirection: "column",
    width: "100%",
    height: "100%",
    backgroundColor: role.windowWash,
    backgroundImage: `linear-gradient(${role.sidebarMaterial}, ${role.sidebarMaterial})`,
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
    backgroundColor: role.surfaceMaterial,
    overflow: "clip",
  },
  card: {
    marginInlineEnd: shell.cardInset,
    marginBlockEnd: shell.cardInset,
    borderRadius: shell.cardRadius,
    boxShadow: `0 0 0 1px ${role.strokeQuaternary}`,
    transitionProperty: "margin-inline-start",
    transitionDuration: sidebar.resizeDuration,
    transitionTimingFunction: sidebar.resizeEasing,
  },
  cardSidebarHidden: { marginInlineStart: shell.cardInset, transitionDelay: sidebar.resizeDelay },
  connectionFailure: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s3,
    flexShrink: 0,
    paddingBlock: space.s2,
    color: role.contentPrimary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
});

const STARTUP_FAILURE = {
  authentication: "The host refused this app. Pair with it again.",
  incompatible: "This host runs another version of Nyte. Update both, then try again.",
  server: "The host hit an error while opening your workspace.",
} as const satisfies Readonly<Record<StartupProblem, string>>;

function ConnectionFailure(): ReactElement | null {
  const connection = useSyncExternalStore(startupConnection.subscribe, startupConnection.read);

  if (connection.kind === "unreachable") {
    return (
      <div role="status" {...props(styles.connectionFailure)}>
        <Loader />
        <span>Can&rsquo;t reach the host. Reconnecting&hellip;</span>
      </div>
    );
  }

  if (connection.kind !== "failed") return null;

  return (
    <div role="alert" {...props(styles.connectionFailure)}>
      <span>{STARTUP_FAILURE[connection.problem]}</span>
      <Button variant="outline" onClick={connection.retry}>
        Try Again
      </Button>
    </div>
  );
}

function ReleaseNotice(): ReactElement | null {
  const mismatch = useHostBuildMismatch();
  const hostProcess = nyte.host.hostProcess;
  const restarting = useHostProcess().data?.kind === "restarting";
  const act = useHostProcessAction();
  const [dismissed, setDismissed] = useState<string>();

  if (mismatch === undefined || mismatch.operations === dismissed) return null;

  return (
    <div role="status" {...props(styles.connectionFailure)}>
      <span>
        {hostProcess === undefined
          ? "This host runs a different build of Nyte than this app, so some features may not work. Update Nyte on the host."
          : "Nyte Host is running a different build than this app, so some features may not work."}
      </span>
      {hostProcess !== undefined && (
        <Button
          variant="outline"
          loading={act.isPending || restarting}
          onClick={() => act.mutate("restart")}
        >
          Restart Host…
        </Button>
      )}
      <Button variant="ghost" onClick={() => setDismissed(mismatch.operations)}>
        Dismiss
      </Button>
    </div>
  );
}

export function Shell({ appIcon }: { appIcon: string }): ReactElement {
  return (
    <TooltipProvider>
      <ToastProvider>
        <PaneControllerProvider>
          <ShellChrome appIcon={appIcon} />
        </PaneControllerProvider>
      </ToastProvider>
    </TooltipProvider>
  );
}

function ShellChrome({ appIcon }: { appIcon: string }): ReactElement {
  const shellRouter = useRouter();
  const page = useStagePage();
  const { about } = useOverlays();
  const root = useRef<HTMLDivElement | null>(null);
  const pushing = useSidebarSwipe(root);
  const code = windowApp() === "code";
  const sidebarCollapsed = useSidebar().state === "collapsed";
  const mac = nyte.platform === "darwin";
  const strip = windowTabs.strip;
  useWindowTabsSync();

  const settingsShown = (): boolean =>
    shellRouter.state.matches.some((match) => match.routeId === settingsRoute.id);

  const onKeyDown = useEffectEvent((event: KeyboardEvent): void => {
    const settingsOpen = settingsShown();

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

    if (action?.action !== undefined && runAction(shellRouter, action.action, action.input ?? {})) {
      event.preventDefault();
    }
  });

  useMountEffect(() => {
    const listener = (event: KeyboardEvent): void => onKeyDown(event);
    window.addEventListener("keydown", listener);

    return () => window.removeEventListener("keydown", listener);
  });

  const onEarlyKey = useEffectEvent((event: KeyboardEvent): void => {
    const action = resolveClientAction(
      event,
      mac,
      settingsShown() ? "settings" : (page?.kind ?? "workspace"),
      clientCapabilities(nyte.host),
    );

    if (
      action?.early !== true ||
      action.action === undefined ||
      !runAction(shellRouter, action.action, action.input ?? {})
    ) {
      return;
    }
    event.preventDefault();
    event.stopPropagation();
  });

  useMountEffect(() => {
    const listener = (event: KeyboardEvent): void => onEarlyKey(event);
    window.addEventListener("keydown", listener, true);

    return () => window.removeEventListener("keydown", listener, true);
  });

  useMountEffect(() => {
    const listener = (event: Event): void => noteFocusRegion(event.target);
    window.addEventListener("focusin", listener, true);
    window.addEventListener("pointerdown", listener, true);

    return () => {
      window.removeEventListener("focusin", listener, true);
      window.removeEventListener("pointerdown", listener, true);
    };
  });

  useMountEffect(() => {
    if (windowApp() !== "code") return undefined;
    const leaveLight = followLight();
    const leaveWorkbench = keepCodeWorkbench();

    return () => {
      leaveLight();
      leaveWorkbench();
    };
  });

  useMountEffect(() => appActions.serve((name, input) => performAction(shellRouter, name, input)));

  useMountEffect(() =>
    nyte.host.onMenuCommand((command) => {
      shellActions.showAbout(command.kind === "about" ? command.info : undefined);

      if (command.kind === "action") runAction(shellRouter, command.action, command.input);

      if (command.kind === "open-file") openFileInEditor(shellRouter, command.path);

      if (command.kind === "arrive") arriveInWindow(shellRouter, command.subject);
    }),
  );

  return (
    <div ref={root} data-nyte-shell {...props(styles.shell, pushing && sidebarPush)}>
      <Titlebar />
      <div {...props(styles.stage)}>
        <SessionDndProvider>
          {!code && (
            <SidebarPane>
              <Sidebar />
            </SidebarPane>
          )}
          <main
            {...props(
              styles.surface,
              strip && styles.card,
              strip && sidebarCollapsed && styles.cardSidebarHidden,
            )}
          >
            <ConnectionFailure />
            <ReleaseNotice />
            <Matches />
          </main>
        </SessionDndProvider>
      </div>
      <WorkspaceDialogHost />
      <ProjectDialogHost />
      {about !== undefined && (
        <AboutDialog
          info={about}
          icon={appIcon}
          onClose={() => shellActions.showAbout(undefined)}
        />
      )}
      {nyte.host.browser !== undefined && <BrowserGuestHost browser={nyte.host.browser} />}
    </div>
  );
}
