import { PanelToggleIcon } from "@nyte-ai/ui/icon";
import type { IconName } from "@nyte-ai/ui/icon";
import { space } from "@nyte-ai/ui/styles/schema.stylex";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { create, props } from "@stylexjs/stylex";
import { useState } from "react";
import type { ReactElement, ReactNode, RefObject } from "react";
import type { SelectedWorkspace } from "../contract/bridge.ts";
import { WORKBENCH_KINDS } from "../workbench/model.ts";
import type { WorkbenchViewKey } from "../workbench/model.ts";
import { SidePanel } from "../workbench/side-panel.tsx";
import { WorkspaceSearch } from "../workbench/workspace-search.tsx";
import { useWorkbenchWorkspace } from "../workbench/workbench-workspace.tsx";
import type { EditorData } from "./editor-data.ts";
import { ExplorerFolderMenu } from "./explorer-folder.tsx";
import { FileOutline } from "./file-outline.tsx";
import { fileActions } from "./file-store.ts";
import type { FileTab } from "./file-store.ts";
import { FilesExplorer } from "./files-explorer.tsx";
import type { ExplorerHandle } from "./files-explorer.tsx";
import type { WorktreeFile } from "./worktree-files.ts";
import type { OutlineSymbol } from "./outline.ts";

const styles = create({
  explorer: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 },
  sidebarBody: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 },
  hidden: { display: "none" },
  header: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    flexShrink: 0,
    paddingBlock: space.s1_5,
    paddingInline: space.s2_5,
  },
  views: { marginInlineStart: "auto" },
});

/** The views the editor's sidebar switches between. Changes is offered where the Editor is the window's main area. */
export type SidebarTabName = "explorer" | "search" | "changes";

const VIEWS = [
  { value: "explorer", icon: "folder", label: "Files" },
  { value: "search", icon: "search", label: "Search" },
  { value: "changes", icon: "git-branch", label: "Changes" },
] as const satisfies readonly {
  readonly value: SidebarTabName;
  readonly icon: IconName;
  readonly label: string;
}[];

/** The sidebar's selected view, and whether its search has opened once. */
export interface SidebarTab {
  readonly tab: SidebarTabName;
  readonly searchOpened: boolean;
  readonly select: (tab: SidebarTabName) => void;
  /** Opens the sidebar on `tab`, taking the keyboard there. */
  readonly show: (tab: SidebarTabName) => void;
}

/** Tracks the sidebar's view, which falls back to the explorer whenever the file store reveals a file. */
export function useSidebarTab({
  revealRevision,
  searchRef,
  showSidebar,
}: {
  readonly revealRevision: number;
  readonly searchRef: RefObject<HTMLDivElement | null>;
  readonly showSidebar: () => void;
}): SidebarTab {
  const [sidebarSelection, setSidebarSelection] = useState<{
    readonly revision: number;
    readonly tab: SidebarTabName;
  }>({ revision: revealRevision, tab: "explorer" });

  const sidebar = sidebarSelection.revision === revealRevision ? sidebarSelection.tab : "explorer";

  const [searchOpened, setSearchOpened] = useState(false);

  const select = (tab: SidebarTabName): void => {
    if (tab === "search") setSearchOpened(true);
    setSidebarSelection({ revision: revealRevision, tab });
  };

  return {
    tab: sidebar,
    searchOpened,
    select,
    show: (tab) => {
      showSidebar();
      select(tab);

      if (tab === "search") {
        requestAnimationFrame(() => searchRef.current?.querySelector("input")?.focus());
      }
    },
  };
}

/** The toolbar's search and sidebar toggles, where the editor is a side panel. */
export function SidebarToggles({
  sidePanel,
  explorerShown,
  sidebar,
  onToggle,
}: {
  readonly sidePanel: "start" | "end";
  readonly explorerShown: boolean;
  readonly sidebar: SidebarTab;
  readonly onToggle: () => void;
}): ReactElement {
  return (
    <>
      <Toggle
        size="sm"
        iconOnly
        icon="search"
        aria-label="Search Files"
        pressed={explorerShown && sidebar.tab === "search"}
        onPressedChange={(pressed) =>
          pressed ? sidebar.show("search") : sidebar.select("explorer")
        }
      />
      <Toggle
        size="sm"
        iconOnly
        indicator="glyph"
        aria-label={`${WORKBENCH_KINDS.editor.label} Sidebar`}
        pressed={explorerShown}
        onPressedChange={onToggle}
      >
        <PanelToggleIcon side={sidePanel === "start" ? "left" : "right"} visible={explorerShown} />
      </Toggle>
    </>
  );
}

