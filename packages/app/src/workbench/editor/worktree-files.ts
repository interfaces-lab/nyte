import type { FileStatus, GitStatus } from "@nyte-ai/sdk";

export interface WorktreeFile {
  readonly path: string;
  readonly kind: FileStatus;
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
  const byPath = new Map<string, FileStatus>();

  const rows = [
    ...status.staged.map((file) => ({ path: file.path, kind: file.status })),
    ...status.unstaged.map((file) => ({ path: file.path, kind: file.status })),
    ...status.untracked.map((path) => ({ path, kind: "untracked" as const })),
    ...status.conflicts.map((path) => ({ path, kind: "conflicted" as const })),
  ];

  for (const row of rows) {
    const current = byPath.get(row.path);

    if (
      current === undefined ||
      WORKTREE_ORDER.findIndex((kind) => kind === row.kind) <
        WORKTREE_ORDER.findIndex((kind) => kind === current)
    )
      byPath.set(row.path, row.kind);
  }

  return [...byPath]
    .map(([path, kind]) => ({ path, kind }))
    .sort((left, right) => left.path.localeCompare(right.path));
}
