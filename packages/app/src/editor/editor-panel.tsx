import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { create, props } from "@stylexjs/stylex";
import { useEffect, useEffectEvent, useLayoutEffect, useRef, useState } from "react";
import type { ReactElement, RefObject } from "react";
import { worktreeFiles } from "./worktree-files.ts";
import { useChatChanges } from "./chat-changes.ts";
import type { SelectedWorkspace } from "../contract/bridge.ts";
import { errorMessage } from "../contract/errors.ts";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuSwitchItem,
  MenuTrigger,
} from "@nyte-ai/ui/menu";
import { revealLabel } from "../components/context-menu.ts";
import { PanelToggleIcon } from "@nyte-ai/ui/icon";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { Button } from "@nyte-ai/ui/button";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { Tooltip, TooltipContent, TooltipTrigger } from "@nyte-ai/ui/tooltip";
import {
  clientActionAriaShortcut,
  clientActionKeys,
  clientActions,
} from "../contract/client-actions.ts";
import { nyte, windowApp } from "../contract/nyte.ts";
import { preferences, useSetting } from "../preferences/index.ts";
import type { Preference } from "../preferences/index.ts";
import { useVcsSnapshot } from "../data/vcs.ts";
import { useDocument } from "../data/documents.ts";
import { useMentionFiles } from "../data/files.ts";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { EDITOR_SLOT, WORKBENCH_KINDS } from "../workbench/model.ts";
import type { EditorGroupId, WorkbenchTabId, WorkbenchViewKey } from "../workbench/model.ts";
import { FileBreadcrumbs } from "./file-breadcrumbs.tsx";
import { WorkspaceFileEditor } from "./file-editor.tsx";
import { EditorEmptyState } from "./editor-empty-state.tsx";
import type { FileEditorHandle } from "./file-editor.tsx";
import { fileActions, useFileTabs } from "./file-store.ts";
import { opensAsMarkdown } from "./markdown-parse.ts";
import { WorkspaceSearch } from "../workbench/workspace-search.tsx";
import { useTreeStatusTheme } from "./tree-theme.ts";
import { FilePalette } from "./file-palette.tsx";
import { FilesExplorer } from "./files-explorer.tsx";
import { findSymbols } from "./outline.ts";
import { opensUnwrapped } from "./long-line.ts";
import { characterAtColumn, lineAt, TAB_COLUMNS } from "./indentation.ts";
import { EditorGroupView } from "./editor-groups.tsx";
import { EditorTabs } from "./editor-tabs.tsx";
import { SidePanel, sidePanelWidth } from "../workbench/side-panel.tsx";
import { workspaceFile } from "../workbench/paths.ts";
import { useWorkbenchWorkspace } from "../workbench/workbench-workspace.tsx";

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
  filePanel: { position: "absolute", inset: 0, display: "flex", minWidth: 0, minHeight: 0 },
  explorer: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 },
  sidebarBody: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 },
  hidden: { display: "none" },
  empty: {
    padding: space.s5,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
  },
  menu: {
    minWidth: "min(220px, var(--available-width))",
    maxWidth: "min(420px, var(--available-width))",
  },
});

const EDITOR_MIN_WIDTH = 700;

const FILE_TOGGLES = [
  ["Line Numbers", preferences.fileLineNumbers],
  ["Word Wrap", preferences.fileWordWrap],
  ["Git Blame", preferences.fileGitBlame],
  ["Auto Save", preferences.fileAutoSave],
  ["Format on Save", preferences.fileFormatOnSave],
] as const;

function FilePreferenceItem({
  label,
  setting,
  overridden,
}: {
  readonly label: string;
  readonly setting: Preference<boolean>;
  readonly overridden: boolean;
}): ReactElement {
  const checked = useSetting(setting);

  return (
    <MenuSwitchItem
      layout="plain"
      checked={checked && !overridden}
      disabled={overridden}
      onCheckedChange={setting.set}
    >
      {overridden ? `${label} (Line Too Long)` : label}
    </MenuSwitchItem>
  );
}

async function discardEdits(editor: FileEditorHandle | undefined): Promise<string | undefined> {
  if (editor === undefined) return "The file is not ready to reload.";

  try {
    await editor.discard();

    return undefined;
  } catch (cause: unknown) {
    return errorMessage(cause);
  }
}