/** The editor's side panel: the explorer and the workspace search, and in the main area the Changes view too. */
export function EditorSidebar({
  viewKey,
  chatFolder,
  workspace,
  files,
  changes,
  outline,
  tabs,
  sidebar,
  searchRef,
  explorer,
  shown,
  sidePanel,
  main,
  changesView,
  onCopyPath,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly chatFolder: SelectedWorkspace | undefined;
  readonly workspace: SelectedWorkspace | undefined;
  readonly files: EditorData["files"];
  readonly changes: readonly WorktreeFile[];
  readonly outline: {
    readonly path: string | undefined;
    readonly symbols: readonly OutlineSymbol[];
  };
  readonly tabs: readonly FileTab[];
  readonly sidebar: SidebarTab;
  readonly searchRef: RefObject<HTMLDivElement | null>;
  readonly explorer: RefObject<ExplorerHandle | null>;
  readonly shown: boolean;
  readonly sidePanel: "start" | "end";
  /** The Editor is the window's main area: the sidebar has a header that switches its views. */
  readonly main: boolean;
  /** The Changes view, offered in the main area. */
  readonly changesView: ReactNode;
  readonly onCopyPath: (path: string) => void;
}): ReactElement {
  const browsed = useWorkbenchWorkspace();

  const drafts = tabs.flatMap((file) =>
    file.draft === undefined ? [] : [{ path: file.path, contents: file.draft.contents }],
  );

  const views = VIEWS.filter((view) => view.value !== "changes" || changesView !== undefined);
  const activeTab = tabs.find((tab) => tab.path === outline.path);

  return (
    <SidePanel side={sidePanel}>
      <aside
        aria-label={views.find((view) => view.value === sidebar.tab)?.label ?? "Explorer"}
        {...props(styles.explorer)}
      >
        {main && (
          <div {...props(styles.header)}>
            <ExplorerFolderMenu viewKey={viewKey} chatFolder={chatFolder} browsed={browsed} />
            <ToggleGroup
              aria-label="Sidebar views"
              value={[sidebar.tab]}
              xstyle={styles.views}
              onValueChange={(value) => {
                const next = views.find((view) => view.value === value[0]);

                if (next !== undefined) sidebar.show(next.value);
              }}
            >
              {views.map((view) => (
                <Toggle
                  key={view.value}
                  value={view.value}
                  size="xs"
                  iconOnly
                  icon={view.icon}
                  aria-label={view.label}
                />
              ))}
            </ToggleGroup>
          </div>
        )}
        <div {...props(styles.sidebarBody, sidebar.tab !== "explorer" && styles.hidden)}>
          <FilesExplorer
            viewKey={viewKey}
            chatFolder={chatFolder}
            workspace={workspace}
            files={files}
            changes={changes}
            outline={main ? undefined : outline}
            main={main}
            handle={explorer}
            onSearch={() => sidebar.show("search")}
            onCopyPath={onCopyPath}
          />
        </div>
        <div
          ref={searchRef}
          {...props(styles.sidebarBody, sidebar.tab !== "search" && styles.hidden)}
        >
          {sidebar.searchOpened && (
            <WorkspaceSearch
              active={shown && sidebar.tab === "search"}
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
        {changesView !== undefined && (
          <div {...props(styles.sidebarBody, sidebar.tab !== "changes" && styles.hidden)}>
            {changesView}
          </div>
        )}
        {main && (
          <FileOutline
            path={activeTab?.displayPath}
            symbols={outline.symbols}
            empty={outline.path === undefined ? "Open a file to see its outline" : "No symbols"}
            onOpen={(line) => {
              if (outline.path !== undefined) {
                fileActions.open(viewKey, {
                  path: outline.path,
                  target: { kind: "position", line },
                });
              }
            }}
          />
        )}
      </aside>
    </SidePanel>
  );
}
