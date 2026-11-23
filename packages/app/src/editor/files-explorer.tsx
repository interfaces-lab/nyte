import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { FileTree } from "@nyte-ai/ui/trees/react";
import { create, props } from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useState } from "react";
import type { ReactElement } from "react";
import type { SelectedWorkspace } from "../contract/bridge.ts";
import { Button } from "@nyte-ai/ui/button";
import { Icon } from "@nyte-ai/ui/icon";
import { Input, InputGroup } from "@nyte-ai/ui/input";
import { selectionWithin } from "@nyte-ai/ui/selection";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import { nyte } from "../contract/nyte.ts";
import type { MentionFile } from "../data/files.ts";
import { setWorkbenchDrag } from "../references/composer-file-drop.ts";
import type { WorkbenchViewKey } from "../workbench/model.ts";
import { workbenchStyles } from "../workbench/workbench.stylex.ts";
import { DeleteConfirmation } from "./delete-confirmation.tsx";
import { createEntry, drop, duplicate, refresh, remove, rename } from "./explorer-operations.ts";
import type { DeleteTarget } from "./explorer-operations.ts";
import { treePaths, useShownPaths } from "./explorer-paths.ts";
import type { Scope } from "./explorer-paths.ts";
import { openRowMenu } from "./explorer-row-menu.ts";
import { useExplorerTree } from "./explorer-tree.ts";
import { fileActions, useFileTabs } from "./file-store.ts";
import { workspaceFile } from "../workbench/paths.ts";
import { useWorkbenchWorkspace } from "../workbench/workbench-workspace.tsx";
import { ExplorerFolderMenu, ExplorerFolderState } from "./explorer-folder.tsx";
import { FileOutline } from "./file-outline.tsx";
import type { OutlineSymbol } from "./outline.ts";
import type { WorktreeFile } from "./worktree-files.ts";

