import { PanelToggleIcon } from "@nyte-ai/ui/icon";
import { Toggle } from "@nyte-ai/ui/toggle";
import { create, props } from "@stylexjs/stylex";
import { useState } from "react";
import type { ReactElement, RefObject } from "react";
import type { SelectedWorkspace } from "../contract/bridge.ts";
import { WORKBENCH_KINDS } from "../workbench/model.ts";
import type { WorkbenchViewKey } from "../workbench/model.ts";
import { SidePanel } from "../workbench/side-panel.tsx";
import { WorkspaceSearch } from "../workbench/workspace-search.tsx";
import type { EditorData } from "./editor-data.ts";
import { fileActions } from "./file-store.ts";
import type { FileTab } from "./file-store.ts";
import { FilesExplorer } from "./files-explorer.tsx";
import type { WorktreeFile } from "./worktree-files.ts";
import type { OutlineSymbol } from "./outline.ts";

const styles = create({
  explorer: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 },
  sidebarBody: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 },
  hidden: { display: "none" },
});

/** The tab the editor's sidebar shows. */
export type SidebarTabName = "explorer" | "search";

/** The sidebar's selected tab, and whether its search has opened once. */
export interface SidebarTab {
  readonly tab: SidebarTabName;
  readonly searchOpened: boolean;
  readonly select: (tab: SidebarTabName) => void;
  readonly showSearch: () => void;
}

/** Tracks the sidebar's tab, which falls back to the explorer whenever the file store reveals a file. */
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

  const showSearch = (): void => {
    showSidebar();
    setSearchOpened(true);
    setSidebarSelection({ revision: revealRevision, tab: "search" });
    requestAnimationFrame(() => searchRef.current?.querySelector("input")?.focus());
  };

  return {
    tab: sidebar,
    searchOpened,
    select: (tab) => setSidebarSelection({ revision: revealRevision, tab }),
    showSearch,
  };
}

/** The toolbar's search and sidebar toggles. */
export function SidebarToggles({
  explorerDocked,
  sidePanel,
  explorerShown,
  sidebar,
  onToggle,
}: {
  readonly explorerDocked: boolean;
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
        onPressedChange={(pressed) => (pressed ? sidebar.showSearch() : sidebar.select("explorer"))}
      />
      {!explorerDocked && (
        <Toggle
          size="sm"
          iconOnly
          indicator="glyph"
          aria-label={`${WORKBENCH_KINDS.editor.label} Sidebar`}
          pressed={explorerShown}
          onPressedChange={onToggle}
        >
          <PanelToggleIcon
            side={sidePanel === "start" ? "left" : "right"}
            visible={explorerShown}
          />
        </Toggle>
      )}
    </>
  );
}

/** The editor's side panel, holding the explorer and the workspace search. */
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
  shown,
  sidePanel,
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
  readonly shown: boolean;
  readonly sidePanel: "start" | "end";
  readonly onCopyPath: (path: string) => void;
}): ReactElement {
  const drafts = tabs.flatMap((file) =>
    file.draft === undefined ? [] : [{ path: file.path, contents: file.draft.contents }],
  );

  return (
    <SidePanel side={sidePanel}>
      <aside
        aria-label={sidebar.tab === "search" ? "Workspace search" : "Explorer"}
        {...props(styles.explorer)}
      >
        <div {...props(styles.sidebarBody, sidebar.tab !== "explorer" && styles.hidden)}>
          <FilesExplorer
            viewKey={viewKey}
            chatFolder={chatFolder}
            workspace={workspace}
            files={files}
            changes={changes}
            outline={outline}
            onSearch={sidebar.showSearch}
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
      </aside>
    </SidePanel>
  );
}
