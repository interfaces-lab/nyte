import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { create, props } from "@stylexjs/stylex";
import { useRef, useState } from "react";
import type { ReactElement, ReactNode } from "react";
import { createPortal } from "react-dom";
import type { SelectedWorkspace } from "../contract/bridge.ts";
import { errorMessage } from "../contract/errors.ts";
import { Button } from "@nyte-ai/ui/button";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import {
  clientActionAriaShortcut,
  clientActionKeys,
  clientActions,
  clientCapabilities,
} from "../contract/client-actions.ts";
import { nyte } from "../contract/nyte.ts";
import { preferences, useSetting } from "../preferences/index.ts";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { WORKBENCH_KINDS } from "../workbench/model.ts";
import type { WorkbenchViewKey } from "../workbench/model.ts";
import { workbenchScope } from "../workbench/paths.ts";
import { shownDockTab } from "../workbench/selectors.ts";
import { useWorkbenchViewState, workbench } from "../workbench/store.ts";
import { useWindowActionsSlot } from "../workbench/window-actions.ts";
import { FileBreadcrumbs } from "./file-breadcrumbs.tsx";
import { EditorEmptyState } from "./editor-empty-state.tsx";
import type { FileEditorHandle } from "./file-editor.tsx";
import { fileActions, useFileTabs } from "./file-store.ts";
import { opensAsMarkdown } from "./markdown-parse.ts";
import { useTreeStatusTheme } from "./tree-theme.ts";
import { findSymbols } from "./outline.ts";
import { EditorGroupView } from "./editor-groups.tsx";
import { EditorTabs } from "./editor-tabs.tsx";
import { useEditorData } from "./editor-data.ts";
import { useExplorerVisibility } from "./explorer-visibility.ts";
import { EditorSidebar, SidebarToggles, useSidebarTab } from "./editor-sidebar.tsx";
import type { SidebarTabName } from "./editor-sidebar.tsx";
import type { ExplorerHandle } from "./files-explorer.tsx";
import { useFileClosing } from "./file-closing.tsx";
import { useRememberActiveFile } from "./remember-active-file.ts";
import { DiscardChanges } from "./discard-changes.tsx";
import { FileOptionsMenu } from "./file-options-menu.tsx";
import { EditorPalette } from "./editor-palette.tsx";
import type { PaletteCommand } from "./file-palette.tsx";
import { FileTabPanel } from "./file-tab-panel.tsx";
import { appCommands } from "./editor-commands.ts";
import { EditorStatusBar } from "./editor-status-bar.tsx";
import { EditorStatusSlot } from "./status-slot.ts";
import { EditorWindowActions, MoreMenuItems } from "./editor-window-actions.tsx";
import { tabSuffixes } from "./tab-suffix.ts";

const NO_SUFFIXES: ReadonlyMap<string, string> = new Map();

const styles = create({
  panel: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  dirty: {
    flexShrink: 0,
    color: role.contentSecondary,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
  },
  body: { display: "flex", flex: 1, minWidth: 0, minHeight: 0 },
  editorArea: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 },
  groupTabs: { display: "flex", flexShrink: 0, minWidth: 0 },
  editors: { display: "flex", flex: 1, minWidth: 0, minHeight: 0 },
  empty: {
    padding: space.s5,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
});

