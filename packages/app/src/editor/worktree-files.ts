import type { FileStatus, GitStatus } from "@nyte-ai/sdk";

export interface WorktreeFile {
  readonly path: string;
  readonly kind: FileStatus;
  /** Where a renamed file came from. */
  readonly from?: string;
}

const WORKTREE_ORDER: readonly FileStatus[] = [
  "untracked",
  "conflicted",
  "deleted",
  "added",
  "renamed",
  "modified",
];

export function worktreeFiles(
  status: Extract<GitStatus, { readonly kind: "repository" }>,
): readonly WorktreeFile[] {
  const byPath = new Map<string, WorktreeFile>();

  const rows: readonly WorktreeFile[] = [
    ...status.staged.map((file) => ({ path: file.path, kind: file.status, from: file.from })),
    ...status.unstaged.map((file) => ({ path: file.path, kind: file.status, from: file.from })),
    ...status.untracked.map((path) => ({ path, kind: "untracked" as const })),
    ...status.conflicts.map((path) => ({ path, kind: "conflicted" as const })),
  ];

  for (const row of rows) {
    const current = byPath.get(row.path);

    if (
      current === undefined ||
      WORKTREE_ORDER.indexOf(row.kind) < WORKTREE_ORDER.indexOf(current.kind)
    ) {
      byPath.set(row.path, { ...row, from: row.from ?? current?.from });
    }
  }

  return [...byPath.values()].sort((left, right) => left.path.localeCompare(right.path));
}
