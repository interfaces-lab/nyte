import type {
  ContextMenuItem,
  FileTree,
  FileTreeDropResult,
  FileTreeRenameEvent,
} from "@nyte-ai/ui/trees";
import type { QueryClient } from "@tanstack/react-query";
import type { RefObject } from "react";
import type { WorkspaceId } from "@nyte-ai/sdk";
import { toast } from "@nyte-ai/ui/toast";
import { errorMessage } from "../contract/errors.ts";
import { keys } from "../data/query-client.ts";
import { refreshVcs } from "../data/vcs.ts";
import type { WorkbenchViewKey } from "../workbench/model.ts";
import type { ExplorerLatest } from "./explorer-tree.ts";
import { fileActions } from "./file-store.ts";
import {
  applyChange,
  createFile,
  removeEntry,
  restoreEntry,
  trashEntry,
} from "./file-operations.ts";

/** The tree, view and latest values the explorer's file operations act on. */
export interface Explorer {
  readonly model: FileTree;
  readonly viewKey: WorkbenchViewKey;
  readonly latest: RefObject<ExplorerLatest>;
  readonly queryClient: QueryClient;
}

/** An entry the workspace can't hold for undo, waiting for the person to confirm its deletion. */
export interface DeleteTarget {
  readonly workspace: WorkspaceId | undefined;
  readonly path: string;
  readonly name: string;
}

/** The absolute path of a workspace-relative path, once the explorer has a workspace. */
export function absolute(explorer: Explorer, relative: string): string | undefined {
  const root = explorer.latest.current.workspace?.path;

  if (root === undefined) return undefined;

  return `${root.replace(/\/$/u, "")}/${relative.replace(/\/$/u, "")}`;
}

/** Refetches a workspace's file index and version-control state. */
export function refreshWorkspace(queryClient: QueryClient, id: WorkspaceId | undefined): void {
  void queryClient.invalidateQueries({ queryKey: keys.mentionFiles(id) });
  void refreshVcs(id);
}

/** Refetches the explorer's current workspace. */
export function refresh(explorer: Explorer): void {
  refreshWorkspace(explorer.queryClient, explorer.latest.current.workspace?.id);
}

/** Moves an entry the tree renamed, and puts it back if the host refuses. */
export async function rename(explorer: Explorer, event: FileTreeRenameEvent): Promise<void> {
  const from = bare(event.sourcePath);
  const to = bare(event.destinationPath);

  const failure = await applyChange(explorer.latest.current.workspace?.id, (batch) =>
    batch.move({ path: from, to }),
  ).catch(errorMessage);

  if (failure !== undefined) {
    explorer.model.move(event.destinationPath, event.sourcePath);
    toast.add({ type: "error", title: `Couldn't rename ${from}`, description: failure });

    return;
  }

  const source = absolute(explorer, from);
  const target = absolute(explorer, to);

  if (source !== undefined && target !== undefined) {
    fileActions.moved(explorer.viewKey, [{ from: source, to: target }]);
  }
  refresh(explorer);
}

/** Moves the entries dropped on the tree, and puts them back if the host refuses. */
export async function drop(explorer: Explorer, event: FileTreeDropResult): Promise<void> {
  const folder = event.target.kind === "directory" ? (event.target.directoryPath ?? "") : "";

  const moves = event.draggedPaths
    .map((path) => ({ path, to: `${folder}${path.slice(bare(path).lastIndexOf("/") + 1)}` }))
    .filter((move) => move.to !== move.path);

  if (moves.length === 0) return;

  const failure = await applyChange(explorer.latest.current.workspace?.id, (batch) =>
    moves.reduce((next, move) => next.move({ path: bare(move.path), to: bare(move.to) }), batch),
  ).catch(errorMessage);

  if (failure !== undefined) {
    for (const move of moves) explorer.model.move(move.to, move.path);
    const names = moves.map((move) => bare(move.path));

    toast.add({
      type: "error",
      title: `Couldn't move ${names.length === 1 ? names.join("") : `${String(names.length)} items`}`,
      description: failure,
    });
    refresh(explorer);

    return;
  }

  fileActions.moved(
    explorer.viewKey,
    moves.flatMap((move) => {
      const from = absolute(explorer, bare(move.path));
      const to = absolute(explorer, bare(move.to));

      return from === undefined || to === undefined ? [] : [{ from, to }];
    }),
  );
  refresh(explorer);
}

