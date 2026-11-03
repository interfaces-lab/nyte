import { create, props } from "@stylexjs/stylex";
import { TooltipProvider } from "@nyte-ai/ui/tooltip";
import { Matches, useRouter } from "@tanstack/react-router";
import { useEffectEvent, useRef, useSyncExternalStore } from "react";
import { AboutDialog } from "./about-dialog.tsx";
import type { ReactElement } from "react";
import { WorkspaceDialogHost } from "../panes/open-workspace.tsx";
import { runWindowCommand, windowCommand } from "../commands/window-commands.ts";
import { shellActions, useOverlays, useStagePage } from "../tabs/shell-state.ts";
import { SidebarPane } from "../sidebar/sidebar-pane.tsx";
import { useSidebar } from "../sidebar/use-sidebar.ts";
import { sidebarPush, useSidebarSwipe } from "../sidebar/sidebar-swipe.ts";
import { Sidebar } from "../sidebar/sidebar.tsx";
import { Button } from "@nyte-ai/ui/button";
import { Loader } from "@nyte-ai/ui/loader";
import { Titlebar } from "./titlebar.tsx";
import { PaneControllerProvider } from "../panes/pane-context.tsx";
import { SessionDndProvider } from "../panes/session-dnd.tsx";
import { useHostRelease } from "../data/host.ts";
import { startupConnection } from "../data/startup.ts";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { layer, space } from "@nyte-ai/ui/styles/schema.stylex";
import { shell, sidebar } from "../theme/schema.stylex.ts";
import { nyte } from "../contract/nyte.ts";
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
    boxShadow: `0 0 0 1px ${role.borderSecondaryTranslucent}`,
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
  migration: {
    position: "fixed",
    top: 0,
    right: 0,
    bottom: 0,
    left: 0,
    zIndex: layer.dialogBackdrop,
    display: "flex",
    flexDirection: "column",
    alignItems: "center",
    justifyContent: "center",
    gap: space.s2,
    backgroundColor: role.windowWash,
    color: role.contentPrimary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
    WebkitAppRegion: "drag",
  },
  migrationDetail: { color: role.contentSecondary },
});

function StoreMigration(): ReactElement | null {
  const connection = useSyncExternalStore(startupConnection.subscribe, startupConnection.read);

  if (connection.kind !== "migrating") return null;

  return (
    <div role="status" {...props(styles.migration)}>
      <Loader />
      <span>Updating your chats</span>
      <span {...props(styles.migrationDetail)}>
        This runs once after an update and can take a minute.
      </span>
    </div>
  );
}

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
  const root = useRef<HTMLDivElement | null>(null);
  const pushing = useSidebarSwipe(root);
  const sidebarCollapsed = useSidebar().state === "collapsed";
  const mac = nyte.platform === "darwin";
  const strip = windowTabs.strip;
  useWindowTabsSync();

  const onKeyDown = useEffectEvent((event: KeyboardEvent): void => {
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
  });

  useMountEffect(() => {
    const listener = (event: KeyboardEvent): void => onKeyDown(event);
    window.addEventListener("keydown", listener);

    return () => window.removeEventListener("keydown", listener);
  });

  useMountEffect(() =>
    nyte.host.onMenuCommand((command) => {
      shellActions.showAbout(command.kind === "about" ? command.info : undefined);

      if (command.kind === "action") runWindowCommand(shellRouter, command.action);
    }),
  );

  return (
    <div ref={root} data-nyte-shell {...props(styles.shell, pushing && sidebarPush)}>
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
      <StoreMigration />
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
