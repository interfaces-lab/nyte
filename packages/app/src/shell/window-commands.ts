/**
 * The window's commands: what a shortcut, the menu bar and the palette run,
 * the same way wherever they come from. A command for the panes first
 * uncovers them from Settings or a page; one that can't apply now answers
 * false, so its key stays with whatever else wants it.
 */
import type { RegisteredRouter } from "@tanstack/react-router";
import type { AppMenuAction, HostState } from "../bridge.ts";
import { shellActions } from "../chrome/shell-state.ts";
import { folderPicker } from "../chrome/open-workspace.tsx";
import { clientCapabilities } from "../client-actions.ts";
import { focusNextPane, splitPanes } from "../layout/pane-context.tsx";
import { nyte } from "../nyte.ts";
import { keys, queryClient } from "../queries.ts";
import { closeSettings } from "../settings/return.ts";
import { windowTabs } from "../tabs/window-tabs.ts";
import {
  activeWorkbenchTab,
  defaultWorkbenchTab,
  workbenchController,
  workbenchScope,
  workbenchShowsChat,
  workbenchViewKey,
} from "../workbench/controller.ts";
import { terminalActions } from "../workbench/terminal-store.ts";

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
  "back",
  "forward",
  "focus-pane",
] as const satisfies readonly AppMenuAction[];

/** The window command a client action names, if it is one. */
export function windowCommand(id: string): AppMenuAction | undefined {
  return COMMANDS.find((command) => command === id);
}

function settingsOpen(router: RegisteredRouter): boolean {
  return router.state.matches.some((match) => match.routeId === "/settings/$section");
}

/** Leave Settings and any page, so the panes and workbench show. */
function uncoverPanes(router: RegisteredRouter): void {
  if (settingsOpen(router)) closeSettings(router);
  shellActions.showWorkspace();
}

function workbenchView() {
  const workspacePath = queryClient.getQueryData<HostState>(keys.host)?.workspace?.path;
  const viewKey = workbenchViewKey(workspacePath);

  return { workspacePath, viewKey, view: workbenchController.getView(viewKey) };
}

function openTerminal(): void {
  const { workspacePath, viewKey } = workbenchView();

  const id = workbenchController.actions.openTab({
    view: viewKey,
    tab: { kind: "terminal", owner: { kind: "user" } },
    activate: true,
  });

  void terminalActions.create({ id, workspacePath: workspacePath ?? null });
}

/** Hide the terminal on screen, else show the first one, else open one. */
function toggleTerminal(): void {
  const { workspacePath, viewKey, view } = workbenchView();

  const active = activeWorkbenchTab(
    view,
    workbenchScope(workspacePath),
    clientCapabilities(nyte.host),
  );

  const terminal = view.tabs.find((tab) => tab.kind === "terminal" && tab.owner.kind === "user");

  if (view.expanded && !workbenchShowsChat(view.layout) && active?.kind === "terminal")
    workbenchController.actions.toggle({ view: viewKey });
  else if (terminal !== undefined)
    workbenchController.actions.activateTab({ view: viewKey, id: terminal.id });
  else openTerminal();
}

export function runWindowCommand(router: RegisteredRouter, command: AppMenuAction): boolean {
  const { terminal, browser } = clientCapabilities(nyte.host);

  switch (command) {
    case "new-chat":
      if (settingsOpen(router)) closeSettings(router);
      shellActions.showWorkspace();
      windowTabs.controller().newChat();

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
        void router.navigate({ to: "/settings/$section", params: { section: "general" } });

      return true;
    case "search":
      shellActions.toggleSearch();

      return true;
    case "sidebar":
      shellActions.toggleSidebar();

      return true;
    case "back":
      if (settingsOpen(router)) closeSettings(router);
      else windowTabs.dispatch({ kind: "travel", step: -1 });

      return true;
    case "forward":
      if (settingsOpen(router)) return false;
      windowTabs.dispatch({ kind: "travel", step: 1 });

      return true;
    case "workbench":
      uncoverPanes(router);
      workbenchController.actions.toggleWorkbench({ view: workbenchView().viewKey });

      return true;
    case "terminal":
      if (!terminal) return false;
      uncoverPanes(router);
      toggleTerminal();

      return true;
    case "new-terminal":
      if (!terminal) return false;
      uncoverPanes(router);
      openTerminal();

      return true;
    case "new-browser":
      if (!browser) return false;
      uncoverPanes(router);
      workbenchController.actions.openTab({
        view: workbenchView().viewKey,
        tab: defaultWorkbenchTab("browser"),
        activate: true,
      });

      return true;
    case "split-right":
    case "split-down":
      uncoverPanes(router);

      return splitPanes(windowTabs.controller(), command === "split-down" ? "down" : "right");
    case "focus-pane":
      return focusNextPane(windowTabs.controller());
    default: {
      const _exhaustive: never = command;

      return _exhaustive;
    }
  }
}