/** Creates the file or folder a new tree row was named, and opens a new file. */
export async function createEntry(
  explorer: Explorer,
  kind: "file" | "folder",
  path: string,
): Promise<void> {
  const target = absolute(explorer, bare(path));

  if (target === undefined) return;

  const failure =
    kind === "folder"
      ? await applyChange(explorer.latest.current.workspace?.id, (batch) =>
          batch.mkdir({ path: bare(path) }),
        ).catch(errorMessage)
      : await createFile(explorer.latest.current.workspace?.id, target).then(
          (outcome) =>
            outcome.kind === "saved" ? undefined : "A file with that name already exists.",
          errorMessage,
        );

  if (failure !== undefined) {
    explorer.model.remove(path, { recursive: true });
    toast.add({ type: "error", title: `Couldn't create ${bare(path)}`, description: failure });

    return;
  }

  refresh(explorer);

  if (kind === "file") fileActions.open(explorer.viewKey, { path: target });
}

/** Copies an entry beside itself and hands the copy's row path to `onCopied`. */
export async function duplicate(
  explorer: Explorer,
  item: ContextMenuItem,
  onCopied: (path: string) => void,
): Promise<void> {
  const path = bare(item.path);

  const taken = new Set(
    (explorer.latest.current.files ?? []).map((entry) => bare(entry.displayPath)),
  );

  const dot = item.kind === "file" ? path.lastIndexOf(".") : -1;
  const named = dot > path.lastIndexOf("/") + 1;
  const stem = named ? path.slice(0, dot) : path;
  const extension = named ? path.slice(dot) : "";

  const copy =
    [" copy", ...Array.from({ length: 50 }, (_, index) => ` copy ${String(index + 2)}`)]
      .map((suffix) => `${stem}${suffix}${extension}`)
      .find((candidate) => !taken.has(candidate)) ??
    `${stem} copy ${crypto.randomUUID().slice(0, 8)}${extension}`;

  const failure = await applyChange(explorer.latest.current.workspace?.id, (batch) =>
    batch.copy({ path, to: copy }),
  ).catch(errorMessage);

  if (failure !== undefined) {
    toast.add({ type: "error", title: `Couldn't duplicate ${path}`, description: failure });

    return;
  }

  onCopied(`${copy}${item.kind === "directory" ? "/" : ""}`);
  refresh(explorer);
  const target = absolute(explorer, copy);

  if (item.kind === "file" && target !== undefined) {
    fileActions.open(explorer.viewKey, { path: target, preview: true });
  }
}

/** Moves an entry to the host's trash with an undo toast, or asks `confirm` when it can't be held. */
export async function remove(
  explorer: Explorer,
  item: ContextMenuItem,
  confirm: (target: DeleteTarget) => void,
): Promise<void> {
  const path = bare(item.path);
  const name = path.split("/").at(-1) ?? path;
  const workspace = explorer.latest.current.workspace?.id;

  const held = await trashEntry(workspace, path).then(
    (outcome) => outcome,
    (cause: unknown) => ({ kind: "failed" as const, message: errorMessage(cause) }),
  );

  if (held.kind === "unavailable") {
    confirm({ workspace, path, name });

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

  refresh(explorer);

  if (held.kind === "stale") return;
  const token = held.token;

  const id = toast.add({
    title: `Deleted ${name}`,
    timeout: 6000,
    actionProps: {
      children: "Undo",
      onClick: () => {
        toast.close(id);
        void restoreEntry(workspace, token).then(
          (restored) => {
            if (restored.kind !== "restored") {
              toast.add({
                type: "error",
                title: `Couldn't restore ${name}`,
                description:
                  restored.reason === "exists"
                    ? `Something is at ${path} now.`
                    : "It's no longer held. The host restarted since.",
              });
            }

            refresh(explorer);
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
}

/** Deletes an entry without a way back. */
export async function removeForGood(
  queryClient: QueryClient,
  workspace: WorkspaceId | undefined,
  path: string,
): Promise<void> {
  const failure = await removeEntry(workspace, path).then(
    (outcome) => (outcome.kind === "saved" ? undefined : `${path} changed.`),
    errorMessage,
  );

  if (failure !== undefined) {
    toast.add({ type: "error", title: `Couldn't delete ${path}`, description: failure });
  }
  refreshWorkspace(queryClient, workspace);
}

function bare(path: string): string {
  return path.replace(/\/$/u, "");
}
