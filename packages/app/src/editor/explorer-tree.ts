import { useFileTree } from "@nyte-ai/ui/trees/react";
import type {
  ContextMenuItem,
  ContextMenuOpenContext,
  FileTreeDropResult,
  FileTreeRenameEvent,
} from "@nyte-ai/ui/trees";
import { useLayoutEffect, useRef, useState } from "react";
import type { WorkspaceId } from "@nyte-ai/sdk";
import { toast } from "@nyte-ai/ui/toast";
import type { SelectedWorkspace } from "../contract/bridge.ts";
import type { MentionFile } from "../data/files.ts";
import { PIERRE_TREE_CSS } from "@nyte-ai/ui/worker-pool";
import { setWorkbenchDrag } from "../references/composer-file-drop.ts";
import { treeItemHeight } from "./tree-theme.ts";
import type { WorktreeFile } from "./worktree-files.ts";

type Naming =
  | {
      readonly kind: "file" | "folder";
      readonly placeholder: string;
      readonly workspace: WorkspaceId | undefined;
    }
  | undefined;

/** The values the explorer tree's callbacks read, as of the last commit. */
export interface ExplorerLatest {
  readonly files: readonly MentionFile[] | undefined;
  readonly changes: readonly WorktreeFile[];
  readonly naming: Naming;
  readonly workspace: SelectedWorkspace | undefined;
}

/** Creates the explorer's Pierre tree and names new entries in it. */
export function useExplorerTree(
  {
    files,
    changes,
    workspace,
  }: {
    readonly files: readonly MentionFile[] | undefined;
    readonly changes: readonly WorktreeFile[];
    readonly workspace: SelectedWorkspace | undefined;
  },
  events: {
    readonly onCreate: (kind: "file" | "folder", path: string) => void;
    readonly onRename: (event: FileTreeRenameEvent) => void;
    readonly onDrop: (event: FileTreeDropResult) => void;
    readonly onRowMenu:
      | ((item: ContextMenuItem, context: ContextMenuOpenContext) => void)
      | undefined;
  },
) {
  const [naming, setNaming] = useState<Naming>();
  const [itemHeight] = useState(treeItemHeight);

  const latest = useRef<ExplorerLatest>({ files, changes, naming, workspace });
  // oxlint-disable-next-line nyte-code/no-direct-effect -- the tree's callbacks run outside render and read the latest props
  useLayoutEffect(() => {
    latest.current = { files, changes, naming, workspace };
  });

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
      onRename: (event) => {
        const pending = latest.current.naming;

        if (
          pending !== undefined &&
          event.sourcePath === pending.placeholder &&
          event.isFolder === (pending.kind === "folder") &&
          pending.workspace === latest.current.workspace?.id
        ) {
          setNaming(undefined);
          events.onCreate(pending.kind, event.destinationPath);

          return;
        }

        events.onRename(event);
      },
      onError: (message) => toast.add({ type: "error", title: message }),
    },
    dragAndDrop: {
      canDrag: (paths) => {
        const dragged = new Set(paths);

        const entries = (latest.current.files ?? []).filter((file) =>
          dragged.has(file.displayPath),
        );

        setWorkbenchDrag(entries);

        return entries.length > 0;
      },
      onDropComplete: (event) => events.onDrop(event),
    },
    composition: {
      contextMenu:
        events.onRowMenu === undefined
          ? undefined
          : {
              triggerMode: "both",
              buttonVisibility: "always",
              render: () => null,
              onOpen: events.onRowMenu,
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
    setNaming({ kind, placeholder, workspace: latest.current.workspace?.id });
    requestAnimationFrame(() => model.startRenaming(placeholder, { removeIfCanceled: true }));
  };

  return { model, latest, startNaming };
}
