import { FileTree, useFileTree } from "@pierre/trees/react";
import type { ContextMenuItem, ContextMenuOpenContext } from "@pierre/trees";
import { create, props } from "@stylexjs/stylex";
import { Fragment, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { ReactElement } from "react";
import { worktreeFiles } from "@nyte-ai/client";
import { errorMessage } from "../errors.ts";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { Menu, MenuItem, MenuSeparator, MenuSwitchItem } from "@nyte-ai/ui/menu";
import type { HostBridge } from "../bridge.ts";
import { revealLabel, showContextMenu } from "../components/context-menu.ts";
import { Icon, PanelToggleIcon } from "@nyte-ai/ui/icon";
import { Button } from "@nyte-ai/ui/button";
import { Toggle } from "@nyte-ai/ui/toggle";
import { nyte } from "../nyte.ts";
import { macPlatform } from "../platform.ts";
import { refreshVcs, useHostState, useMentionFiles, useVcsSnapshot } from "../queries.ts";
import { workbench } from "../theme/schema.stylex.ts";
import { t } from "@nyte-ai/ui/vars.stylex";
import type { WorkbenchViewKey } from "./controller.ts";
import { WorkspaceFileEditor } from "./file-editor.tsx";
import type { FileEditorHandle } from "./file-editor.tsx";
import { setFilePreference, useFilePreferences } from "./file-preferences.ts";
import { fileActions, useFileTabs } from "./file-store.ts";
import { FilesStack } from "./files-stack.tsx";
import { WorkspaceSearch } from "./workspace-search.tsx";
import { PIERRE_TREE_CSS } from "../pierre-worker-provider.tsx";
import { workbenchStyles } from "./workbench.stylex.ts";

const styles = create({
  panel: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
    backgroundColor: t.bgBase,
  },
  explorerHeader: {
    display: "flex",
    alignItems: "center",
    height: workbench.headerHeight,
    flexShrink: 0,
    paddingInline: 10,
    color: t.contentSecondary,
    fontSize: t.fontBase,
  },
  path: {
    display: "flex",
    alignItems: "center",
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    paddingInline: 4,
    color: t.contentSecondary,
    fontSize: t.fontBase,
    whiteSpace: "nowrap",
  },
  // Folders give up their width first, so a deep path still shows the file name.
  crumb: { minWidth: 0, overflow: "hidden", textOverflow: "ellipsis" },
  crumbSeparator: {
    display: "inline-flex",
    flexShrink: 0,
    marginInline: 2,
    color: t.contentTertiary,
  },
  currentCrumb: { flexShrink: 0, maxWidth: "100%", color: t.contentPrimary },
  dirty: { flexShrink: 0, color: t.contentSecondary, fontSize: t.fontXs },
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
    borderInlineStartColor: t.borderSecondaryTranslucent,
  },
  search: { width: "min(320px, 50%)", minWidth: 230 },
  sidebarBody: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 },
  hidden: { display: "none" },
  empty: { padding: 20, color: t.contentSecondary, fontSize: t.fontSm },
  menu: {
    minWidth: "min(220px, var(--available-width))",
    maxWidth: "min(420px, var(--available-width))",
    borderRadius: t.radius8,
  },
  tree: {
    display: "block",
    flex: 1,
    width: "100%",
    minHeight: 0,
    "--trees-border-radius-override": t.radius2,
    "--trees-item-margin-x-override": "0px",
    "--trees-item-padding-x-override": "5px",
    "--trees-item-row-gap-override": "4px",
    "--trees-level-gap-override": "5px",
    "--trees-padding-inline-override": "6px",
  },
});

