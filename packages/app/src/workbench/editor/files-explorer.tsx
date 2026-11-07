import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { FileTree, useFileTree } from "@pierre/trees/react";
import type {
  ContextMenuItem,
  ContextMenuOpenContext,
  FileTreeRenameEvent,
  FileTree as FileTreeModel,
} from "@pierre/trees";
import { create, props } from "@stylexjs/stylex";
import { useQueryClient } from "@tanstack/react-query";
import { useLayoutEffect, useRef, useState } from "react";
import type { ReactElement } from "react";
import { ConfirmDialog } from "@nyte-ai/ui/alert-dialog";
import { Button } from "@nyte-ai/ui/button";
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from "@nyte-ai/ui/menu";
import { Icon } from "@nyte-ai/ui/icon";
import { Input, InputGroup } from "@nyte-ai/ui/input";
import { selectionWithin } from "@nyte-ai/ui/selection";
import { toast } from "@nyte-ai/ui/toast";
import { Toggle } from "@nyte-ai/ui/toggle";
import { ToggleGroup } from "@nyte-ai/ui/toggle-group";
import { role, type } from "@nyte-ai/ui/styles/vars.stylex";
import type { HostBridge } from "../../contract/bridge.ts";
import { errorMessage } from "../../contract/errors.ts";
import { nyte } from "../../contract/nyte.ts";
import { revealLabel, showContextMenu } from "../../components/context-menu.ts";
import { keys } from "../../data/query-client.ts";
import { refreshVcs } from "../../data/vcs.ts";
import type { MentionFile } from "../../data/files.ts";
import type { SelectedWorkspace } from "../../contract/bridge.ts";
import { PIERRE_TREE_CSS } from "../../lib/pierre-worker-provider.tsx";
import { fuzzyScore } from "../../lib/fuzzy-match.ts";
import { addFileToChat } from "../../references/add-to-chat.ts";
import { setTreeDrag } from "../../references/composer-file-drop.ts";
import type { WorkbenchViewKey } from "../model.ts";
import { workbenchStyles } from "../workbench.stylex.ts";
import { fileActions, useFileTabs } from "./file-store.ts";
import {
  applyChange,
  createFile,
  removeEntry,
  restoreEntry,
  trashEntry,
} from "./file-operations.ts";
import { FileOutline } from "./file-outline.tsx";
import type { OutlineSymbol } from "./outline.ts";
import { syncTreePaths } from "./tree-paths.ts";
import { treeItemHeight } from "./tree-theme.ts";
import type { WorktreeFile } from "./worktree-files.ts";

type Scope = "all" | "changed";

/** A row the tree is naming: a new file or folder that doesn't exist on disk yet, under its placeholder. */
type Naming = { readonly kind: "file" | "folder"; readonly placeholder: string } | undefined;