export function EditorPanel({
  viewKey,
  chatFolder,
  visible,
  workspaceActive,
  sidebarVisible,
  onToggleSidebar,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly chatFolder: SelectedWorkspace | undefined;
  readonly visible: boolean;
  readonly workspaceActive: boolean;
  readonly sidebarVisible: boolean;
  readonly onToggleSidebar: () => void;
}): ReactElement {
  const treeStatusTheme = useTreeStatusTheme();
  const mac = nyte.platform === "darwin";
  const shown = workspaceActive && visible;
  const browsed = useWorkbenchWorkspace();
  const workspace = browsed.kind === "ready" ? browsed.workspace : undefined;
  const files = useMentionFiles(workspace, shown && workspace !== undefined);

  const vcs = useVcsSnapshot(workspace?.id, shown);

  const chatFiles = useChatChanges(vcs.data?.kind === "none" ? workspace?.id : undefined, (edits) =>
    edits?.map((edit) => ({
      path:
        workspace === undefined
          ? edit.path
          : (workspaceFile(edit.path, [workspace.path])?.relative ?? edit.path),
      kind: edit.status,
    })),
  );

  const changes = vcs.data?.kind === "repository" ? worktreeFiles(vcs.data) : (chatFiles ?? []);

  const tabs = useFileTabs(viewKey);
  const autoSave = useSetting(preferences.fileAutoSave);
  const code = windowApp() === "code";
  const chosenSide = useSetting(preferences.editorSidePanel);
  const sidePanel = code ? "start" : chosenSide;

  const [sidebarSelection, setSidebarSelection] = useState<{
    readonly revision: number;
    readonly tab: "explorer" | "search";
  }>({ revision: tabs.revealRevision, tab: "explorer" });

  const sidebar =
    sidebarSelection.revision === tabs.revealRevision ? sidebarSelection.tab : "explorer";

  const [searchOpened, setSearchOpened] = useState(false);
  const [discardPath, setDiscardPath] = useState<string>();
  const [discarding, setDiscarding] = useState(false);
  const [discardError, setDiscardError] = useState<string>();
  const [copyError, setCopyError] = useState<string>();
  const [palette, setPalette] = useState<string>();
  const menuRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const editors = useRef(new Map<string, FileEditorHandle>());
  const activeFile = tabs.active;
  const pendingFile = tabs.pendingClose;
  const panelRef = useRef<HTMLElement>(null);
  const bodyRef = useRef<HTMLDivElement>(null);
  const cramped = useCramped(bodyRef);
  const [choice, setChoice] = useState({ shown: false, revision: tabs.revealRevision });
  const insisted = choice.shown || choice.revision !== tabs.revealRevision;
  const explorerShown = sidebarVisible && (code || !cramped || insisted);
  const closeOrigin = useRef<WorkbenchTabId | undefined>(undefined);
  const activeDocument = useDocument(activeFile?.path).data;

  const formats =
    activeDocument?.kind === "text" &&
    workspace !== undefined &&
    workspaceFile(activeDocument.path, [workspace.path]) !== undefined;

  const unsaved = activeFile?.dirty === true;

  const restoreFileFocus = (): HTMLElement | null =>
    (closeOrigin.current === undefined
      ? null
      : document.getElementById(`${viewKey}-file-tab-${closeOrigin.current}`)) ??
    panelRef.current?.querySelector<HTMLElement>(
      '[data-editor-tabs][data-focused] [role="tab"][aria-selected="true"]',
    ) ??
    document.getElementById(`${viewKey}-tab-${EDITOR_SLOT}`) ??
    document.getElementById("workbench-toggle");

  const closeFile = (id: WorkbenchTabId): void => {
    closeOrigin.current = id;

    if (!fileActions.close(viewKey, id)) return;
    closeOrigin.current = undefined;
    requestAnimationFrame(() => restoreFileFocus()?.focus());
  };

  const closeGroup = (group: EditorGroupId): void => {
    closeOrigin.current = tabs.groups.find((entry) => entry.id === group)?.active?.id;

    if (!fileActions.closeGroup(viewKey, group)) return;
    closeOrigin.current = undefined;
    requestAnimationFrame(() => restoreFileFocus()?.focus());
  };

  const showSidebar = (): void => {
    if (cramped) setChoice({ shown: true, revision: tabs.revealRevision });

    if (!sidebarVisible) onToggleSidebar();
  };

  const toggleSidebar = (): void => {
    if (!explorerShown) {
      showSidebar();

      return;
    }

    setChoice({ shown: false, revision: tabs.revealRevision });
    onToggleSidebar();
  };

  const stepHistory = useEffectEvent((event: KeyboardEvent): void => {
    const target = event.target;

    if (!shown || event.defaultPrevented || event.isComposing) return;

    if (
      target !== document.body &&
      !(target instanceof Node && panelRef.current?.contains(target) === true)
    ) {
      return;
    }
    const step = historyKey(event, nyte.platform === "darwin");

    if (step === undefined) return;
    event.preventDefault();
    event.stopPropagation();

    if (step === "forward") fileActions.forward(viewKey);
    else fileActions.back(viewKey);
  });

  useMountEffect(() => {
    const listener = (event: KeyboardEvent): void => stepHistory(event);
    window.addEventListener("keydown", listener, true);

    return () => window.removeEventListener("keydown", listener, true);
  });

  const revealed = useRef(0);
  // oxlint-disable-next-line nyte-code/no-direct-effect -- consumes an explicit Explorer reveal request from the file store
  useEffect(() => {
    if (!shown || tabs.revealRevision === revealed.current) return;
    revealed.current = tabs.revealRevision;

    if (!sidebarVisible) onToggleSidebar();
  }, [shown, tabs.revealRevision, sidebarVisible, onToggleSidebar]);

  const showSearch = (): void => {
    showSidebar();
    setSearchOpened(true);
    setSidebarSelection({ revision: tabs.revealRevision, tab: "search" });
    requestAnimationFrame(() => searchRef.current?.querySelector("input")?.focus());
  };

  const copyPath = (value: string): void => {
    void navigator.clipboard
      .writeText(value)
      .then(() => setCopyError(undefined))
      .catch((cause: unknown) => setCopyError(errorMessage(cause)));
  };

  const revealPath = nyte.host.revealPath;

  const drafts = tabs.tabs.flatMap((file) =>
    file.draft === undefined ? [] : [{ path: file.path, contents: file.draft.contents }],
  );

  const activeContents =
    activeFile?.draft?.contents ??
    (activeDocument?.kind === "text" ? activeDocument.contents : undefined);

  const symbols =
    activeFile === undefined || activeContents === undefined
      ? []
      : findSymbols(activeFile.path, activeContents);

  const visitedFile = useRef<
    | {
        readonly viewKey: WorkbenchViewKey;
        readonly file: typeof activeFile;
      }
    | undefined
  >(undefined);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- records activation from tab clicks and group focus in the file store
  useEffect(() => {
    if (!shown) return;
    const previous = visitedFile.current;
    visitedFile.current = { viewKey, file: activeFile };

    if (activeFile === undefined) return;

    if (previous?.viewKey === viewKey) {
      if (previous.file?.id === activeFile.id && previous.file.path === activeFile.path) return;

      if (previous.file !== undefined && !tabs.tabs.some((file) => file.id === previous.file?.id)) {
        return;
      }
    }

    fileActions.remember(viewKey, activeFile.path);
  }, [shown, activeFile, tabs.tabs, viewKey]);

  const recentFiles = tabs.recent.flatMap((path) => {
    const file = files.data?.find((entry) => entry.path === path);

    return file === undefined ? [] : [file];
  });

  const discard = async (): Promise<void> => {
    if (discardPath === undefined) return;
    setDiscarding(true);
    const holder = tabs.tabs.find((tab) => tab.path === discardPath);

    const failure = await discardEdits(
      holder === undefined ? undefined : editors.current.get(holder.id),
    );

    setDiscarding(false);

    if (failure !== undefined) {
      setDiscardError(failure);

      return;
    }

    setDiscardPath(undefined);
    setDiscardError(undefined);
  };

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
      <Menu>
        <MenuTrigger
          render={
            <Button
              size="sm"
              iconOnly
              ref={menuRef}
              icon="more-horizontal"
              aria-label="File options"
            />
          }
        />
        <MenuContent align="end" xstyle={styles.menu}>
          <MenuItem
            layout="plain"
            meta={nyte.platform === "darwin" ? "⌘S" : "Ctrl+S"}
            disabled={!unsaved}
            onClick={() => {
              if (activeFile !== undefined) void editors.current.get(activeFile.id)?.save();
            }}
          >
            Save File
          </MenuItem>
          {formats && (
            <MenuItem
              layout="plain"
              onClick={() => {
                if (activeFile !== undefined) void editors.current.get(activeFile.id)?.format();
              }}
            >
              Format Document
            </MenuItem>
          )}
          <MenuSeparator inset />
          <MenuItem
            layout="plain"
            disabled={activeFile === undefined}
            onClick={() => {
              if (activeFile !== undefined) copyPath(activeFile.path);
            }}
          >
            Copy Path
          </MenuItem>
          <MenuItem
            layout="plain"
            disabled={activeFile === undefined || activeFile.external}
            onClick={() => {
              if (activeFile !== undefined) copyPath(activeFile.displayPath);
            }}
          >
            Copy Relative Path
          </MenuItem>
          {revealPath !== undefined && (
            <MenuItem
              layout="plain"
              disabled={activeFile === undefined}
              onClick={() => {
                if (activeFile !== undefined) void revealPath({ path: activeFile.path });
              }}
            >
              {revealLabel(nyte.platform)}
            </MenuItem>
          )}
          <MenuSeparator inset />
          {FILE_TOGGLES.map(([label, setting]) => (
            <FilePreferenceItem
              key={label}
              label={label}
              setting={setting}
              overridden={
                setting === preferences.fileWordWrap &&
                activeDocument?.kind === "text" &&
                opensUnwrapped(activeDocument.contents)
              }
            />
          ))}
          {!code && (
            <MenuItem
              layout="plain"
              onClick={() =>
                preferences.editorSidePanel.set(sidePanel === "start" ? "end" : "start")
              }
            >
              {sidePanel === "start" ? "Move Side Panel Right" : "Move Side Panel Left"}
            </MenuItem>
          )}
          <MenuSeparator inset />
          <MenuItem
            layout="plain"
            variant={unsaved ? "danger" : "default"}
            disabled={!unsaved}
            onClick={() => {
              setDiscardError(undefined);
              setDiscardPath(activeFile?.path);
            }}
          >
            Discard Changes…
          </MenuItem>
        </MenuContent>
      </Menu>
      <Toggle
        size="sm"
        iconOnly
        icon="search"
        aria-label="Search Files"
        pressed={explorerShown && sidebar === "search"}
        onPressedChange={(pressed) =>
          pressed
            ? showSearch()
            : setSidebarSelection({ revision: tabs.revealRevision, tab: "explorer" })
        }
      />
      {!code && (
        <Toggle
          size="sm"
          iconOnly
          indicator="glyph"
          aria-label={`${WORKBENCH_KINDS.editor.label} Sidebar`}
          pressed={explorerShown}
          onPressedChange={toggleSidebar}
        >
          <PanelToggleIcon
            side={sidePanel === "start" ? "left" : "right"}
            visible={explorerShown}
          />
        </Toggle>
      )}
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
          showSearch();
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
                    explorerVisible={explorerShown && sidebar === "explorer"}
                    onOpen={(file) => fileActions.open(viewKey, { ...file, preview: true })}
                    onShowExplorer={() => {
                      setSidebarSelection({ revision: tabs.revealRevision, tab: "explorer" });
                      showSidebar();
                    }}
                    onSearch={showSearch}
                  />
                )}
                {group.tabs.map((file) => (
                  <div
                    key={file.id}
                    id={`${viewKey}-file-panel-${file.id}`}
                    role="tabpanel"
                    aria-labelledby={`${viewKey}-file-tab-${file.id}`}
                    hidden={file.id !== group.active?.id}
                    {...props(styles.filePanel)}
                  >
                    <WorkspaceFileEditor
                      ref={(editor) => {
                        if (editor === null) editors.current.delete(file.id);
                        else editors.current.set(file.id, editor);
                      }}
                      viewKey={viewKey}
                      file={file}
                      active={shown && file.id === group.active?.id}
                      visible={file.id === group.active?.id}
                      autoSave={
                        autoSave &&
                        workspaceActive &&
                        tabs.tabs.find((tab) => tab.path === file.path)?.id === file.id &&
                        tabs.pendingClose?.id !== file.id &&
                        discardPath !== file.path
                      }
                      onGoToLine={() => setPalette(":")}
                    />
                  </div>
                ))}
              </EditorGroupView>
            ))}
          </div>
        </div>
        {explorerShown && (
          <SidePanel side={sidePanel}>
            <aside
              aria-label={sidebar === "search" ? "Workspace search" : "Explorer"}
              {...props(styles.explorer)}
            >
              <div {...props(styles.sidebarBody, sidebar !== "explorer" && styles.hidden)}>
                <FilesExplorer
                  viewKey={viewKey}
                  chatFolder={chatFolder}
                  workspace={workspace}
                  files={files}
                  changes={changes}
                  outline={{ path: activeFile?.path, symbols }}
                  onSearch={showSearch}
                  onCopyPath={copyPath}
                />
              </div>
              <div
                ref={searchRef}
                {...props(styles.sidebarBody, sidebar !== "search" && styles.hidden)}
              >
                {searchOpened && (
                  <WorkspaceSearch
                    active={shown && sidebar === "search"}
                    drafts={drafts}
                    onOpen={(location) =>
                      fileActions.open(viewKey, {
                        path: location.path,
                        target: {
                          kind: "match",
                          line: location.line,
                          column: location.column,
                          length: location.length,
                        },
                      })
                    }
                  />
                )}
              </div>
            </aside>
          </SidePanel>
        )}
      </div>
      <FilePalette
        query={palette}
        files={files.data}
        recent={recentFiles}
        filesError={files.error}
        onRetryFiles={() => void files.refetch()}
        active={
          activeFile === undefined || activeContents === undefined
            ? undefined
            : { path: activeFile.path, contents: activeContents, symbols }
        }
        onQueryChange={setPalette}
        onClose={() => setPalette(undefined)}
        onOpenFile={(file) => fileActions.open(viewKey, file)}
        onGoTo={(line, column) => {
          if (activeFile === undefined) return;

          const text = fileActions
            .documents(viewKey)
            .find((document) => document.path === activeFile.path)?.contents;

          fileActions.open(viewKey, {
            path: activeFile.path,
            target: {
              kind: "position",
              line,
              column:
                column === undefined || text === undefined
                  ? column
                  : characterAtColumn(lineAt(text, line - 1), column - 1, TAB_COLUMNS) + 1,
            },
          });
        }}
      />
      <ConfirmDialog
        open={pendingFile !== undefined}
        pending={pendingFile?.saving === true}
        pendingLabel="Saving…"
        finalFocus={restoreFileFocus}
        title="Discard Changes"
        description={
          <span aria-live="polite">{`Your changes to ${pendingFile?.displayPath ?? "this file"} will be lost.`}</span>
        }
        confirmLabel="Discard Changes"
        onOpenChange={(open) => {
          if (open) return;
          closeOrigin.current = pendingFile?.id;
          fileActions.cancelClose(viewKey);
        }}
        onConfirm={() => {
          closeOrigin.current = undefined;
          fileActions.discardClose(viewKey);
        }}
      />
      <ConfirmDialog
        open={discardPath !== undefined}
        pending={discarding}
        error={discardError}
        finalFocus={menuRef}
        title="Discard Changes"
        description="Your unsaved edits will be replaced by the current file on disk."
        confirmLabel="Discard Changes"
        pendingLabel="Reloading…"
        onOpenChange={(open) => {
          if (!open) setDiscardPath(undefined);
        }}
        onConfirm={() => void discard()}
      />
    </section>
  );
}

