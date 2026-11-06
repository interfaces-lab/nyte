import { hairline } from "@nyte-ai/ui/styles/hairline.stylex";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { create, props } from "@stylexjs/stylex";
import { useRef, useState } from "react";
import type { ReactElement } from "react";
import { worktreeFiles } from "./worktree-files.ts";
import { errorMessage } from "../../contract/errors.ts";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import {
  Menu,
  MenuContent,
  MenuItem,
  MenuSeparator,
  MenuSwitchItem,
  MenuTrigger,
} from "@nyte-ai/ui/menu";
import { revealLabel } from "../../components/context-menu.ts";
import { PanelToggleIcon } from "@nyte-ai/ui/icon";
import { Button } from "@nyte-ai/ui/button";
import { Toggle } from "@nyte-ai/ui/toggle";
import { nyte } from "../../contract/nyte.ts";
import { preferences, useSetting, type Preference } from "../../preferences/index.ts";
import { useVcsSnapshot } from "../../data/vcs.ts";
import { useHostState } from "../../data/host.ts";
import { useMentionFiles, useWorkspaceFile } from "../../data/files.ts";
import { workbench } from "../../theme/schema.stylex.ts";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import type { WorkbenchViewKey } from "../model.ts";
import { FileBreadcrumbs } from "./file-breadcrumbs.tsx";
import { opensReadOnly, WorkspaceFileEditor } from "./file-editor.tsx";
import { FilesEmptyState } from "./files-empty-state.tsx";
import type { FileEditorHandle } from "./file-editor.tsx";
import { fileActions, useFileTabs } from "./file-store.ts";
import { opensAsMarkdown } from "./markdown-parse.ts";
import { WorkspaceSearch } from "../workspace-search.tsx";
import { useTreeStatusTheme } from "./tree-theme.ts";
import { workbenchStyles } from "../workbench.stylex.ts";
import { FilePalette } from "./file-palette.tsx";
import { FilesExplorer } from "./files-explorer.tsx";
import { findSymbols } from "./outline.ts";
import { EditorGroupView } from "./editor-groups.tsx";
import { SidePanel } from "../side-panel.tsx";

