import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { create, props } from "@stylexjs/stylex";
import { useRef, useState } from "react";
import type { ReactElement } from "react";
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
} from "../contract/client-actions.ts";
import { nyte } from "../contract/nyte.ts";
import { preferences, useSetting } from "../preferences/index.ts";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { WORKBENCH_KINDS } from "../workbench/model.ts";
import type { WorkbenchViewKey } from "../workbench/model.ts";
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
import { useFileClosing } from "./file-closing.tsx";
import { useRememberActiveFile } from "./remember-active-file.ts";
import { DiscardChanges } from "./discard-changes.tsx";
import { FileOptionsMenu } from "./file-options-menu.tsx";
import { EditorPalette } from "./editor-palette.tsx";
import { FileTabPanel } from "./file-tab-panel.tsx";

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
  explorerDocked,
  onToggleSidebar,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly chatFolder: SelectedWorkspace | undefined;
  readonly visible: boolean;
  readonly workspaceActive: boolean;
  readonly sidebarVisible: boolean;
  /** The explorer is the window's navigator: it sits at the start, shows however narrow the panel is, and the title bar toggles it. */
  readonly explorerDocked: boolean;
  readonly onToggleSidebar: () => void;
}): ReactElement {
  const treeStatusTheme = useTreeStatusTheme();
  const mac = nyte.platform === "darwin";
  const shown = workspaceActive && visible;
  const tabs = useFileTabs(viewKey);
  const activeFile = tabs.active;
  const pendingFile = tabs.pendingClose;

  const { workspace, files, changes, activeDocument } = useEditorData(shown, activeFile?.path);

  const { bodyRef, explorerShown, showSidebar, toggleSidebar } = useExplorerVisibility({
    shown,
    revealRevision: tabs.revealRevision,
    sidebarVisible,
    explorerDocked,
    onToggleSidebar,
  });

  const searchRef = useRef<HTMLDivElement>(null);

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
  const chosenSide = useSetting(preferences.editorSidePanel);
  const sidePanel = explorerDocked ? "start" : chosenSide;
  const autoSave = useSetting(preferences.fileAutoSave);

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

  const view = (
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

  const actions = (
    <>
      <FileOptionsMenu
        activeFile={activeFile}
        activeDocument={activeDocument}
        workspace={workspace}
        editors={editors}
        menuRef={menuRef}
        explorerDocked={explorerDocked}
        sidePanel={sidePanel}
        onCopyPath={copyPath}
        onDiscard={setDiscardPath}
      />
      <SidebarToggles
        explorerDocked={explorerDocked}
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

        if (!(event.metaKey || event.ctrlKey)) return;
        const key = event.key.toLowerCase();

        if (key === "s") {
          event.preventDefault();

          if (activeFile !== undefined) void editors.current.get(activeFile.id)?.save();
        }

        if (key === "f") {
          event.preventDefault();
          sidebar.showSearch();
        }

        const primary =
          !event.altKey &&
          (nyte.platform === "darwin"
            ? event.metaKey && !event.ctrlKey
            : event.ctrlKey && !event.metaKey);

        if (primary && event.key === "\\") {
          event.preventDefault();
          fileActions.split(viewKey, "after");

          return;
        }

        const query =
          primary && !event.shiftKey && key === "p"
            ? ""
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
          <div {...props(styles.groupTabs, hairline.blockEnd)}>
            {tabs.groups.map((group, index) => (
              <EditorTabs
                key={group.id}
                viewKey={viewKey}
                group={group}
                index={index}
                focused={group.id === tabs.group}
                many={tabs.groups.length > 1}
                onClose={closeFile}
                onCloseGroup={closeGroup}
                leading={index === 0 && navigation}
                path={index === tabs.groups.length - 1 && path}
                view={index === tabs.groups.length - 1 && view}
                actions={index === tabs.groups.length - 1 && actions}
              />
            ))}
          </div>
          {copyError !== undefined && (
            <div role="alert" {...props(styles.empty)}>
              Could not copy path. {copyError}
            </div>
          )}
          <div {...props(styles.editors)}>
            {tabs.groups.map((group, index) => (
              <EditorGroupView
                key={group.id}
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
                    onShowExplorer={() => {
                      sidebar.select("explorer");
                      showSidebar();
                    }}
                    onSearch={sidebar.showSearch}
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
            ))}
          </div>
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
            shown={shown}
            sidePanel={sidePanel}
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
    </section>
  );
}