export function FilesPanel({
  viewKey,
  visible,
  workspaceActive,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly visible: boolean;
  readonly workspaceActive: boolean;
}): ReactElement {
  const shown = workspaceActive && visible;
  const files = useMentionFiles(shown);
  const fileEntries = useRef(files.data);
  useLayoutEffect(() => {
    fileEntries.current = files.data;
  }, [files.data]);
  const vcs = useVcsSnapshot(shown);
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
  const activeFile = tabs.active;
  const browsing = activeFile === undefined;

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

  const contextMenu = nyte.host.contextMenu;
  const revealPath = nyte.host.revealPath;

  /**
   * Serves the row's menu button and its right-click. The tree keeps its own
   * open state, so close it before the native menu takes over the pointer.
   */
  const openRowMenu = (
    menu: NonNullable<HostBridge["contextMenu"]>,
    item: ContextMenuItem,
    context: ContextMenuOpenContext,
  ): void => {
    context.close({ restoreFocus: false });
    const file = fileEntries.current?.find((entry) => entry.displayPath === item.path);
    const root = hostState.current?.workspace?.path;
    // Directories are not in the file list, so their location comes from the root.
    const separator = hostState.current?.platform === "win32" ? "\\" : "/";
    const relative = item.path.replace(/\/$/, "");

    const absolutePath =
      file?.path ?? (root === undefined ? undefined : `${root}${separator}${relative}`);

    void showContextMenu(
      menu,
      { clientX: context.anchorRect.left, clientY: context.anchorRect.bottom },
      [
        file !== undefined && {
          kind: "item",
          label: "Open",
          run: () => fileActions.open(viewKey, file),
        },
        absolutePath !== undefined &&
          revealPath !== undefined && {
            kind: "item",
            label: revealLabel(hostState.current?.platform),
            run: () => void revealPath({ path: absolutePath }),
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
      ],
    );
  };

  const { model } = useFileTree({
    paths: [],
    density: "compact",
    unsafeCSS: PIERRE_TREE_CSS,
    flattenEmptyDirectories: true,
    initialExpansion: 1,
    search: false,
    composition: {
      // Without a native menu the tree keeps neither a menu button nor the right-click.
      contextMenu:
        contextMenu === undefined
          ? undefined
          : {
              triggerMode: "both",
              buttonVisibility: "when-needed",
              // The native menu replaces the tree's own surface for both triggers.
              render: () => null,
              onOpen: (item, context) => openRowMenu(contextMenu, item, context),
            },
    },
  });

  /**
   * Files open from row clicks, not selection changes: the stack keeps the
   * selection on the file in view, and clicking a selected row changes nothing.
   */
  const openFromTree = (event: Event, preview: boolean): void => {
    const row = event
      .composedPath()
      .find((target) => target instanceof HTMLElement && target.dataset.type === "item");

    if (!(row instanceof HTMLElement) || row.dataset.itemType !== "file") return;
    const file = files.data?.find((candidate) => candidate.displayPath === row.dataset.itemPath);

    if (file !== undefined) fileActions.open(viewKey, { ...file, preview });
  };

  const selectInTree = (path: string): void => {
    for (const selected of model.getSelectedPaths()) {
      if (selected !== path) model.getItem(selected)?.deselect();
    }

    model.getItem(path)?.select();
    model.scrollToPath(path, { focus: false, offset: "nearest" });
  };

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
      <div {...props(workbenchStyles.toolbar)}>
        <Button
          iconOnly
          icon="arrow-left"
          aria-label="Go Back"
          disabled={!tabs.canGoBack}
          onClick={() => fileActions.back(viewKey)}
        />
        <Button
          iconOnly
          icon="arrow-right"
          aria-label="Go Forward"
          disabled={!tabs.canGoForward}
          onClick={() => fileActions.forward(viewKey)}
        />
        <span title={activeFile?.displayPath} {...props(styles.path)}>
          {activeFile === undefined ? (
            <span {...props(styles.currentCrumb)}>Files</span>
          ) : (
            activeFile.displayPath.split("/").map((segment, index, segments) => (
              <Fragment key={segments.slice(0, index + 1).join("/")}>
                {index > 0 && (
                  <span aria-hidden="true" {...props(styles.crumbSeparator)}>
                    <Icon name="chevron-right" size={10} />
                  </span>
                )}
                <span
                  {...props(styles.crumb, index === segments.length - 1 && styles.currentCrumb)}
                >
                  {segment}
                </span>
              </Fragment>
            ))
          )}
        </span>
        {activeFile?.dirty && (
          <span aria-label="Unsaved changes" {...props(styles.dirty)}>
            ●
          </span>
        )}
        <Menu
          label="File options"
          align="end"
          xstyle={styles.menu}
          trigger={
            <Button iconOnly ref={menuRef} icon="more-horizontal" aria-label="File options" />
          }
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
              if (activeFile !== undefined) copyPath(activeFile.displayPath);
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
        <Toggle
          iconOnly
          icon="search"
          aria-label="Search Files"
          pressed={sidebar === "search"}
          onPressedChange={showSearch}
        />
        <Toggle
          iconOnly
          indicator="glyph"
          aria-label="Browse Files"
          pressed={sidebar === "explorer"}
          onPressedChange={() => setSidebar(sidebar === "explorer" ? "hidden" : "explorer")}
        >
          <PanelToggleIcon side="right" visible={sidebar === "explorer"} />
        </Toggle>
      </div>
      {copyError !== undefined && (
        <div role="alert" {...props(styles.empty)}>
          Could not copy path. {copyError}
        </div>
      )}
      <div {...props(styles.body)}>
        <div {...props(styles.editors, browsing && styles.hidden)}>
          {tabs.tabs.map((file) => (
            <WorkspaceFileEditor
              key={file.path}
              ref={(editor) => {
                if (editor === null) editors.current.delete(file.path);
                else editors.current.set(file.path, editor);
              }}
              viewKey={viewKey}
              file={file}
              active={shown && file.id === activeFile?.id}
              preferences={{
                ...preferences,
                autoSave:
                  preferences.autoSave &&
                  workspaceActive &&
                  tabs.pendingClose?.id !== file.id &&
                  discardPath !== file.path,
              }}
            />
          ))}
        </div>
        <FilesStack
          files={files.data}
          active={shown && browsing}
          lineNumbers={preferences.lineNumbers}
          wordWrap={preferences.wordWrap}
          onActivePath={selectInTree}
          onOpen={(file) => fileActions.open(viewKey, file)}
        />
        <aside
          aria-label={sidebar === "search" ? "Workspace search" : "Explorer"}
          {...props(
            styles.explorer,
            sidebar === "search" && styles.search,
            sidebar === "hidden" && styles.hidden,
          )}
        >
          <div
            {...props(styles.sidebarBody, sidebar !== "explorer" && styles.hidden)}
            onClick={(event) => {
              if (!(event.metaKey || event.ctrlKey || event.shiftKey)) {
                openFromTree(event.nativeEvent, true);
              }
            }}
            onDoubleClick={(event) => openFromTree(event.nativeEvent, false)}
            onKeyDown={(event) => {
              if (event.key === "Enter") openFromTree(event.nativeEvent, true);
            }}
          >
            <div {...props(styles.explorerHeader)}>{host.data?.workspace?.name ?? "Workspace"}</div>
            {files.isError && (
              <div role="alert" {...props(styles.empty)}>
                Could not load files. {files.error.message}
              </div>
            )}
            <FileTree
              model={model}
              className={props(workbenchStyles.treeTheme, styles.tree).className}
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
