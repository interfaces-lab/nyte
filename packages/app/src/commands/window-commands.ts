import { SdkError } from "@nyte-ai/sdk";
import type { Document, Json } from "@nyte-ai/sdk";
import type { RegisteredRouter } from "@tanstack/react-router";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import type { HostState } from "../contract/bridge.ts";
import type { ArrivalSubject, DesktopWindowOpen } from "../contract/desktop-window.ts";
import { focusWithin, keyOwner } from "../lib/focus-owner.ts";
import { shellActions } from "../tabs/shell-state.ts";
import { folderPicker } from "../panes/open-workspace.tsx";
import { APP_ACTIONS, clientCapabilities } from "../contract/client-actions.ts";
import type { AppAction } from "../contract/client-actions.ts";
import { focusNextPane, splitPanes } from "../panes/pane-context.tsx";
import { activeSelection } from "../panes/pane-layout.ts";
import { nyte, windowApp } from "../contract/nyte.ts";
import { keys, queryClient } from "../data/query-client.ts";
import { commitHostWorkspace } from "../data/workspaces.ts";
import {
  customSection,
  firstSettingsSection,
  namesSettingsSection,
  showsSettingsSection,
} from "../settings/sections.ts";
import { activateWorkspace } from "../sidebar/use-show-session.ts";
import { closeSettings } from "../settings/return.ts";
import { windowTabs } from "../tabs/window-tabs.ts";
import { launch, toggleExplorer } from "../workbench/commands.ts";
import { fileActions } from "../workbench/editor/file-store.ts";
import { opensAsMarkdown } from "../workbench/editor/markdown-parse.ts";
import { activeEditorFile, EDITOR_SLOT, tabSlot, workbenchShowsChat } from "../workbench/model.ts";
import { workbenchScope, workbenchViewKey } from "../workbench/paths.ts";
import { activeWorkbenchTab, shownWorkbenchTab } from "../workbench/selectors.ts";
import { workbench } from "../workbench/store.ts";
import { landAt, switchApp } from "./apps.ts";

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
  const viewKey = workbenchViewKey(currentWorkspacePath());
  const view = workbench.getView(viewKey);

  const active = activeWorkbenchTab(view, workbenchScope(viewKey), clientCapabilities(nyte.host));

  const terminal = view.tabs.find((tab) => tab.kind === "terminal" && tab.owner.kind === "user");

  if (view.expanded && !workbenchShowsChat(view.layout) && active?.kind === "terminal") {
    workbench.dispatch(viewKey, { kind: "toggle" });
  } else if (terminal !== undefined) {
    workbench.dispatch(viewKey, { kind: "activate", id: terminal.id });
  } else launch(viewKey, "terminal");
}

function toggleMarkdownSource(): boolean {
  if (
    keyOwner() !== undefined &&
    !focusWithin('[data-editor-panel] :is([data-slot="markdown-column"], diffs-container)')
  ) {
    return false;
  }
  const viewKey = workbenchViewKey(currentWorkspacePath());
  const view = workbench.getView(viewKey);

  const shown = shownWorkbenchTab(view, workbenchScope(viewKey), clientCapabilities(nyte.host));

  const file =
    shown !== null && tabSlot(shown) === EDITOR_SLOT ? activeEditorFile(view) : undefined;

  if (
    file === undefined ||
    !opensAsMarkdown(file.path) ||
    queryClient.getQueryData<Document>(keys.document(file.path))?.kind !== "text"
  ) {
    return false;
  }
  fileActions.toggleSource(viewKey, file.path);

  return true;
}

export function openWindowInEditor(open: Extract<DesktopWindowOpen, { kind: "file" }>): void {
  if (open.workspace !== undefined) commitHostWorkspace(open.workspace);
  const view = workbenchViewKey(open.workspace?.path);

  fileActions.open(view, { path: open.path });
  workbench.dispatch(view, { kind: "maximize" });
}

export function openFileInEditor(router: RegisteredRouter, path: string): void {
  uncoverPanes(router);
  fileActions.open(workbenchViewKey(currentWorkspacePath()), { path });
}

