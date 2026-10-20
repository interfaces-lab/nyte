import type {
  FileStatus,
  GitStatus,
  Message,
  SessionView,
  TurnInfo,
  WorkspaceInfo,
} from "@nyte-ai/sdk";

export interface TurnMessages {
  readonly info: TurnInfo;
  readonly messages: readonly Message[];
  /** Whether messages between the turn's prompt and its first message here are not loaded yet. */
  readonly clipped: boolean;
}

/** Each of `view`'s turns with its messages; the turn `leadingPrompt` leads starts with it and is clipped. */
export function conversationTurns(view: SessionView): readonly TurnMessages[] {
  const byTurn = new Map<string, Message[]>();
  const lead = view.leadingPrompt;

  if (lead !== null) byTurn.set(lead.turn, [lead]);

  for (const message of view.messages) {
    const bucket = byTurn.get(message.turn) ?? [];
    bucket.push(message);
    byTurn.set(message.turn, bucket);
  }

  return view.turns.map((info) => ({
    info,
    messages: byTurn.get(info.id) ?? [],
    clipped: info.id === lead?.turn,
  }));
}

export function workspacePath(workspace: Pick<WorkspaceInfo, "target">): string | null {
  const { target } = workspace;

  return target.kind === "local" && "path" in target ? target.path : null;
}

export function workspaceName(workspace: Pick<WorkspaceInfo, "target">): string {
  const path = workspacePath(workspace);

  return path === null
    ? workspace.target.kind
    : (path.split(/[\\/]/u).filter(Boolean).at(-1) ?? path);
}

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
