import type { WorkspaceId } from "@nyte-ai/sdk";
import { useSyncExternalStore } from "react";
import type { CommitBarResult } from "./changes-commit-bar.tsx";
import type { CommitAction } from "./changes-view-options.ts";

/** The push or pull request still owed after a commit landed, for the branch it landed on. */
export interface CommitRetry {
  readonly action: CommitAction;
  readonly message: string;
  readonly branch: string | null;
}

/** A Code window's commit in progress for one project. It outlives the Changes view, which unmounts when the sidebar hides. */
export interface CommitDraft {
  readonly message: string;
  readonly running: boolean;
  readonly result: CommitBarResult | undefined;
  readonly retry: CommitRetry | undefined;
}

const EMPTY: CommitDraft = { message: "", running: false, result: undefined, retry: undefined };

const drafts = new Map<WorkspaceId, CommitDraft>();
const listeners = new Set<() => void>();

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => listeners.delete(listener);
}

/** Updates the draft from its latest value, so a commit that finishes after the view unmounted still lands. */
export function updateCommitDraft(workspace: WorkspaceId, patch: Partial<CommitDraft>): void {
  drafts.set(workspace, { ...(drafts.get(workspace) ?? EMPTY), ...patch });

  for (const listener of listeners) listener();
}

export function useCommitDraft(workspace: WorkspaceId): CommitDraft {
  const read = (): CommitDraft => drafts.get(workspace) ?? EMPTY;

  return useSyncExternalStore(subscribe, read, read);
}