/** Shows the window a switch focused and lands it on the selection the switch carried; without one it stays as it was. */
export function arriveInWindow(
  router: RegisteredRouter,
  subject: ArrivalSubject | undefined,
): void {
  if (subject === undefined || windowApp() === "nyte") return;
  uncoverPanes(router);
  void landAt(subject);
}

/**
 * Runs `action` with `input`, the one path a key, a menu item, the command palette and a request
 * from outside the app all take. Returns false when the action has nothing to act on now. Throws
 * `invalid` when `input` is not what the action takes.
 */
export function runAction(router: RegisteredRouter, action: AppAction, input: Json): boolean {
  switch (action) {
    case "chat.new":
      if (settingsOpen(router)) closeSettings(router);
      windowTabs.newChat();

      return true;
    case "tab.new":
    case "tab.reopen":
      if (!windowTabs.strip) return false;

      if (settingsOpen(router)) closeSettings(router);
      windowTabs.dispatch({ kind: action === "tab.new" ? "new-tab" : "reopen-tab" });

      return true;
    case "tab.close":
      if (!windowTabs.strip) return false;

      if (settingsOpen(router)) closeSettings(router);
      else windowTabs.dispatch({ kind: "close-tab", tabId: windowTabs.getSnapshot().activeTabId });

      return true;
    case "folder.open":
      folderPicker()?.();

      return true;
    case "home.open":
      shellActions.showWorkspace();
      void activateWorkspace(null);

      return true;
    case "settings.open":
      return openSettings(router, read(action, APP_ACTIONS[action].input, input).page);
    case "customize.open": {
      const selection = activeSelection(windowTabs.panes().layout.getSnapshot());

      shellActions.openCustomize(selection.kind === "session" ? selection.sessionId : undefined);

      return true;
    }

    case "search.toggle":
      shellActions.toggleSearch();

      return true;
    case "sidebar.toggle":
      if (windowApp() === "code") toggleExplorer(workbenchViewKey(currentWorkspacePath()));
      else shellActions.toggleSidebar();

      return true;
    case "workbench.toggle":
      uncoverPanes(router);
      workbench.dispatch(workbenchViewKey(currentWorkspacePath()), {
        kind: windowApp() === "code" ? "toggle-maximized" : "toggle",
      });

      return true;
    case "terminal.toggle":
      uncoverPanes(router);
      toggleTerminal();

      return true;
    case "terminal.new":
      uncoverPanes(router);
      launch(workbenchViewKey(currentWorkspacePath()), "terminal");

      return true;
    case "browser.new":
      if (!clientCapabilities(nyte.host).browser) return false;
      uncoverPanes(router);
      launch(workbenchViewKey(currentWorkspacePath()), "browser");

      return true;
    case "pane.split":
      uncoverPanes(router);

      return splitPanes(
        windowTabs.panes(),
        read(action, APP_ACTIONS[action].input, input).direction,
      );
    case "markdown.source.toggle":
      return toggleMarkdownSource();
    case "pane.focus.next":
      return focusNextPane(windowTabs.panes());
    case "window.reload":
      window.location.reload();

      return true;
    case "app.open":
      return switchApp(read(action, APP_ACTIONS[action].input, input).app);
    default: {
      const _exhaustive: never = action;

      return _exhaustive;
    }
  }
}

function read<T extends TSchema>(action: AppAction, schema: T, input: Json): Static<T> {
  if (!Value.Check(schema, input)) {
    throw new SdkError("invalid", `That is not the input ${action} takes.`);
  }

  return input;
}

function openSettings(router: RegisteredRouter, page: string | undefined): boolean {
  const open = settingsOpen(router);

  if (page === undefined) {
    if (!open) {
      void router.navigate({
        to: "/settings/$section",
        params: { section: firstSettingsSection() },
      });
    }

    return true;
  }

  if (namesSettingsSection(page) && !showsSettingsSection(page)) return false;

  void router.navigate({
    to: "/settings/$section",
    params: { section: namesSettingsSection(page) ? page : customSection(page) },
    replace: open,
  });

  return true;
}
