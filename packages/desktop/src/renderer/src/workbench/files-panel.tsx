import { FileTree, useFileTree } from "@pierre/trees/react";
import type { ContextMenuItem, ContextMenuOpenContext } from "@pierre/trees";
import { create, props } from "@stylexjs/stylex";
import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { worktreeFiles } from "@nyte-ai/client";
import { errorMessage } from "../../../shared/errors.ts";
import { ConfirmDialog } from "../components/confirm-dialog.tsx";
import { Menu, MenuItem, MenuSeparator, MenuSwitchItem } from "../components/menu.tsx";
import { revealLabel, showContextMenu } from "../components/context-menu.ts";
import { IconButton } from "../components/ui.tsx";
import { nyte } from "../nyte.ts";
import { macPlatform } from "../platform.ts";
import { refreshVcs, useHostState, useMentionFiles, useVcsSnapshot } from "../queries.ts";
import { workbench } from "../theme/schema.stylex.ts";
import { t } from "../theme/vars.stylex.ts";
import type { WorkbenchViewKey } from "./controller.ts";
import { WorkspaceFileEditor } from "./file-editor.tsx";
import type { FileEditorHandle } from "./file-editor.tsx";
import { setFilePreference, useFilePreferences } from "./file-preferences.ts";
import { fileActions, useFileTabs } from "./file-store.ts";
import { WorkspaceSearch } from "./workspace-search.tsx";

const styles = create({
  panel: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: t.bgBase,
  },
  toolbar: {
    display: "flex",
    alignItems: "center",
    gap: 1,
    height: workbench.headerHeight,
    paddingInlineStart: 6,
    paddingInlineEnd: 8,
    flexShrink: 0,
    borderBottomWidth: 1,
    borderBottomStyle: "solid",
    borderBottomColor: t.strokeTertiary,
  },
  explorerHeader: {
    display: "flex",
    alignItems: "center",
    height: workbench.headerHeight,
    flexShrink: 0,
    paddingInline: 10,
    color: t.textTertiary,
    fontSize: t.fontBase,
  },
  path: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    paddingInline: 4,
    color: t.textPrimary,
    fontSize: t.fontBase,
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
  dirty: { flexShrink: 0, color: t.textTertiary, fontSize: t.fontXs },
  body: { display: "flex", flex: 1, minWidth: 0, minHeight: 0 },
  editors: { position: "relative", display: "flex", flex: 1, minWidth: 0, minHeight: 0 },
  explorer: {
    display: "flex",
    flexDirection: "column",
    width: "min(220px, 40%)",
    minWidth: 160,
    minHeight: 0,
    flexShrink: 0,
    backgroundColor: t.bgBase,
    borderInlineStartWidth: 1,
    borderInlineStartStyle: "solid",
    borderInlineStartColor: t.strokeTertiary,
  },
  explorerOnly: { width: "100%", minWidth: 0, borderInlineStartWidth: 0 },
  search: { width: "min(320px, 50%)", minWidth: 230 },
  sidebarBody: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 },
  hidden: { display: "none" },
  empty: { padding: 20, color: t.textTertiary, fontSize: t.fontSm },
  menu: {
    minWidth: "min(220px, var(--available-width))",
    maxWidth: "min(420px, var(--available-width))",
    borderRadius: t.radiusLg,
  },
  tree: {
    display: "block",
    flex: 1,
    width: "100%",
    minHeight: 0,
    "--trees-bg-override": t.bgBase,
    "--trees-bg-muted-override": t.fillGhostHover,
    "--trees-fg-override": t.textSecondary,
    "--trees-fg-muted-override": t.textTertiary,
    "--trees-selected-bg-override": t.fillGhostSelected,
    "--trees-selected-fg-override": t.textPrimary,
    "--trees-focus-ring-color-override": t.focusRing,
    "--trees-input-bg-override": t.bgEditor,
    "--trees-search-bg-override": t.bgEditor,
    "--trees-search-fg-override": t.textPrimary,
    "--trees-scrollbar-thumb-override": t.scrollbarThumb,
    "--trees-font-family-override": t.fontSans,
    "--trees-font-size-override": t.fontSm,
    "--trees-border-radius-override": t.radiusXs,
    "--trees-item-margin-x-override": "0px",
    "--trees-item-padding-x-override": "5px",
    "--trees-item-row-gap-override": "4px",
    "--trees-level-gap-override": "5px",
    "--trees-padding-inline-override": "6px",
  },
});

