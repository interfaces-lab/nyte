import type { FileTree } from "@nyte-ai/ui/trees";
import { useLayoutEffect, useRef } from "react";
import type { MentionFile } from "../data/files.ts";
import { fuzzyScore } from "../lib/fuzzy-match.ts";
import { syncTreePaths } from "./tree-paths.ts";
import type { WorktreeFile } from "./worktree-files.ts";

/** Which files the explorer lists: all of them, or only the changed ones. */
export type Scope = "all" | "changed";

/** Keeps the tree's rows in step with the listing, and moves to a path once its row is shown. */
export function useShownPaths({
  model,
  files,
  changes,
  scope,
  filter,
  revealPath,
  revealRevision,
  activePath,
}: {
  readonly model: FileTree;
  readonly files: readonly MentionFile[] | undefined;
  readonly changes: readonly WorktreeFile[];
  readonly scope: Scope;
  readonly filter: string;
  readonly revealPath: string | undefined;
  readonly revealRevision: number;
  readonly activePath: string | undefined;
}) {
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
      treePaths(files, changes, scope, filter),
    );

    if (files === undefined) return;

    if (expandedFilter.current.scope === scope && expandedFilter.current.filter === filter) return;
    expandedFilter.current = { scope, filter };

    if (scope !== "changed" && filter === "") return;

    for (const path of shownPaths.current) {
      const item = path.endsWith("/") ? model.getItem(path) : null;

      if (item !== null && "expand" in item) item.expand();
    }
  }, [model, files, changes, scope, filter]);

  const revealed = useRef(0);
  // oxlint-disable-next-line nyte-code/no-direct-effect -- reveals the requested path once the Pierre tree has it
  useLayoutEffect(() => {
    if (revealPath === undefined || revealed.current === revealRevision) return;

    if (!shownPaths.current.has(revealPath)) return;
    revealed.current = revealRevision;
    revealTreePath(model, revealPath);
  }, [model, files, scope, filter, revealPath, revealRevision]);

  const pendingRename = useRef<string | undefined>(undefined);
  // oxlint-disable-next-line nyte-code/no-direct-effect -- names a completed copy only after the refreshed index has added its row
  useLayoutEffect(() => {
    const path = pendingRename.current;

    if (path === undefined || !shownPaths.current.has(path)) return;
    revealTreePath(model, path);

    if (model.startRenaming(path)) pendingRename.current = undefined;
  }, [model, files, scope, filter]);

  const followed = useRef<string | undefined>(undefined);
  // oxlint-disable-next-line nyte-code/no-direct-effect -- follows file activation without moving keyboard focus out of the editor
  useLayoutEffect(() => {
    if (files === undefined || followed.current === activePath) return;
    followed.current = activePath;

    if (activePath === undefined || !shownPaths.current.has(activePath)) return;
    expandAncestors(model, activePath);
    model.scrollToPath(activePath, { offset: "nearest", focus: false });
  }, [model, files, activePath, scope, filter]);

  return {
    collapseFolders,
    renameWhenShown: (path: string) => {
      pendingRename.current = path;
    },
  };
}

/** The paths the tree shows for a scope and a filter. */
export function treePaths(
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

function revealTreePath(model: FileTree, path: string): void {
  expandAncestors(model, path);

  for (const selected of model.getSelectedPaths()) model.getItem(selected)?.deselect();

  model.getItem(path)?.select();
  model.scrollToPath(path, { offset: "nearest", focus: true });
}

function expandAncestors(model: FileTree, path: string): void {
  for (let slash = path.indexOf("/"); slash >= 0; slash = path.indexOf("/", slash + 1)) {
    const item = model.getItem(path.slice(0, slash + 1));

    if (item !== null && "expand" in item) item.expand();
  }
}