export function FilesExplorer({
  viewKey,
  workspace,
  files,
  changes,
  outline,
  onSearch,
  onCopyPath,
}: {
  readonly viewKey: WorkbenchViewKey;
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
  const [naming, setNaming] = useState<Naming>();
  const [confirming, setConfirming] = useState<{ readonly path: string; readonly name: string }>();
  const [itemHeight] = useState(treeItemHeight);

  const latest = useRef({ files: files.data, changes, naming, workspace });
  // oxlint-disable-next-line nyte-code/no-direct-effect -- the tree's callbacks run outside render and read the latest props
  useLayoutEffect(() => {
    latest.current = { files: files.data, changes, naming, workspace };
  });

  const absolute = (relative: string): string | undefined => {
    const root = latest.current.workspace?.path;

    if (root === undefined) return undefined;

    return `${root.replace(/\/$/u, "")}/${relative.replace(/\/$/u, "")}`;
  };

  const refresh = (): void => {
    void queryClient.invalidateQueries({ queryKey: keys.mentionFiles(workspace?.id) });
    void refreshVcs();
  };

  const contextMenu = nyte.host.contextMenu;
  const revealPath = nyte.host.revealPath;

  const { model } = useFileTree({
    paths: [],
    density: "compact",
    itemHeight,
    unsafeCSS: PIERRE_TREE_CSS,
    flattenEmptyDirectories: true,
    initialExpansion: 1,
    search: false,
    renaming: {
      canRename: (item) => item.path !== "",
      onRename: (event) => void rename(event),
      onError: (message) => toast.add({ type: "error", title: message }),
    },
    dragAndDrop: {
      canDrag: (paths) => {
        const dragged = new Set(paths);

        const entries = (latest.current.files ?? []).filter((file) =>
          dragged.has(file.displayPath),
        );

        setTreeDrag(entries);

        return entries.length > 0;
      },
      canDrop: () => false,
    },
    composition: {
      contextMenu:
        contextMenu === undefined
          ? undefined
          : {
              triggerMode: "both",
              buttonVisibility: "always",
              render: () => null,
              onOpen: (item, context) => openRowMenu(contextMenu, item, context),
            },
    },
  });

  const startNaming = (kind: "file" | "folder", folder: string): void => {
    const taken = new Set((latest.current.files ?? []).map((file) => file.displayPath));
    const base = kind === "file" ? "untitled" : "new-folder";

    const name =
      [base, ...Array.from({ length: 50 }, (_, index) => `${base}-${String(index + 2)}`)].find(
        (candidate) => !taken.has(`${folder}${candidate}`) && !taken.has(`${folder}${candidate}/`),
      ) ?? `${base}-${crypto.randomUUID().slice(0, 8)}`;

    const placeholder = `${folder}${name}${kind === "folder" ? "/" : ""}`;
    model.add(placeholder);
    setNaming({ kind, placeholder });
    requestAnimationFrame(() => model.startRenaming(placeholder, { removeIfCanceled: true }));
  };

  const rename = async (event: FileTreeRenameEvent): Promise<void> => {
    const pending = latest.current.naming;

    if (pending !== undefined && event.sourcePath === pending.placeholder) {
      setNaming(undefined);
      await createEntry(pending.kind, event.destinationPath);

      return;
    }

    const from = bare(event.sourcePath);
    const to = bare(event.destinationPath);

    const failure = await applyChange((batch) => batch.move({ path: from, to })).catch(
      errorMessage,
    );

    if (failure !== undefined) {
      model.move(event.destinationPath, event.sourcePath);
      toast.add({ type: "error", title: `Couldn't rename ${from}`, description: failure });

      return;
    }

    const source = absolute(from);
    const target = absolute(to);

    if (source !== undefined && target !== undefined)
      fileActions.moved(viewKey, [{ from: source, to: target }]);
    refresh();
  };

  const createEntry = async (kind: "file" | "folder", path: string): Promise<void> => {
    const target = absolute(bare(path));

    if (target === undefined) return;

    const failure =
      kind === "folder"
        ? await applyChange((batch) => batch.mkdir({ path: bare(path) })).catch(errorMessage)
        : await createFile(target).then(
            (outcome) =>
              outcome.kind === "saved" ? undefined : "A file with that name already exists.",
            errorMessage,
          );

    if (failure !== undefined) {
      model.remove(path, { recursive: true });
      toast.add({ type: "error", title: `Couldn't create ${bare(path)}`, description: failure });

      return;
    }

    refresh();

    if (kind === "file") fileActions.open(viewKey, { path: target });
  };

  const duplicate = async (item: ContextMenuItem): Promise<void> => {
    const path = bare(item.path);
    const taken = new Set((latest.current.files ?? []).map((entry) => bare(entry.displayPath)));
    const dot = item.kind === "file" ? path.lastIndexOf(".") : -1;
    const named = dot > path.lastIndexOf("/") + 1;
    const stem = named ? path.slice(0, dot) : path;
    const extension = named ? path.slice(dot) : "";

    const copy =
      [" copy", ...Array.from({ length: 50 }, (_, index) => ` copy ${String(index + 2)}`)]
        .map((suffix) => `${stem}${suffix}${extension}`)
        .find((candidate) => !taken.has(candidate)) ??
      `${stem} copy ${crypto.randomUUID().slice(0, 8)}${extension}`;

    const failure = await applyChange((batch) => batch.copy({ path, to: copy })).catch(
      errorMessage,
    );

    if (failure !== undefined) {
      toast.add({ type: "error", title: `Couldn't duplicate ${path}`, description: failure });

      return;
    }

    refresh();
    const target = absolute(copy);

    if (item.kind === "file" && target !== undefined)
      fileActions.open(viewKey, { path: target, preview: true });
  };

  const remove = async (item: ContextMenuItem): Promise<void> => {
    const path = bare(item.path);
    const name = path.split("/").at(-1) ?? path;

    const held = await trashEntry(path).then(
      (outcome) => outcome,
      (cause: unknown) => ({ kind: "failed" as const, message: errorMessage(cause) }),
    );

    if (held.kind === "unavailable") {
      setConfirming({ path, name });

      return;
    }

    if (held.kind === "failed" || held.kind === "invalid" || held.kind === "busy") {
      toast.add({
        type: "error",
        title: `Couldn't delete ${path}`,
        description:
          held.kind === "failed"
            ? held.message
            : held.kind === "busy"
              ? "Something has a file in it open."
              : "Only files in the workspace can be deleted here.",
      });

      return;
    }

    refresh();

    if (held.kind === "stale") return;
    const token = held.token;

    const id = toast.add({
      title: `Deleted ${name}`,
      timeout: 6_000,
      actionProps: {
        children: "Undo",
        onClick: () => {
          toast.close(id);
          void restoreEntry(token).then(
            (restored) => {
              if (restored.kind !== "restored")
                toast.add({
                  type: "error",
                  title: `Couldn't restore ${name}`,
                  description:
                    restored.reason === "exists"
                      ? `Something is at ${path} now.`
                      : "It's no longer held. The host restarted since.",
                });

              refresh();
            },
            (cause: unknown) =>
              toast.add({
                type: "error",
                title: `Couldn't restore ${name}`,
                description: errorMessage(cause),
              }),
          );
        },
      },
    });
  };

  const removeForGood = async (path: string): Promise<void> => {
    const failure = await removeEntry(path).then(
      (outcome) => (outcome.kind === "saved" ? undefined : `${path} changed.`),
      errorMessage,
    );

    if (failure !== undefined)
      toast.add({ type: "error", title: `Couldn't delete ${path}`, description: failure });
    refresh();
  };

  const openRowMenu = (
    menu: NonNullable<HostBridge["contextMenu"]>,
    item: ContextMenuItem,
    context: ContextMenuOpenContext,
  ): void => {
    context.close({ restoreFocus: false });
    const file = latest.current.files?.find((entry) => entry.displayPath === item.path);
    const relative = item.path.replace(/\/$/u, "");
    const absolutePath = file?.path ?? absolute(relative);

    const folder =
      item.kind === "directory" ? item.path : item.path.slice(0, item.path.lastIndexOf("/") + 1);

    void showContextMenu(
      menu,
      { clientX: context.anchorRect.left, clientY: context.anchorRect.bottom },
      [
        file !== undefined &&
          item.kind === "file" && {
            kind: "item",
            label: "Open File",
            run: () => fileActions.open(viewKey, file),
          },
        file !== undefined &&
          item.kind === "file" && {
            kind: "item",
            label: "Add File to Chat",
            run: () => addFileToChat(file),
          },
        { kind: "item", label: "New File\u2026", run: () => startNaming("file", folder) },
        { kind: "item", label: "New Folder\u2026", run: () => startNaming("folder", folder) },
        { kind: "separator" },
        absolutePath !== undefined &&
          revealPath !== undefined && {
            kind: "item",
            label: revealLabel(nyte.platform),
            run: () => void revealPath({ path: absolutePath }),
          },
        { kind: "item", label: "Search Files", run: onSearch },
        { kind: "separator" },
        absolutePath !== undefined && {
          kind: "item",
          label: "Copy Path",
          run: () => onCopyPath(absolutePath),
        },
        { kind: "item", label: "Copy Relative Path", run: () => onCopyPath(relative) },
        { kind: "separator" },
        { kind: "item", label: "Rename\u2026", run: () => model.startRenaming(item.path) },
        { kind: "item", label: "Duplicate", run: () => void duplicate(item) },
        { kind: "item", label: "Delete", run: () => void remove(item) },
        { kind: "separator" },
        { kind: "item", label: "Refresh Explorer", run: refresh },
      ],
    );
  };

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
    )
      return;

    const row = event
      .composedPath()
      .find((target) => target instanceof HTMLElement && target.dataset.type === "item");

    if (!(row instanceof HTMLElement) || row.dataset.itemType !== "file") return;

    if (selectionWithin(row)) return;
    const file = files.data?.find((candidate) => candidate.displayPath === row.dataset.itemPath);

    if (file !== undefined) fileActions.open(viewKey, { ...file, preview });
  };

  const shownPaths = useRef<ReadonlySet<string>>(new Set());
  const expandedFilter = useRef({ scope, filter });

  const collapseFolders = (): void => {
    for (const path of [...shownPaths.current].sort((left, right) => right.length - left.length)) {
      const item = path.endsWith("/") ? model.getItem(path) : null;

      if (item !== null && "collapse" in item) item.collapse();
    }
  };

  // oxlint-disable-next-line nyte-code/no-direct-effect -- pushes path changes into the imperative Pierre tree
  useLayoutEffect(() => {
    shownPaths.current = syncTreePaths(
      model,
      shownPaths.current,
      treePaths(files.data, changes, scope, filter),
    );

    if (files.data === undefined) return;

    if (expandedFilter.current.scope === scope && expandedFilter.current.filter === filter) return;
    expandedFilter.current = { scope, filter };

    if (scope !== "changed" && filter === "") return;

    for (const path of shownPaths.current) {
      const item = path.endsWith("/") ? model.getItem(path) : null;

      if (item !== null && "expand" in item) item.expand();
    }
  }, [model, files.data, changes, scope, filter]);

  const revealed = useRef(0);
  // oxlint-disable-next-line nyte-code/no-direct-effect -- reveals the requested path once the Pierre tree has it
  useLayoutEffect(() => {
    if (tabs.revealPath === undefined || revealed.current === tabs.revealRevision) return;

    if (!shownPaths.current.has(tabs.revealPath)) return;
    revealed.current = tabs.revealRevision;
    expandAncestors(model, tabs.revealPath);

    for (const path of model.getSelectedPaths()) model.getItem(path)?.deselect();

    model.getItem(tabs.revealPath)?.select();
    model.scrollToPath(tabs.revealPath, { offset: "nearest", focus: true });
  }, [model, files.data, scope, filter, tabs.revealPath, tabs.revealRevision]);

  const activePath = tabs.active?.external === false ? tabs.active.displayPath : undefined;
  const followed = useRef<string | undefined>(undefined);
  // oxlint-disable-next-line nyte-code/no-direct-effect -- follows file activation without moving keyboard focus out of the editor
  useLayoutEffect(() => {
    if (files.data === undefined || followed.current === activePath) return;
    followed.current = activePath;

    if (activePath === undefined || !shownPaths.current.has(activePath)) return;
    expandAncestors(model, activePath);
    model.scrollToPath(activePath, { offset: "nearest", focus: false });
  }, [model, files.data, activePath, scope, filter]);
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
        <span {...props(styles.name)}>{workspace?.name ?? "Workspace"}</span>
        <ToggleGroup
          aria-label="Show"
          value={[scope]}
          onValueChange={(value) => {
            const next = value[0];

            if (next === "all" || next === "changed") setSelection({ ...listing, scope: next });
          }}
        >
          <Toggle value="all" size="2xs">
            All
          </Toggle>
          <Toggle value="changed" size="2xs">
            Changed {changes.length}
          </Toggle>
        </ToggleGroup>
        <Menu>
          <MenuTrigger
            render={<Button iconOnly icon="more-horizontal" aria-label="Explorer Options" />}
          />
          <MenuContent align="end">
            <MenuItem layout="plain" onClick={() => startNaming("file", "")}>
              New File…
            </MenuItem>
            <MenuItem layout="plain" onClick={() => startNaming("folder", "")}>
              New Folder…
            </MenuItem>
            <MenuSeparator />
            <MenuItem layout="plain" onClick={refresh}>
              Refresh Explorer
            </MenuItem>
            <MenuItem layout="plain" onClick={collapseFolders}>
              Collapse Folders
            </MenuItem>
          </MenuContent>
        </Menu>
      </div>
      <div {...props(styles.filter)}>
        <InputGroup>
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
      </div>
      {files.error !== null && (
        <div role="alert" {...props(styles.empty)}>
          Could not load files. {files.error.message}
        </div>
      )}
      {unmatched && (
        <div role="status" {...props(styles.empty)}>
          No files match {filter}
        </div>
      )}
      {scope === "changed" && changes.length === 0 && (
        <div role="status" {...props(styles.empty)}>
          No changes
        </div>
      )}
      <FileTree
        model={model}
        onDragEnd={() => setTreeDrag([])}
        onClick={(event) => {
          if (!(event.metaKey || event.ctrlKey || event.shiftKey))
            openFromTree(event.nativeEvent, true);
        }}
        onDoubleClick={(event) => openFromTree(event.nativeEvent, false)}
        onKeyDown={(event) => {
          if (event.key === "Enter") openFromTree(event.nativeEvent, true);

          if (event.key === "F2") {
            const path = model.getFocusedPath();

            if (path !== null) model.startRenaming(path);
          }
        }}
        {...props(workbenchStyles.treeTheme, styles.tree, unmatched && styles.hidden)}
      />
      <FileOutline
        path={tabs.active?.displayPath}
        symbols={outline.symbols}
        empty={outline.path === undefined ? "Open a file to see its outline" : "No symbols"}
        onOpen={(line) => {
          if (outline.path !== undefined) fileActions.open(viewKey, { path: outline.path, line });
        }}
      />
      <ConfirmDialog
        open={confirming !== undefined}
        title={`Delete ${confirming?.name ?? ""}?`}
        description="This workspace can't hold deleted files for undo, so it's deleted for good."
        confirmLabel="Delete"
        onOpenChange={(open) => {
          if (!open) setConfirming(undefined);
        }}
        onConfirm={() => {
          const path = confirming?.path;
          setConfirming(undefined);

          if (path !== undefined) void removeForGood(path);
        }}
      />
    </div>
  );
}