export function EditorPanel({
  viewKey,
  chatFolder,
  visible,
  workspaceActive,
  sidebarVisible,
  main,
  dock,
  changes: changesView,
  onToggleSidebar,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly chatFolder: SelectedWorkspace | undefined;
  readonly visible: boolean;
  readonly workspaceActive: boolean;
  readonly sidebarVisible: boolean;
  /**
   * The Editor is the window's main area. Its explorer is the window's navigator, sits at the start and shows however
   * narrow the panel is. Its file actions live in the title bar, and one status bar runs under it.
   */
  readonly main: boolean;
  /** The dock, shown under the editors. */
  readonly dock?: ReactNode;
  /** The sidebar's Changes view. */
  readonly changes?: ReactNode;
  readonly onToggleSidebar: () => void;
}): ReactElement {
  const treeStatusTheme = useTreeStatusTheme();
  const mac = nyte.platform === "darwin";
  const shown = workspaceActive && visible;
  const tabs = useFileTabs(viewKey);
  const activeFile = tabs.active;
  const pendingFile = tabs.pendingClose;

  const { workspace, files, changes, branch, activeDocument } = useEditorData(
    shown,
    activeFile?.path,
  );

  const { bodyRef, explorerShown, showSidebar, toggleSidebar } = useExplorerVisibility({
    shown,
    revealRevision: tabs.revealRevision,
    sidebarVisible,
    main,
    onToggleSidebar,
  });

  const searchRef = useRef<HTMLDivElement>(null);
  const explorer = useRef<ExplorerHandle>(null);

  const sidebar = useSidebarTab({
    revealRevision: tabs.revealRevision,
    searchRef,
    showSidebar,
  });

  const { panelRef, closeFile, closeGroup, confirmation } = useFileClosing({
    viewKey,
    groups: tabs.groups,
    pendingFile,
  });

  useRememberActiveFile({ viewKey, activeFile, tabs: tabs.tabs, shown });
  const editors = useRef(new Map<string, FileEditorHandle>());
  const [discardPath, setDiscardPath] = useState<string>();
  const menuRef = useRef<HTMLButtonElement>(null);
  const [copyError, setCopyError] = useState<string>();
  const [palette, setPalette] = useState<string>();
  const [statusSlot, setStatusSlot] = useState<HTMLDivElement | null>(null);
  const windowActions = useWindowActionsSlot();
  const view = useWorkbenchViewState(viewKey);
  const chosenSide = useSetting(preferences.editorSidePanel);
  const sidePanel = main ? "start" : chosenSide;
  const autoSave = useSetting(preferences.fileAutoSave);
  const mod = mac ? "⌘" : "Ctrl";
  const shift = mac ? "⇧" : "Shift";

  const dockShown =
    shownDockTab(view, workbenchScope(viewKey), clientCapabilities(nyte.host)) !== undefined;

  const copyPath = (value: string): void => {
    void navigator.clipboard
      .writeText(value)
      .then(() => setCopyError(undefined))
      .catch((cause: unknown) => setCopyError(errorMessage(cause)));
  };

  const activeContents =
    activeFile?.draft?.contents ??
    (activeDocument?.kind === "text" ? activeDocument.contents : undefined);

  const symbols =
    activeFile === undefined || activeContents === undefined
      ? []
      : findSymbols(activeFile.path, activeContents);

  const toggleView = (tab: SidebarTabName): void => {
    if (!explorerShown || sidebar.tab !== tab) {
      sidebar.show(tab);

      return;
    }
    toggleSidebar();
    requestAnimationFrame(() => {
      const panel = panelRef.current;

      if (panel === null || panel.contains(document.activeElement)) return;

      if (activeFile === undefined) {
        panel.querySelector<HTMLInputElement>("[data-editor-groups] input")?.focus();

        return;
      }
      fileActions.focusActive(viewKey);

      requestAnimationFrame(() => {
        if (panel.contains(document.activeElement)) return;
        document.getElementById(`${viewKey}-file-tab-${activeFile.id}`)?.focus();
      });
    });
  };

  const newFile = (): void => {
    sidebar.show("explorer");
    requestAnimationFrame(() => explorer.current?.newFile());
  };

  const split = (): void => fileActions.split(viewKey, "after");

  const formatCommand: readonly PaletteCommand[] =
    activeFile !== undefined && activeDocument?.kind === "text"
      ? [
          {
            key: "format-document",
            group: "Editor",
            label: "Format Document",
            icon: "brackets",
            keys: [],
            run: () => void editors.current.get(activeFile.id)?.format(),
          },
        ]
      : [];

  const editorCommands: readonly PaletteCommand[] = [
    {
      key: "new-file",
      group: "Editor",
      label: "New File",
      icon: "file-add",
      keys: [mod, "N"],
      run: newFile,
    },
    {
      key: "split-editor",
      group: "Editor",
      label: "Split Editor Right",
      icon: "split-right",
      keys: [mod, "\\"],
      run: split,
    },
    ...formatCommand,
    {
      key: "go-to-file",
      group: "Editor",
      label: "Go to File…",
      icon: "file",
      keys: [mod, "P"],
      run: () => setPalette(""),
    },
    {
      key: "go-to-symbol",
      group: "Editor",
      label: "Go to Symbol in File…",
      icon: "brackets",
      keys: [shift, mod, "O"],
      run: () => setPalette("@"),
    },
    {
      key: "go-to-line",
      group: "Editor",
      label: "Go to Line…",
      icon: "list",
      keys: [mac ? "⌃" : "Ctrl", "G"],
      run: () => setPalette(":"),
    },
    {
      key: "search-files",
      group: "Editor",
      label: "Search in Files",
      icon: "search",
      keys: [shift, mod, "F"],
      run: () => sidebar.show("search"),
    },
    {
      key: "show-changes",
      group: "Editor",
      label: "Show Changes",
      icon: "git-branch",
      keys: [],
      run: () => sidebar.show("changes"),
    },
  ];

  const navigation = (
    <>
      <Button
        size="sm"
        iconOnly
        icon="arrow-left"
        aria-label="Go back"
        disabled={!tabs.canGoBack}
        onClick={() => fileActions.back(viewKey)}
      />
      <Button
        size="sm"
        iconOnly
        icon="arrow-right"
        aria-label="Go forward"
        disabled={!tabs.canGoForward}
        onClick={() => fileActions.forward(viewKey)}
      />
    </>
  );

  const path = (
    <FileBreadcrumbs
      path={activeFile?.displayPath}
      external={activeFile?.external === true}
      files={files.data}
      onOpen={(file) => fileActions.open(viewKey, { ...file, preview: true })}
    />
  );

  const fileView = (
    <>
      {activeFile?.dirty && (
        <span aria-label="Unsaved changes" {...props(styles.dirty)}>
          ●
        </span>
      )}
      {activeFile !== undefined &&
        activeDocument?.kind === "text" &&
        opensAsMarkdown(activeFile.path) && (
          <Tooltip>
            <TooltipTrigger
              render={
                <ToggleGroup
                  aria-label="Markdown View"
                  aria-keyshortcuts={clientActionAriaShortcut(clientActions.markdownSource, mac)}
                  value={[activeFile.showSource ? "source" : "document"]}
                  onValueChange={(value) => {
                    const next = value[0];

                    if (next === "document" || next === "source") {
                      fileActions.setShowSource(viewKey, activeFile.path, next === "source");
                    }
                  }}
                >
                  <Toggle value="document" size="2xs">
                    Document
                  </Toggle>
                  <Toggle value="source" size="2xs">
                    Source
                  </Toggle>
                </ToggleGroup>
              }
            />
            <TooltipContent shortcut={clientActionKeys(clientActions.markdownSource, mac)}>
              {activeFile.showSource ? "View Document" : "View Source"}
            </TooltipContent>
          </Tooltip>
        )}
    </>
  );

  const optionsMenu = (
    <FileOptionsMenu
      activeFile={activeFile}
      activeDocument={activeDocument}
      workspace={workspace}
      editors={editors}
      menuRef={menuRef}
      main={main}
      sidePanel={sidePanel}
      leading={
        main && (
          <MoreMenuItems
            files={tabs.tabs}
            active={activeFile?.id}
            mac={mac}
            onSelect={(id) => workbench.dispatch(viewKey, { kind: "activate", id })}
          />
        )
      }
      onCopyPath={copyPath}
      onDiscard={setDiscardPath}
    />
  );

  const actions = !main && (
    <>
      {optionsMenu}
      <SidebarToggles
        sidePanel={sidePanel}
        explorerShown={explorerShown}
        sidebar={sidebar}
        onToggle={toggleSidebar}
      />
    </>
  );

  return (
    <section
      ref={panelRef}
      data-editor-panel
      aria-label={WORKBENCH_KINDS.editor.label}
      {...props(styles.panel, treeStatusTheme)}
      onMouseUp={(event) => {
        if (!shown || (event.button !== 3 && event.button !== 4)) return;
        event.preventDefault();

        if (event.button === 3) fileActions.back(viewKey);
        else fileActions.forward(viewKey);
      }}
      onKeyDownCapture={(event) => {
        if (!shown || event.defaultPrevented || event.nativeEvent.isComposing) return;

        if (!(event.target instanceof Node) || !event.currentTarget.contains(event.target)) return;

        if (!(event.metaKey || event.ctrlKey)) return;
        const key = event.key.toLowerCase();

        const primary =
          !event.altKey &&
          (nyte.platform === "darwin"
            ? event.metaKey && !event.ctrlKey
            : event.ctrlKey && !event.metaKey);

        const docked =
          event.target instanceof Element && event.target.closest("[data-workbench-dock]") !== null;

        if (docked && !(primary && event.shiftKey && (key === "f" || key === "p"))) return;

        if (key === "s") {
          event.preventDefault();

          if (activeFile !== undefined) void editors.current.get(activeFile.id)?.save();
        }

        if (key === "f" && (!main || (primary && event.shiftKey))) {
          event.preventDefault();

          if (main) toggleView("search");
          else sidebar.show("search");
        }

        if (main && primary && !event.shiftKey && key === "n") {
          event.preventDefault();
          newFile();

          return;
        }

        if (primary && event.key === "\\") {
          event.preventDefault();
          split();

          return;
        }

        const query =
          primary && !event.shiftKey && key === "p"
            ? ""
            : main && primary && event.shiftKey && key === "p"
              ? ">"
              : primary && event.shiftKey && key === "o"
                ? "@"
                : event.ctrlKey && !event.metaKey && !event.altKey && !event.shiftKey && key === "g"
                  ? ":"
                  : undefined;

        if (query === undefined) return;
        event.preventDefault();
        setPalette(query);
      }}
    >
      <div ref={bodyRef} {...props(styles.body)}>
        <div {...props(styles.editorArea)}>
          <div {...props(styles.groupTabs)}>
            {tabs.groups.map((group, index) => (
              <EditorTabs
                key={group.id}
                viewKey={viewKey}
                group={group}
                index={index}
                focused={group.id === tabs.group}
                many={tabs.groups.length > 1}
                main={main}
                suffixes={
                  main
                    ? tabSuffixes(
                        tabs.tabs.map((file) => file.displayPath),
                        workspace?.name ?? "",
                      )
                    : NO_SUFFIXES
                }
                onClose={closeFile}
                onCloseGroup={closeGroup}
                leading={index === 0 && navigation}
                path={!main && index === tabs.groups.length - 1 && path}
                view={index === tabs.groups.length - 1 && fileView}
                actions={index === tabs.groups.length - 1 && actions}
              />
            ))}
          </div>
          {copyError !== undefined && (
            <div role="alert" {...props(styles.empty)}>
              Could not copy path. {copyError}
            </div>
          )}
          <div data-editor-groups {...props(styles.editors)}>
            {tabs.groups.map((group, index) => (
              <EditorStatusSlot
                key={group.id}
                value={main ? (group.id === tabs.group ? statusSlot : null) : undefined}
              >
                <EditorGroupView
                  viewKey={viewKey}
                  group={group}
                  index={index}
                  many={tabs.groups.length > 1}
                  focused={group.id === tabs.group}
                >
                  {group.id === tabs.group && group.active === undefined && (
                    <EditorEmptyState
                      files={files.data}
                      changes={changes}
                      explorerVisible={explorerShown && sidebar.tab === "explorer"}
                      onOpen={(file) => fileActions.open(viewKey, { ...file, preview: true })}
                      onShowExplorer={() => sidebar.show("explorer")}
                      onSearch={() => sidebar.show("search")}
                      searchKeys={main ? [shift, mod, "F"] : [mod, "F"]}
                      onNewFile={main ? newFile : undefined}
                    />
                  )}
                  {group.tabs.map((file) => (
                    <FileTabPanel
                      key={file.id}
                      viewKey={viewKey}
                      file={file}
                      group={group}
                      editors={editors}
                      shown={shown}
                      autoSave={
                        autoSave &&
                        workspaceActive &&
                        tabs.tabs.find((tab) => tab.path === file.path)?.id === file.id &&
                        tabs.pendingClose?.id !== file.id &&
                        discardPath !== file.path
                      }
                      onGoToLine={() => setPalette(":")}
                    />
                  ))}
                </EditorGroupView>
              </EditorStatusSlot>
            ))}
          </div>
          {dock}
          {main && (
            <EditorStatusBar
              branch={branch}
              slot={setStatusSlot}
              onBranch={() => sidebar.show("changes")}
            />
          )}
        </div>
        {explorerShown && (
          <EditorSidebar
            viewKey={viewKey}
            chatFolder={chatFolder}
            workspace={workspace}
            files={files}
            changes={changes}
            outline={{ path: activeFile?.path, symbols }}
            tabs={tabs.tabs}
            sidebar={sidebar}
            searchRef={searchRef}
            explorer={explorer}
            shown={shown}
            sidePanel={sidePanel}
            main={main}
            changesView={changesView}
            onCopyPath={copyPath}
          />
        )}
      </div>
      <EditorPalette
        viewKey={viewKey}
        query={palette}
        files={files}
        recent={tabs.recent}
        activeFile={activeFile}
        activeContents={activeContents}
        symbols={symbols}
        commands={
          main ? [...editorCommands, ...appCommands(mac, clientCapabilities(nyte.host))] : undefined
        }
        shortcut={main ? [shift, mod, "P"] : undefined}
        onQueryChange={setPalette}
      />
      {confirmation}
      <DiscardChanges
        discardPath={discardPath}
        onClose={() => setDiscardPath(undefined)}
        menuRef={menuRef}
        tabs={tabs.tabs}
        editors={editors}
      />
      {main &&
        shown &&
        windowActions !== null &&
        createPortal(
          <EditorWindowActions
            mac={mac}
            canSplit={activeFile !== undefined}
            dockShown={dockShown}
            onSplit={split}
            menu={optionsMenu}
          />,
          windowActions,
        )}
    </section>
  );
}
