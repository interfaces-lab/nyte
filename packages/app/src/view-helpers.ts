import type {
  FileStatus,
  GitStatus,
  Message,
  SessionView,
  TurnInfo,
  WorkspaceInfo,
} from "@nyte-ai/sdk";

export interface ConversationTurn {
  readonly info: TurnInfo;
  readonly messages: readonly Message[];
}

interface ConversationTurns {
  readonly turns: readonly ConversationTurn[];
  readonly loose: readonly Message[];
}

const NO_MESSAGES: readonly Message[] = [];

const groupedViews = new WeakMap<SessionView, ConversationTurns>();

const groupedTurns = new WeakMap<TurnInfo, ConversationTurn>();

const groupedLists = new WeakMap<readonly TurnInfo[], readonly ConversationTurn[]>();

/** True when both lists hold the same items in the same order. */
export function sameItems<T>(left: readonly T[], right: readonly T[]): boolean {
  return left.length === right.length && left.every((item, index) => item === right[index]);
}

/**
 * The view's messages grouped under their turns. A turn whose info and
 * messages are the ones the last grouping saw comes back as the same object,
 * so a streamed frame changes only the turn it streams into.
 */
export function conversationTurns(view: SessionView): ConversationTurns {
  const known = groupedViews.get(view);

  if (known !== undefined) return known;
  const byTurn = new Map<string, Message[]>();

  for (const message of view.messages) {
    const bucket = byTurn.get(message.turn) ?? [];
    bucket.push(message);
    byTurn.set(message.turn, bucket);
  }

  const turns = view.turns.map((info) => {
    const messages = byTurn.get(info.id) ?? NO_MESSAGES;
    byTurn.delete(info.id);
    const previous = groupedTurns.get(info);

    if (previous !== undefined && sameItems(previous.messages, messages)) return previous;
    const turn = { info, messages };
    groupedTurns.set(info, turn);

    return turn;
  });

  const previous = groupedLists.get(view.turns);
  const shared = previous !== undefined && sameItems(previous, turns) ? previous : turns;
  groupedLists.set(view.turns, shared);
  const grouped = { turns: shared, loose: [...byTurn.values()].flat() };
  groupedViews.set(view, grouped);

  return grouped;
}

export function formatToolDuration(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;

  if (seconds < 10) return `${seconds.toFixed(1)}s`;

  if (seconds < 60) return `${String(Math.floor(seconds))}s`;
  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) return `${String(minutes)}m ${String(Math.floor(seconds % 60))}s`;

  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
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