export function FilesPanel({
  viewKey,
  workspaceActive,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly workspaceActive: boolean;
}): ReactElement {
  const files = useMentionFiles(workspaceActive);
  const fileEntries = useRef(files.data);
  useLayoutEffect(() => {
    fileEntries.current = files.data;
  }, [files.data]);
  const vcs = useVcsSnapshot(workspaceActive);
  const host = useHostState();
  const tabs = useFileTabs(viewKey);
  const preferences = useFilePreferences();
  const [sidebar, setSidebar] = useState<"explorer" | "search" | "hidden">("explorer");
  const [searchOpened, setSearchOpened] = useState(false);
  const [discardPath, setDiscardPath] = useState<string>();
  const [discarding, setDiscarding] = useState(false);
  const [discardError, setDiscardError] = useState<string>();
  const [copyError, setCopyError] = useState<string>();
  const menuRef = useRef<HTMLButtonElement>(null);
  const searchRef = useRef<HTMLDivElement>(null);
  const editors = useRef(new Map<string, FileEditorHandle>());
  // The tree keeps its creation-time composition callbacks; read late values through refs.
  const hostState = useRef(host.data);
  useLayoutEffect(() => {
    hostState.current = host.data;
  }, [host.data]);
  const activeFile = tabs.tabs.find((file) => file.path === tabs.activePath);
  const showSearch = (): void => {
    setSearchOpened(true);
    setSidebar("search");
    requestAnimationFrame(() => searchRef.current?.querySelector("input")?.focus());
  };
  const copyPath = (value: string): void => {
    void navigator.clipboard
      .writeText(value)
      .then(() => setCopyError(undefined))
      .catch((cause: unknown) => setCopyError(errorMessage(cause)));
  };
  /**
   * Serves the row's menu button and its right-click. The tree keeps its own
   * open state, so close it before the native menu takes over the pointer.
   */
  const openRowMenu = (item: ContextMenuItem, context: ContextMenuOpenContext): void => {
    context.close({ restoreFocus: false });
    const file = fileEntries.current?.find((entry) => entry.displayPath === item.path);
    const root = hostState.current?.workspace?.path;
    // Directories are not in the file list, so their location comes from the root.
    const separator = hostState.current?.platform === "win32" ? "\\" : "/";
    const relative = item.path.replace(/\/$/, "");
    const absolutePath =
      file?.path ?? (root === undefined ? undefined : `${root}${separator}${relative}`);
    void showContextMenu({ clientX: context.anchorRect.left, clientY: context.anchorRect.bottom }, [
      file !== undefined && {
        kind: "item",
        label: "Open",
        run: () => fileActions.open(viewKey, file),
      },
      absolutePath !== undefined && {
        kind: "item",
        label: revealLabel(hostState.current?.platform),
        run: () => void nyte.host.revealPath({ path: absolutePath }),
      },
      { kind: "separator" },
      { kind: "item", label: "Search Files", run: showSearch },
      { kind: "separator" },
      absolutePath !== undefined && {
        kind: "item",
        label: "Copy Path",
        run: () => copyPath(absolutePath),
      },
      { kind: "item", label: "Copy Relative Path", run: () => copyPath(relative) },
      { kind: "separator" },
      { kind: "item", label: "Refresh Explorer", run: refreshVcs },
    ]);
  };
  const { model } = useFileTree({
    paths: [],
    density: "compact",
    flattenEmptyDirectories: true,
    initialExpansion: 1,
    search: false,
    composition: {
      contextMenu: {
        triggerMode: "both",
        buttonVisibility: "when-needed",
        // The native menu replaces the tree's own surface for both triggers.
        render: () => null,
        onOpen: (item, context) => openRowMenu(item, context),
      },
    },
    onSelectionChange: (paths) => {
      const path = paths.findLast((candidate) => !candidate.endsWith("/"));
      // useFileTree keeps its creation-time listeners; file discovery finishes later.
      const file = fileEntries.current?.find((candidate) => candidate.displayPath === path);
      if (file !== undefined) fileActions.open(viewKey, file);
    },
  });
  const paths = useMemo(() => (files.data ?? []).map((file) => file.displayPath), [files.data]);
  const drafts = useMemo(
    () =>
      tabs.tabs.flatMap((file) =>
        file.draft === undefined ? [] : [{ path: file.path, contents: file.draft.contents }],
      ),
    [tabs.tabs],
  );

  const revealed = useRef(0);
  // The file list may arrive after the reveal; retry until the entry exists.
  useLayoutEffect(() => {
    model.resetPaths(paths);
    if (tabs.revealPath === undefined || revealed.current === tabs.revealRevision) return;
    const item = model.getItem(tabs.revealPath);
    if (item === null) return;
    revealed.current = tabs.revealRevision;
    if ("expand" in item) item.expand();
    item.select();
    model.scrollToPath(tabs.revealPath, { offset: "nearest" });
  }, [model, paths, tabs.revealPath, tabs.revealRevision]);
  useLayoutEffect(() => {
    model.setGitStatus(
      vcs.data?.kind === "repository"
        ? worktreeFiles(vcs.data).map((file) => ({
            path: file.path,
            // The tree has no conflict mark; a conflict is a modification to resolve.
            status: file.kind === "conflicted" ? "modified" : file.kind,
          }))
        : undefined,
    );
  }, [model, vcs.data]);

  const discard = async (): Promise<void> => {
    if (discardPath === undefined) return;
    setDiscarding(true);
    try {
      const editor = editors.current.get(discardPath);
      if (editor === undefined) throw new Error("The file is not ready to reload.");
      await editor.discard();
      setDiscardPath(undefined);
      setDiscardError(undefined);
    } catch (cause: unknown) {
      setDiscardError(errorMessage(cause));
    } finally {
      setDiscarding(false);
    }
  };

  return (
    <section
      aria-label="Files"
      {...props(styles.panel)}
      onKeyDownCapture={(event) => {
        if (!(event.metaKey || event.ctrlKey)) return;
        const key = event.key.toLowerCase();
        if (key === "s") {
          event.preventDefault();
          if (activeFile !== undefined) void editors.current.get(activeFile.path)?.save();
        }
        if (key === "f") {
          event.preventDefault();
          showSearch();
        }
      }}
    >
      <div {...props(styles.toolbar)}>
        <IconButton
          icon="arrow-left"
          label="Go Back"
          disabled={tabs.historyIndex <= 0}
          onClick={() => fileActions.back(viewKey)}
        />
        <IconButton
          icon="arrow-right"
          label="Go Forward"
          disabled={tabs.historyIndex >= tabs.history.length - 1}
          onClick={() => fileActions.forward(viewKey)}
        />
        <span title={activeFile?.displayPath} {...props(styles.path)}>
          {activeFile?.displayPath.split("/").at(-1) ?? "Files"}
        </span>
        {activeFile?.dirty && (
          <span aria-label="Unsaved changes" {...props(styles.dirty)}>
            ●
          </span>
        )}
        <Menu
          label="File options"
          align="end"
          popupStyle={styles.menu}
          trigger={<IconButton ref={menuRef} icon="more-horizontal" label="File options" />}
        >
          <MenuItem
            background="highlightOnly"
            layout="plain"
            meta={macPlatform(undefined) ? "⌘S" : "Ctrl+S"}
            disabled={activeFile === undefined || !activeFile.dirty}
            onSelect={() => {
              if (activeFile !== undefined) void editors.current.get(activeFile.path)?.save();
            }}
          >
            Save File
          </MenuItem>
          <MenuItem
            background="highlightOnly"
            layout="plain"
            disabled={activeFile === undefined || !activeFile.dirty}
            onSelect={() => {
              setDiscardError(undefined);
              setDiscardPath(activeFile?.path);
            }}
          >
            Discard Changes
          </MenuItem>
          <MenuSeparator inset />
          <MenuItem
            background="highlightOnly"
            layout="plain"
            disabled={activeFile === undefined}
            onSelect={() => {
              if (activeFile === undefined) return;
              void navigator.clipboard
                .writeText(activeFile.displayPath)
                .then(() => setCopyError(undefined))
                .catch((cause: unknown) => setCopyError(errorMessage(cause)));
            }}
          >
            Copy Relative Path
          </MenuItem>
          <MenuSeparator inset />
          <MenuSwitchItem
            background="highlightOnly"
            layout="plain"
            checked={preferences.lineNumbers}
            onCheckedChange={(checked) => setFilePreference("lineNumbers", checked)}
          >
            Line Numbers
          </MenuSwitchItem>
          <MenuSwitchItem
            background="highlightOnly"
            layout="plain"
            checked={preferences.wordWrap}
            onCheckedChange={(checked) => setFilePreference("wordWrap", checked)}
          >
            Word Wrap
          </MenuSwitchItem>
          <MenuSwitchItem
            background="highlightOnly"
            layout="plain"
            checked={preferences.gitBlame}
            onCheckedChange={(checked) => setFilePreference("gitBlame", checked)}
          >
            Git Blame
          </MenuSwitchItem>
          <MenuSwitchItem
            background="highlightOnly"
            layout="plain"
            checked={preferences.autoSave}
            onCheckedChange={(checked) => setFilePreference("autoSave", checked)}
          >
            Auto Save
          </MenuSwitchItem>
          <MenuSwitchItem
            background="highlightOnly"
            layout="plain"
            checked={preferences.formatOnSave}
            onCheckedChange={(checked) => setFilePreference("formatOnSave", checked)}
          >
            Format on Save
          </MenuSwitchItem>
        </Menu>
        <IconButton
          icon="search"
          label="Search Files"
          aria-pressed={sidebar === "search"}
          onClick={showSearch}
        />
        <IconButton
          icon="list"
          label="Browse Files"
          aria-pressed={sidebar === "explorer"}
          onClick={() => setSidebar(sidebar === "explorer" ? "hidden" : "explorer")}
        />
      </div>
      {copyError !== undefined && (
        <div role="alert" {...props(styles.empty)}>
          Could not copy path. {copyError}
        </div>
      )}
      <div {...props(styles.body)}>
        <div
          {...props(
            styles.editors,
            activeFile === undefined && sidebar !== "hidden" && styles.hidden,
          )}
        >
          {tabs.tabs.map((file) => (
            <WorkspaceFileEditor
              key={file.path}
              ref={(editor) => {
                if (editor === null) editors.current.delete(file.path);
                else editors.current.set(file.path, editor);
              }}
              viewKey={viewKey}
              file={file}
              active={workspaceActive && file.path === tabs.activePath}
              navigationRevision={file.navigationRevision}
              preferences={{
                ...preferences,
                autoSave:
                  preferences.autoSave &&
                  workspaceActive &&
                  tabs.pendingClosePath !== file.path &&
                  discardPath !== file.path,
              }}
            />
          ))}
          {activeFile === undefined && (
            <div {...props(styles.empty)}>Select a file from Explorer or search the workspace.</div>
          )}
        </div>
        <aside
          aria-label={sidebar === "search" ? "Workspace search" : "Explorer"}
          {...props(
            styles.explorer,
            sidebar === "search" && styles.search,
            activeFile === undefined && styles.explorerOnly,
            sidebar === "hidden" && styles.hidden,
          )}
        >
          <div {...props(styles.sidebarBody, sidebar !== "explorer" && styles.hidden)}>
            <div {...props(styles.explorerHeader)}>{host.data?.workspace?.name ?? "Workspace"}</div>
            {files.isError && (
              <div role="alert" {...props(styles.empty)}>
                Could not load files. {files.error.message}
              </div>
            )}
            <FileTree model={model} className={props(styles.tree).className} />
          </div>
          <div
            ref={searchRef}
            {...props(styles.sidebarBody, sidebar !== "search" && styles.hidden)}
          >
            {searchOpened && (
              <WorkspaceSearch
                active={workspaceActive && sidebar === "search"}
                drafts={drafts}
                onOpen={(location) => fileActions.open(viewKey, location)}
              />
            )}
          </div>
        </aside>
      </div>
      <ConfirmDialog
        open={discardPath !== undefined}
        pending={discarding}
        error={discardError}
        returnFocusRef={menuRef}
        title="Discard changes?"
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
