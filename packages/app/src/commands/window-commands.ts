import type { RegisteredRouter } from "@tanstack/react-router";
import type { AppMenuAction, HostState } from "../contract/bridge.ts";
import type { DesktopWindowOpen } from "../contract/desktop-window.ts";
import { shellActions } from "../tabs/shell-state.ts";
import { folderPicker } from "../panes/open-workspace.tsx";
import { clientCapabilities } from "../contract/client-actions.ts";
import { focusNextPane, splitPanes } from "../panes/pane-context.tsx";
import { nyte } from "../contract/nyte.ts";
import { keys, queryClient } from "../data/query-client.ts";
import { commitHostWorkspace } from "../data/workspaces.ts";
import { closeSettings } from "../settings/return.ts";
import { windowTabs } from "../tabs/window-tabs.ts";
import { settingsActionPages } from "../sidebar/action-icons.ts";
import { launch } from "../workbench/commands.ts";
import { fileActions } from "../workbench/editor/file-store.ts";
import { workbenchShowsChat } from "../workbench/model.ts";
import { workbenchScope, workbenchViewKey } from "../workbench/paths.ts";
import { activeWorkbenchTab } from "../workbench/selectors.ts";
import { workbench } from "../workbench/store.ts";

const COMMANDS = [
  "new-chat",
  "new-tab",
  "close-tab",
  "reopen-tab",
  "open-folder",
  "new-terminal",
  "new-browser",
  "settings",
  "search",
  "sidebar",
  "workbench",
  "terminal",
  "split-right",
  "split-down",
  "focus-pane",
  "reload-window",
] as const satisfies readonly AppMenuAction[];

export function windowCommand(id: string): AppMenuAction | undefined {
  return COMMANDS.find((command) => command === id);
}

function settingsOpen(router: RegisteredRouter): boolean {
  return router.state.matches.some((match) => match.routeId === "/settings/$section");
}

function uncoverPanes(router: RegisteredRouter): void {
  if (settingsOpen(router)) closeSettings(router);
  shellActions.showWorkspace();
}

function currentWorkspacePath(): string | undefined {
  return queryClient.getQueryData<HostState>(keys.host)?.workspace?.path;
}

function toggleTerminal(): void {
  const workspacePath = currentWorkspacePath();
  const viewKey = workbenchViewKey(workspacePath);
  const view = workbench.getView(viewKey);

  const active = activeWorkbenchTab(
    view,
    workbenchScope(workspacePath),
    clientCapabilities(nyte.host),
  );

  const terminal = view.tabs.find((tab) => tab.kind === "terminal" && tab.owner.kind === "user");

  if (view.expanded && !workbenchShowsChat(view.layout) && active?.kind === "terminal")
    workbench.dispatch(viewKey, { kind: "toggle" });
  else if (terminal !== undefined)
    workbench.dispatch(viewKey, { kind: "activate", id: terminal.id });
  else launch(viewKey, "terminal");
}

/**
 * Seeds a window Finder opened: its workspace, which no host call reads at boot, then that
 * folder's Editor, with the file when there is one, filling the window.
 */
export function openWindowInEditor(open: DesktopWindowOpen): void {
  if (open.workspace !== undefined) commitHostWorkspace(open.workspace);
  const view = workbenchViewKey(open.workspace?.path);

  if (open.kind === "file") fileActions.open(view, { path: open.path });
  else launch(view, "editor");
  workbench.dispatch(view, { kind: "maximize" });
}

/** Opens a file Finder sent to this window in the current view's Editor. */
export function openFileInEditor(router: RegisteredRouter, path: string): void {
  uncoverPanes(router);
  fileActions.open(workbenchViewKey(currentWorkspacePath()), { path });
}

export function runWindowCommand(router: RegisteredRouter, command: AppMenuAction): boolean {
  const { browser } = clientCapabilities(nyte.host);

  switch (command) {
    case "new-chat":
      if (settingsOpen(router)) closeSettings(router);
      windowTabs.newChat();

      return true;
    case "new-tab":
    case "reopen-tab":
      if (!windowTabs.strip) return false;

      if (settingsOpen(router)) closeSettings(router);
      windowTabs.dispatch({ kind: command });

      return true;
    case "close-tab":
      if (!windowTabs.strip) return false;

      if (settingsOpen(router)) closeSettings(router);
      else windowTabs.dispatch({ kind: "close-tab", tabId: windowTabs.getSnapshot().activeTabId });

      return true;
    case "open-folder":
      folderPicker()?.();

      return true;
    case "settings":
      if (!settingsOpen(router))
        void router.navigate({
          to: "/settings/$section",
          params: { section: settingsActionPages.settings },
        });

      return true;
    case "search":
      shellActions.toggleSearch();

      return true;
    case "sidebar":
      shellActions.toggleSidebar();

      return true;
    case "workbench":
      uncoverPanes(router);
      workbench.dispatch(workbenchViewKey(currentWorkspacePath()), { kind: "toggle" });

      return true;
    case "terminal":
      uncoverPanes(router);
      toggleTerminal();

      return true;
    case "new-terminal":
      uncoverPanes(router);
      launch(workbenchViewKey(currentWorkspacePath()), "terminal");

      return true;
    case "new-browser":
      if (!browser) return false;
      uncoverPanes(router);
      launch(workbenchViewKey(currentWorkspacePath()), "browser");

      return true;
    case "split-right":
    case "split-down":
      uncoverPanes(router);

      return splitPanes(windowTabs.controller(), command === "split-down" ? "down" : "right");
    case "focus-pane":
      return focusNextPane(windowTabs.controller());
    case "reload-window":
      window.location.reload();

      return true;
    default: {
      const _exhaustive: never = command;

      return _exhaustive;
    }
  }
}
