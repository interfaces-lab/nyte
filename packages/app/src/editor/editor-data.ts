import type { Document } from "@nyte-ai/sdk";
import type { SelectedWorkspace } from "../contract/bridge.ts";
import { useDocument } from "../data/documents.ts";
import { useMentionFiles } from "../data/files.ts";
import { useVcsSnapshot } from "../data/vcs.ts";
import { workspaceFile } from "../workbench/paths.ts";
import { useWorkbenchWorkspace } from "../workbench/workbench-workspace.tsx";
import { useChatChanges } from "./chat-changes.ts";
import { worktreeFiles } from "./worktree-files.ts";
import type { WorktreeFile } from "./worktree-files.ts";

/** The reads the editor panel shares between its regions. */
export interface EditorData {
  readonly workspace: SelectedWorkspace | undefined;
  readonly files: ReturnType<typeof useMentionFiles>;
  readonly changes: readonly WorktreeFile[];
  /** The checked-out branch, or the short commit a detached HEAD sits on. Undefined outside a git repository. */
  readonly branch: string | undefined;
  readonly activeDocument: Document | undefined;
}

/** Reads the browsed workspace, its files and changes, and the active file's document. */
export function useEditorData(shown: boolean, activePath: string | undefined): EditorData {
  const browsed = useWorkbenchWorkspace();
  const workspace = browsed.kind === "ready" ? browsed.workspace : undefined;
  const files = useMentionFiles(workspace, shown && workspace !== undefined);

  const vcs = useVcsSnapshot(workspace?.id, shown);

  const chatFiles = useChatChanges(vcs.data?.kind === "none" ? workspace?.id : undefined, (edits) =>
    edits?.map((edit) => ({
      path:
        workspace === undefined
          ? edit.path
          : (workspaceFile(edit.path, [workspace.path])?.relative ?? edit.path),
      kind: edit.status,
    })),
  );

  const changes = vcs.data?.kind === "repository" ? worktreeFiles(vcs.data) : (chatFiles ?? []);
  const activeDocument = useDocument(activePath).data;

  const branch =
    vcs.data?.kind === "repository"
      ? (vcs.data.branch ?? vcs.data.head?.slice(0, 7) ?? "HEAD")
      : undefined;

  return { workspace, files, changes, branch, activeDocument };
}