function treePaths(
  files: readonly MentionFile[] | undefined,
  changes: readonly WorktreeFile[],
  scope: Scope,
  filter: string,
): readonly string[] {
  const changed = new Set(changes.map((change) => change.path));
  const needle = filter.trim();

  return (files ?? [])
    .map((file) => file.displayPath)
    .filter(
      (path) =>
        (scope === "all" || changed.has(path)) &&
        (needle === "" ||
          (!path.endsWith("/") &&
            fuzzyScore(path.slice(path.lastIndexOf("/") + 1), needle) !== undefined)),
    );
}

function expandAncestors(model: FileTreeModel, path: string): void {
  for (let slash = path.indexOf("/"); slash >= 0; slash = path.indexOf("/", slash + 1)) {
    const item = model.getItem(path.slice(0, slash + 1));

    if (item !== null && "expand" in item) item.expand();
  }
}

/** A tree path without the slash that marks a folder: how the files API names it. */
function bare(path: string): string {
  return path.replace(/\/$/u, "");
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
  name: {
    flex: 1,
    minWidth: 0,
    overflow: "hidden",
    textOverflow: "ellipsis",
    whiteSpace: "nowrap",
    color: role.contentSecondary,
    fontSize: type.fontBase,
    lineHeight: type.leadingBase,
  },
  filter: { flexShrink: 0, paddingInline: space.s2, paddingBlockEnd: space.s1_5 },
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
    "--trees-border-radius-override": radius.indicator,
    "--trees-item-margin-x-override": "0px",
    "--trees-item-padding-x-override": "5px",
    "--trees-item-row-gap-override": "4px",
    "--trees-level-gap-override": "5px",
    "--trees-padding-inline-override": "6px",
  },
});