export function FilesExplorer({
  viewKey,
  chatFolder,
  workspace,
  files,
  changes,
  outline,
  onSearch,
  onCopyPath,
}: {
  readonly viewKey: WorkbenchViewKey;
  readonly chatFolder: SelectedWorkspace | undefined;
  readonly workspace: SelectedWorkspace | undefined;
  readonly files: {
    readonly data: readonly MentionFile[] | undefined;
    readonly error: Error | null;
  };
  readonly changes: readonly WorktreeFile[];
  readonly outline: {
    readonly path: string | undefined;
    readonly symbols: readonly OutlineSymbol[];
  };
  readonly onSearch: () => void;
  readonly onCopyPath: (path: string) => void;
}): ReactElement {
  const queryClient = useQueryClient();
  const browsed = useWorkbenchWorkspace();
  const tabs = useFileTabs(viewKey);

  const [selection, setSelection] = useState<{
    readonly revision: number;
    readonly scope: Scope;
    readonly filter: string;
  }>({ revision: tabs.revealRevision, scope: "all", filter: "" });

  const listing =
    selection.revision === tabs.revealRevision
      ? selection
      : { revision: tabs.revealRevision, scope: "all" as const, filter: "" };

  const scope = listing.scope;
  const filter = listing.filter;

  const [confirming, setConfirming] = useState<DeleteTarget>();

  const contextMenu = nyte.host.contextMenu;
  const revealPath = nyte.host.revealPath;

  const { model, latest, startNaming } = useExplorerTree(
    { files: files.data, changes, workspace },
    {
      onCreate: (kind, path) => void createEntry(explorer, kind, path),
      onRename: (event) => void rename(explorer, event),
      onDrop: (event) => void drop(explorer, event),
      onRowMenu:
        contextMenu === undefined
          ? undefined
          : (item, context) =>
              openRowMenu(contextMenu, item, context, {
                explorer,
                revealPath,
                startNaming,
                duplicate: (entry) =>
                  void duplicate(explorer, entry, (path) => {
                    renameWhenShown(path);
                    setSelection({ revision: tabs.revealRevision, scope: "all", filter: "" });
                  }),
                remove: (entry) => void remove(explorer, entry, setConfirming),
                onSearch,
                onCopyPath,
              }),
    },
  );

  const explorer = { model, viewKey, latest, queryClient };

  const openFromTree = (event: Event, preview: boolean): void => {
    if (
      event
        .composedPath()
        .some(
          (target) =>
            target instanceof HTMLElement &&
            (target.dataset.type === "context-menu-trigger" ||
              target.dataset.type === "context-menu-anchor"),
        )
    ) {
      return;
    }

    const row = event
      .composedPath()
      .find((target) => target instanceof HTMLElement && target.dataset.type === "item");

    if (!(row instanceof HTMLElement) || row.dataset.itemType !== "file") return;

    if (selectionWithin(row)) return;
    const file = files.data?.find((candidate) => candidate.displayPath === row.dataset.itemPath);

    if (file !== undefined) fileActions.open(viewKey, { ...file, preview });
  };

  const activePath =
    tabs.active === undefined || workspace === undefined
      ? undefined
      : workspaceFile(tabs.active.path, [workspace.path])?.relative;

  const { collapseFolders, renameWhenShown } = useShownPaths({
    model,
    files: files.data,
    changes,
    scope,
    filter,
    revealPath: tabs.revealPath,
    revealRevision: tabs.revealRevision,
    activePath,
  });

  // oxlint-disable-next-line nyte-code/no-direct-effect -- pushes worktree statuses into the imperative Pierre tree
  useLayoutEffect(() => {
    model.setGitStatus(
      changes.map((file) => ({
        path: file.path,
        status: file.kind === "conflicted" ? "modified" : file.kind,
      })),
    );
  }, [model, changes]);
  const unmatched = filter !== "" && treePaths(files.data, changes, scope, filter).length === 0;

  return (
    <div {...props(styles.explorer)}>
      <div {...props(styles.header)}>
        <ExplorerFolderMenu viewKey={viewKey} chatFolder={chatFolder} browsed={browsed} />
        {browsed.kind === "ready" && (
          <div {...props(styles.actions)}>
            <Button
              iconOnly
              size="sm"
              icon="file-add"
              aria-label="New File"
              onClick={() => startNaming("file", "")}
            />
            <Button
              iconOnly
              size="sm"
              icon="folder-add"
              aria-label="New Folder"
              onClick={() => startNaming("folder", "")}
            />
            <Button
              iconOnly
              size="sm"
              icon="refresh"
              aria-label="Refresh Explorer"
              onClick={() => refresh(explorer)}
            />
            <Button
              iconOnly
              size="sm"
              icon="collapse"
              aria-label="Collapse Folders"
              onClick={collapseFolders}
            />
          </div>
        )}
      </div>
      {browsed.kind !== "ready" && (
        <ExplorerFolderState viewKey={viewKey} chatFolder={chatFolder} browsed={browsed} />
      )}
      {browsed.kind === "ready" && (
        <div {...props(styles.filter)}>
          <InputGroup xstyle={styles.filterField}>
            <Icon name="search" size="sm" />
            <Input
              aria-label="Filter files"
              placeholder="Filter files"
              value={filter}
              onChange={(event) => setSelection({ ...listing, filter: event.target.value })}
              onKeyDown={(event) => {
                if (event.key === "Escape" && filter !== "") {
                  event.stopPropagation();
                  setSelection({ ...listing, filter: "" });
                }

                if (event.key === "ArrowDown") {
                  event.preventDefault();
                  model.focusFirstItem();
                }
              }}
            />
          </InputGroup>
          <ToggleGroup
            aria-label="Show"
            xstyle={styles.scope}
            value={[scope]}
            onValueChange={(value) => {
              const next = value[0];

              if (next === "all" || next === "changed") setSelection({ ...listing, scope: next });
            }}
          >
            <Toggle value="all" size="sm" xstyle={styles.scopeOption}>
              All
            </Toggle>
            <Toggle value="changed" size="sm" xstyle={styles.scopeOption}>
              Changed <span {...props(styles.count)}>{changes.length}</span>
            </Toggle>
          </ToggleGroup>
        </div>
      )}
      {browsed.kind === "ready" && files.error !== null && (
        <div role="alert" {...props(styles.empty)}>
          Could not load files. {files.error.message}
        </div>
      )}
      {unmatched && (
        <div role="status" {...props(styles.empty)}>
          No files match {filter}
        </div>
      )}
      {browsed.kind === "ready" && scope === "changed" && changes.length === 0 && (
        <div role="status" {...props(styles.empty)}>
          No changes
        </div>
      )}
      <FileTree
        model={model}
        onDragEnd={() => setWorkbenchDrag([])}
        onClick={(event) => {
          if (!(event.metaKey || event.ctrlKey || event.shiftKey)) {
            openFromTree(event.nativeEvent, true);
          }
        }}
        onDoubleClick={(event) => openFromTree(event.nativeEvent, false)}
        onKeyDown={(event) => {
          if (
            event.defaultPrevented ||
            event.nativeEvent.isComposing ||
            event.metaKey ||
            event.ctrlKey ||
            event.altKey ||
            event.shiftKey
          ) {
            return;
          }

          if (
            event.nativeEvent
              .composedPath()
              .some(
                (target) =>
                  target instanceof HTMLElement &&
                  target.matches('input, textarea, [contenteditable="true"]'),
              )
          ) {
            return;
          }

          if (event.key === "Enter") openFromTree(event.nativeEvent, true);

          if (event.key === "F2") {
            const path = model.getFocusedPath();

            if (path !== null) model.startRenaming(path);
          }
        }}
        {...props(
          workbenchStyles.treeTheme,
          styles.tree,
          (unmatched || browsed.kind !== "ready") && styles.hidden,
        )}
      />
      <FileOutline
        path={tabs.active?.displayPath}
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
      <DeleteConfirmation confirming={confirming} onClose={() => setConfirming(undefined)} />
    </div>
  );
}

const styles = create({
  explorer: { display: "flex", flexDirection: "column", flex: 1, minWidth: 0, minHeight: 0 },
  header: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    flexShrink: 0,
    paddingBlock: space.s1_5,
    paddingInline: space.s2_5,
  },
  actions: { display: "flex", gap: space.px, marginInlineStart: "auto" },
  filter: {
    display: "flex",
    flexWrap: "wrap",
    alignItems: "center",
    gap: space.s1_5,
    flexShrink: 0,
    paddingInline: space.s2,
    paddingBlockEnd: space.s1_5,
  },
  filterField: { flexGrow: 999, flexBasis: "8rem", minWidth: 0 },
  scope: { flexGrow: 1 },
  scopeOption: { flexGrow: 1 },
  count: { fontVariantNumeric: "tabular-nums" },
  empty: {
    padding: space.s5,
    color: role.contentSecondary,
    fontSize: type.fontSm,
    lineHeight: type.leadingSm,
    overflowWrap: "anywhere",
  },
  hidden: { display: "none" },
  tree: {
    display: "block",
    flex: 1,
    width: "100%",
    minHeight: 0,
    paddingBlockStart: space.s1,
    "--trees-border-radius-override": radius.indicator,
    "--trees-item-margin-x-override": "0px",
    "--trees-item-padding-x-override": "5px",
    "--trees-item-row-gap-override": "4px",
    "--trees-level-gap-override": "5px",
    "--trees-padding-inline-override": "6px",
  },
});
