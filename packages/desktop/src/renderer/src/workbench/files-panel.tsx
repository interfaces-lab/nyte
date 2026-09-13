import { Button } from "@nyte-ai/ui";
import { FileTree, useFileTree } from "@pierre/trees/react";
import type { ContextMenuItem, ContextMenuOpenContext } from "@pierre/trees";
import { create, props } from "@stylexjs/stylex";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { errorMessage } from "../../../shared/errors.ts";
import { ConfirmDialog } from "../components/confirm-dialog.tsx";
import { Icon } from "../components/icons.tsx";
import type { IconName } from "../components/icons.tsx";
import { Menu, MenuItem, MenuSeparator, MenuSwitchItem } from "../components/menu.tsx";
import { IconButton } from "../components/ui.tsx";
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
    paddingInline: 5,
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
  contextMenu: {
    display: "flex",
    flexDirection: "column",
    width: 190,
    padding: 4,
    borderRadius: t.radiusLg,
    backgroundColor: t.bgElevated,
    boxShadow: t.shadowPopover,
    color: t.textPrimary,
  },
  contextMenuItem: {
    display: "grid",
    gridTemplateColumns: "14px minmax(0, 1fr)",
    alignItems: "center",
    columnGap: 7,
    minHeight: 28,
    paddingInline: 7,
    borderStyle: "none",
    borderRadius: t.radiusSm,
    outline: "none",
    backgroundColor: {
      default: "transparent",
      ":hover": t.fillGhostHover,
      ":focus-visible": t.fillGhostHover,
    },
    color: "inherit",
    fontSize: t.fontBase,
    lineHeight: t.leadingBase,
    textAlign: "start",
    cursor: "default",
  },
  contextMenuIcon: {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    color: t.iconSecondary,
  },
  contextMenuLabel: {
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
  },
});

function FilesContextMenu({
  item,
  absolutePath,
  context,
  onOpen,
  onSearch,
}: {
  readonly item: ContextMenuItem;
  readonly absolutePath: string | undefined;
  readonly context: ContextMenuOpenContext;
  readonly onOpen: () => void;
  readonly onSearch: () => void;
}): ReactElement {
  const action = (icon: IconName, label: string, run: () => void) => (
    <Button
      unstyled
      type="button"
      role="menuitem"
      tabIndex={-1}
      {...props(styles.contextMenuItem)}
      onClick={() => {
        context.close();
        run();
      }}
    >
      <span aria-hidden="true" {...props(styles.contextMenuIcon)}>
        <Icon name={icon} size={13} />
      </span>
      <span {...props(styles.contextMenuLabel)}>{label}</span>
    </Button>
  );

  return (
    <div
      role="menu"
      aria-label={`${item.name} actions`}
      tabIndex={-1}
      {...props(styles.contextMenu)}
      onKeyDown={(event) => {
        if (event.key === "Escape") {
          event.preventDefault();
          context.close();
          return;
        }
        if (!["ArrowDown", "ArrowUp", "Home", "End"].includes(event.key)) return;
        const items = Array.from(
          event.currentTarget.querySelectorAll<HTMLButtonElement>('[role="menuitem"]'),
        );
        if (items.length === 0) return;
        event.preventDefault();
        const current = items.findIndex((candidate) => candidate === document.activeElement);
        const next =
          event.key === "Home"
            ? 0
            : event.key === "End"
              ? items.length - 1
              : event.key === "ArrowDown"
                ? (current + 1) % items.length
                : (current - 1 + items.length) % items.length;
        items[next]?.focus();
      }}
    >
      {item.kind === "file" && action("file", "Open", onOpen)}
      {action("search", "Search Files", onSearch)}
      {action("copy", "Copy Relative Path", () => void navigator.clipboard.writeText(item.path))}
      {absolutePath !== undefined &&
        action("copy", "Copy Path", () => void navigator.clipboard.writeText(absolutePath))}
      {action("refresh", "Refresh Explorer", refreshVcs)}
    </div>
  );
}

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
  const activeFile = tabs.tabs.find((file) => file.path === tabs.activePath);
  const showSearch = (): void => {
    setSearchOpened(true);
    setSidebar("search");
    requestAnimationFrame(() => searchRef.current?.querySelector("input")?.focus());
  };
  const { model } = useFileTree({
    paths: [],
    density: "compact",
    flattenEmptyDirectories: true,
    initialExpansion: 1,
    search: false,
    composition: { contextMenu: { triggerMode: "both", buttonVisibility: "when-needed" } },
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

  useLayoutEffect(() => {
    model.resetPaths(paths);
  }, [model, paths]);
  const revealed = useRef(0);
  // The file list may arrive after the reveal; retry until the entry exists.
  useEffect(() => {
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
      vcs.data?.status.files.map((file) => ({ path: file.path, status: file.kind })),
    );
  }, [model, vcs.data?.status.files]);

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
          compact
          size={16}
          icon="arrow-left"
          label="Go Back"
          disabled={tabs.historyIndex <= 0}
          onClick={() => fileActions.back(viewKey)}
        />
        <IconButton
          compact
          size={16}
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
          trigger={
            <IconButton
              compact
              size={16}
              ref={menuRef}
              icon="more-horizontal"
              label="File options"
            />
          }
        >
          <MenuItem
            size="compact"
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
            size="compact"
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
            size="compact"
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
            size="compact"
            layout="plain"
            tone="green"
            checked={preferences.lineNumbers}
            onCheckedChange={(checked) => setFilePreference("lineNumbers", checked)}
          >
            Line Numbers
          </MenuSwitchItem>
          <MenuSwitchItem
            size="compact"
            layout="plain"
            tone="green"
            checked={preferences.wordWrap}
            onCheckedChange={(checked) => setFilePreference("wordWrap", checked)}
          >
            Word Wrap
          </MenuSwitchItem>
          <MenuSwitchItem
            size="compact"
            layout="plain"
            tone="green"
            checked={preferences.gitBlame}
            onCheckedChange={(checked) => setFilePreference("gitBlame", checked)}
          >
            Git Blame
          </MenuSwitchItem>
          <MenuSwitchItem
            size="compact"
            layout="plain"
            tone="green"
            checked={preferences.autoSave}
            onCheckedChange={(checked) => setFilePreference("autoSave", checked)}
          >
            Auto Save
          </MenuSwitchItem>
          <MenuSwitchItem
            size="compact"
            layout="plain"
            tone="green"
            checked={preferences.formatOnSave}
            onCheckedChange={(checked) => setFilePreference("formatOnSave", checked)}
          >
            Format on Save
          </MenuSwitchItem>
        </Menu>
        <IconButton
          compact
          size={16}
          icon="search"
          label="Search Files"
          aria-pressed={sidebar === "search"}
          onClick={showSearch}
        />
        <IconButton
          compact
          size={16}
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
            <FileTree
              model={model}
              className={props(styles.tree).className}
              renderContextMenu={(item, context) => (
                <FilesContextMenu
                  item={item}
                  context={context}
                  absolutePath={files.data?.find((file) => file.displayPath === item.path)?.path}
                  onOpen={() => {
                    const file = files.data?.find(
                      (candidate) => candidate.displayPath === item.path,
                    );
                    if (file !== undefined) fileActions.open(viewKey, file);
                  }}
                  onSearch={showSearch}
                />
              )}
            />
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