function useCramped(body: RefObject<HTMLElement | null>): boolean {
  const [cramped, setCramped] = useState(false);

  // oxlint-disable-next-line nyte-code/no-direct-effect -- measures the editor body before paint and observes its width and the side panel's
  useLayoutEffect(() => {
    const node = body.current;

    if (node === null) return;

    const measure = (): void => {
      if (node.clientWidth > 0) {
        setCramped(node.clientWidth - sidePanelWidth.get() < EDITOR_MIN_WIDTH);
      }
    };

    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    const leave = sidePanelWidth.subscribe(measure);

    return () => {
      observer.disconnect();
      leave();
    };
  }, [body]);

  return cramped;
}

function historyKey(
  event: {
    readonly code: string;
    readonly metaKey: boolean;
    readonly ctrlKey: boolean;
    readonly altKey: boolean;
    readonly shiftKey: boolean;
  },
  mac: boolean,
): "back" | "forward" | undefined {
  if (event.shiftKey) return undefined;

  if (mac) {
    if (!event.metaKey || event.ctrlKey || event.altKey) return undefined;

    if (event.code === "BracketLeft") return "back";

    return event.code === "BracketRight" ? "forward" : undefined;
  }

  if (!event.ctrlKey || !event.altKey || event.metaKey) return undefined;

  if (event.code === "ArrowLeft") return "back";

  return event.code === "ArrowRight" ? "forward" : undefined;
}