const styles = create({
  panel: {
    display: "flex",
    flexDirection: "column",
    flex: 1,
    minWidth: 0,
    minHeight: 0,
  },
  toolbar: { gap: space.s2, height: "auto", minHeight: workbench.headerHeight },
  dirty: {
    flexShrink: 0,
    color: role.contentSecondary,
    fontSize: type.fontXs,
    lineHeight: type.leadingXs,
  },
  body: { display: "flex", flex: 1, minWidth: 0, minHeight: 0 },
  editors: { display: "flex", flex: 1, minWidth: 0, minHeight: 0 },
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
}: {
  readonly label: string;
  readonly setting: Preference<boolean>;
}): ReactElement {
  const checked = useSetting(setting);

  return (
    <MenuSwitchItem layout="plain" checked={checked} onCheckedChange={setting.set}>
      {label}
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

export function FilesPanel({
  viewKey,
  visible,
  workspaceActive,
  sidebarVisible,
  onToggleSidebar,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly visible: boolean;
  readonly workspaceActive: boolean;
  readonly sidebarVisible: boolean;
  readonly onToggleSidebar: () => void;
}): ReactElement {
  const treeStatusTheme = useTreeStatusTheme();
  const shown = workspaceActive && visible;
  const host = useHostState();
  const files = useMentionFiles(host.data.workspace, shown);
  const vcs = useVcsSnapshot(shown);
  const changes = vcs.data?.kind === "repository" ? worktreeFiles(vcs.data) : [];

  const tabs = useFileTabs(viewKey);
  const autoSave = useSetting(preferences.fileAutoSave);
  const sidePanel = useSetting(preferences.fileSidePanel);
  const [sidebar, setSidebar] = useState<"explorer" | "search">("explorer");
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
  const activeDocument = useWorkspaceFile(activeFile?.path).data;
  const readOnly = activeDocument !== undefined && opensReadOnly(activeDocument);

  const unsaved = activeFile?.dirty === true;

  const showSidebar = (): void => {
    if (!sidebarVisible) onToggleSidebar();
  };

  const showSearch = (): void => {
    showSidebar();
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

  const openFiles = tabs.tabs.flatMap((tab) => {
    const file = files.data?.find((entry) => entry.path === tab.path);

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

  return (
    <section
      aria-label="Files"
      {...props(styles.panel, treeStatusTheme)}
      onKeyDownCapture={(event) => {
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

        const primary = nyte.platform === "darwin" ? event.metaKey : event.ctrlKey;

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
              : event.ctrlKey && !event.metaKey && !event.shiftKey && key === "g"
                ? ":"
                : undefined;

        if (query === undefined) return;
        event.preventDefault();
        setPalette(query);
      }}
    >
      <div {...props(workbenchStyles.toolbar, hairline.blockEnd, styles.toolbar)}>
        <Button
          iconOnly
          icon="arrow-left"
          aria-label="Go back"
          disabled={!tabs.canGoBack}
          onClick={() => fileActions.back(viewKey)}
        />
        <Button
          iconOnly
          icon="arrow-right"
          aria-label="Go forward"
          disabled={!tabs.canGoForward}
          onClick={() => fileActions.forward(viewKey)}
        />
        <FileBreadcrumbs
          path={activeFile?.displayPath}
          external={activeFile?.external === true}
          files={files.data}
          onOpen={(file) => fileActions.open(viewKey, { ...file, preview: true })}
        />
        {activeFile?.dirty && (
          <span aria-label="Unsaved changes" {...props(styles.dirty)}>
            ●
          </span>
        )}
        <Button
          iconOnly
          icon="split-right"
          aria-label="Split Editor Right"
          title={`Split Editor Right (${nyte.platform === "darwin" ? "⌘\\" : "Ctrl+\\"})`}
          disabled={activeFile === undefined}
          onClick={() => fileActions.split(viewKey, "after")}
        />
        <Menu>
          <MenuTrigger
            render={
              <Button iconOnly ref={menuRef} icon="more-horizontal" aria-label="File options" />
            }
          />
          <MenuContent align="end" xstyle={styles.menu}>
            {activeFile !== undefined &&
              activeDocument?.kind === "text" &&
              opensAsMarkdown(activeFile.path) && (
                <>
                  <MenuItem
                    layout="plain"
                    onClick={() =>
                      fileActions.setShowSource(viewKey, activeFile.path, !activeFile.showSource)
                    }
                  >
                    {activeFile.showSource ? "View Document" : "View Source"}
                  </MenuItem>
                  <MenuSeparator inset />
                </>
              )}
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
            <MenuItem
              layout="plain"
              disabled={activeDocument?.kind !== "text" || readOnly}
              onClick={() => {
                if (activeFile !== undefined) void editors.current.get(activeFile.id)?.format();
              }}
            >
              Format Document
            </MenuItem>
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
              disabled={activeFile === undefined || readOnly}
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
              <FilePreferenceItem key={label} label={label} setting={setting} />
            ))}
            <MenuItem
              layout="plain"
              onClick={() => preferences.fileSidePanel.set(sidePanel === "start" ? "end" : "start")}
            >
              {sidePanel === "start" ? "Move Side Panel Right" : "Move Side Panel Left"}
            </MenuItem>
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
          iconOnly
          icon="search"
          aria-label="Search Files"
          pressed={sidebarVisible && sidebar === "search"}
          onPressedChange={(pressed) => (pressed ? showSearch() : setSidebar("explorer"))}
        />
        <Toggle
          iconOnly
          indicator="glyph"
          aria-label="Files Sidebar"
          pressed={sidebarVisible}
          onPressedChange={onToggleSidebar}
        >
          <PanelToggleIcon
            side={sidePanel === "start" ? "left" : "right"}
            visible={sidebarVisible}
          />
        </Toggle>
      </div>
      {copyError !== undefined && (
        <div role="alert" {...props(styles.empty)}>
          Could not copy path. {copyError}
        </div>
      )}
      <div {...props(styles.body)}>
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
                <FilesEmptyState
                  files={files.data}
                  changes={changes}
                  explorerVisible={sidebarVisible && sidebar === "explorer"}
                  onOpen={(file) => fileActions.open(viewKey, { ...file, preview: true })}
                  onShowExplorer={() => {
                    setSidebar("explorer");
                    showSidebar();
                  }}
                  onSearch={showSearch}
                />
              )}
              {group.tabs.map((file) => (
                <WorkspaceFileEditor
                  key={file.id}
                  ref={(editor) => {
                    if (editor === null) editors.current.delete(file.id);
                    else editors.current.set(file.id, editor);
                  }}
                  viewKey={viewKey}
                  file={file}
                  active={shown && file.id === group.active?.id}
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
        {sidebarVisible && (
          <SidePanel side={sidePanel}>
            <aside
              aria-label={sidebar === "search" ? "Workspace search" : "Explorer"}
              {...props(styles.explorer)}
            >
              <div {...props(styles.sidebarBody, sidebar !== "explorer" && styles.hidden)}>
                <FilesExplorer
                  viewKey={viewKey}
                  workspace={host.data.workspace}
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
                    onOpen={(location) => fileActions.open(viewKey, location)}
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
        recent={openFiles}
        active={
          activeFile === undefined || activeContents === undefined
            ? undefined
            : { path: activeFile.path, lines: activeContents.split("\n").length, symbols }
        }
        onQueryChange={setPalette}
        onClose={() => setPalette(undefined)}
        onOpenFile={(file) => fileActions.open(viewKey, file)}
        onGoTo={(line, column) => {
          if (activeFile !== undefined)
            fileActions.open(viewKey, { path: activeFile.path, line, column });
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
