import { isPart, tool } from "@nyte-ai/plugin/client";
import type {
  Execution,
  FileStatus,
  GitStatus,
  HeadInfo,
  Message,
  SessionInfo,
  SessionView,
  ToolPartState,
  TurnInfo,
  UserContent,
  WorkspaceInfo,
} from "@nyte-ai/sdk";

export type UserMessage = Extract<Message, { readonly kind: "user" }>;

export type PartMessage = Extract<Message, { readonly kind: "part" }>;

export type ToolMessage = PartMessage & { readonly state: ToolPartState };

export interface ConversationTurn {
  readonly info: TurnInfo;
  readonly messages: readonly Message[];
}

export function isToolMessage(message: Message): message is ToolMessage {
  return isPart(message, tool);
}

export function conversationTurns(view: SessionView): {
  readonly turns: readonly ConversationTurn[];
  readonly loose: readonly Message[];
} {
  const byTurn = new Map<string, Message[]>();

  for (const message of view.messages) {
    const bucket = byTurn.get(message.turn) ?? [];
    bucket.push(message);
    byTurn.set(message.turn, bucket);
  }

  const turns = view.turns.map((info) => {
    const messages = byTurn.get(info.id) ?? [];
    byTurn.delete(info.id);

    return { info, messages };
  });

  return { turns, loose: [...byTurn.values()].flat() };
}

export type ToolTense = "running" | "past" | "none";

export type ToolTone = "running" | "attention" | "success" | "failure" | "stopped";

export type ToolWord = "Needs input" | "Failed" | "Blocked" | "Stopped" | "Interrupted";

export interface ToolStatus {
  readonly tense: ToolTense;
  readonly tone: ToolTone;
  readonly word: ToolWord | undefined;
}

const RUNNING: ToolStatus = { tense: "running", tone: "running", word: undefined };

export function toolStatus(message: Pick<ToolMessage, "state" | "status">): ToolStatus {
  const { state, status } = message;

  if (state.phase !== "settled") {
    if (status.kind === "failed") return { tense: "none", tone: "stopped", word: "Stopped" };

    if (status.kind === "waiting" && status.on.kind === "part")
      return { tense: "running", tone: "attention", word: "Needs input" };

    return RUNNING;
  }

  switch (state.outcome.kind) {
    case "ok":
      return { tense: "past", tone: "success", word: undefined };
    case "failed":
      return { tense: "none", tone: "failure", word: "Failed" };
    case "rejected":
      return { tense: "none", tone: "failure", word: "Blocked" };
    case "stopped":
      return { tense: "none", tone: "stopped", word: "Stopped" };
    case "interrupted":
      return { tense: "none", tone: "stopped", word: "Interrupted" };
    default: {
      const exhaustive: never = state.outcome;

      return exhaustive;
    }
  }
}

export function toolOutput(state: ToolPartState): string {
  if (state.phase !== "settled") return "";

  switch (state.outcome.kind) {
    case "ok":
      return state.outcome.content
        .map((content) => (content.kind === "text" ? content.text : ""))
        .filter((text) => text !== "")
        .join("\n");
    case "failed":
      return state.outcome.message;
    case "rejected":
      return state.outcome.reason;
    case "stopped":
    case "interrupted":
      return "";
    default: {
      const exhaustive: never = state.outcome;

      return exhaustive;
    }
  }
}

export function formatToolDuration(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;

  if (seconds < 10) return `${seconds.toFixed(1)}s`;

  if (seconds < 60) return `${String(Math.floor(seconds))}s`;
  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) return `${String(minutes)}m ${String(Math.floor(seconds % 60))}s`;

  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
}

export type SessionMark = "waiting" | "retry" | "working" | "failed" | "idle";

export function executionMark(execution: Execution): SessionMark {
  switch (execution.kind) {
    case "idle":
      return execution.lastRun?.end.kind === "failed" ? "failed" : "idle";
    case "live":
      return "working";
    case "waiting":
      return execution.on.kind === "part" ? "waiting" : "working";
    case "retrying":
      return "retry";
    default: {
      const exhaustive: never = execution;

      return exhaustive;
    }
  }
}

export function sessionMark(session: Pick<SessionInfo, "heads">): SessionMark {
  const head: HeadInfo | undefined = session.heads[0];

  return head === undefined ? "idle" : executionMark(head.execution);
}

export function isBusy(execution: Execution): boolean {
  return execution.kind !== "idle";
}

export function sessionTitle(session: Pick<SessionInfo, "name">, fallback = "New chat"): string {
  return session.name ?? fallback;
}

export function userContentText(content: UserContent): string {
  if (typeof content === "string") return content;

  return content
    .map((item) => {
      switch (item.kind) {
        case "text":
          return item.text;
        case "reference":
          return `@${item.path}`;
        case "file":
          return "";
        default: {
          const exhaustive: never = item;

          return exhaustive;
        }
      }
    })
    .filter((text) => text !== "")
    .join("\n");
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

export interface CompletionTrigger {
  readonly kind: "@" | "/";
  readonly start: number;
  readonly end: number;
  readonly query: string;
}

export function completionTrigger(
  value: string,
  cursor = value.length,
): CompletionTrigger | undefined {
  const caret = Math.max(0, Math.min(cursor, value.length));
  let start = caret;

  while (start > 0 && (value[start - 1] ?? "").trim() !== "") start -= 1;
  const kind = value[start];

  if (start === caret || (kind !== "@" && kind !== "/")) return undefined;
  let end = caret;

  while (end < value.length && (value[end] ?? "").trim() !== "") end += 1;

  return { kind, start, end, query: value.slice(start + 1, caret) };
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

    if (current === undefined || WORKTREE_ORDER.indexOf(row.kind) < WORKTREE_ORDER.indexOf(current))
      byPath.set(row.path, row.kind);
  }

  return [...byPath]
    .map(([path, kind]) => ({ path, kind }))
    .sort((left, right) => left.path.localeCompare(right.path));
}
