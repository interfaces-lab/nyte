import type { SessionId, SessionInfo } from "@nyte-ai/protocol";
import { sessionActivityMark } from "../session-activity.ts";
import { EMPTY_READ_SESSIONS, sessionHasUnreadCompletion } from "../session-read-state.ts";
import type { ReadSessions } from "../session-read-state.ts";

const DAY_MS = 24 * 60 * 60 * 1_000;

const NO_WORKING_SESSIONS: ReadonlySet<SessionId> = new Set();

export const GROUPINGS = [
  "inbox",
  "none",
  "repository",
  "updated",
  "status",
  "environment",
] as const;

export const SHELVES = ["inbox", "working", "done", "archived"] as const;

export const SHOW_FIELDS = ["updated", "environment", "pr", "branch", "machine"] as const;

export const STATUSES = ["needs-attention", "unread", "working", "draft", "done"] as const;

export const PULL_REQUESTS = ["draft", "open", "merged", "closed", "none"] as const;

export const ENVIRONMENTS = ["cloud", "local"] as const;

type SessionGrouping = (typeof GROUPINGS)[number];

export type SessionShowField = (typeof SHOW_FIELDS)[number];

export type SessionStatus = (typeof STATUSES)[number];

export type SessionPullRequest = (typeof PULL_REQUESTS)[number];

export type SessionEnvironment = (typeof ENVIRONMENTS)[number];

export type SessionShelf = (typeof SHELVES)[number];

export interface SessionViewSettings {
  readonly grouping: SessionGrouping;
  readonly sortByStatus: boolean;
  readonly show: readonly SessionShowField[];
  readonly statuses: readonly SessionStatus[];
  readonly pullRequests: readonly SessionPullRequest[];
  readonly environments: readonly SessionEnvironment[];
  /** When unchecked, Archived hides archived sessions. */
  readonly archived: boolean;
}

export interface SessionViewGroup {
  readonly key: string;
  readonly label: string | undefined;
  readonly sessions: readonly SessionInfo[];
}

export const DEFAULT_SESSION_VIEW: SessionViewSettings = Object.freeze({
  // One flat list across every workspace, with what needs you on top and the
  // rest folded; folders and other groupings are opt-in from the filter menu.
  grouping: "inbox",
  sortByStatus: true,
  show: ["updated", "environment", "pr"] as const,
  statuses: [],
  pullRequests: [],
  environments: [],
  archived: false,
});

/** Untitled chats with no preview are drafts; a name or preview is a finished row. */
export function sessionIsDraft(session: SessionInfo): boolean {
  return session.name === undefined && session.preview === undefined;
}

export function statusOf(
  session: SessionInfo,
  read: ReadSessions,
  working: ReadonlySet<SessionId>,
): SessionStatus {
  const mark = sessionActivityMark(session, working.has(session.sessionId));

  switch (mark) {
    // `sessionMark` reports `waiting` only for a run parked on a reply; one
    // parked on background work arrives here as `working`.
    case "waiting":
    case "failed":
      return "needs-attention";
    case "retry":
    case "working":
      return "working";
    case "idle":
      if (sessionHasUnreadCompletion(session, read)) return "unread";

      if (sessionIsDraft(session)) return "draft";

      return "done";
    default: {
      const _exhaustive: never = mark;

      return _exhaustive;
    }
  }
}

/** The open chat and the shelf it was opened from, so reading or replying never moves its row. */
export interface ShelfHold {
  readonly sessionId: SessionId;
  readonly shelf: SessionShelf;
}

/** Archiving beats the hold, and so does restoring: the row leaves or returns at once. */
export function shelfOf(
  session: SessionInfo,
  read: ReadSessions,
  working: ReadonlySet<SessionId>,
  hold: ShelfHold | undefined,
): SessionShelf {
  if (session.archived) return "archived";

  if (hold?.sessionId === session.sessionId && hold.shelf !== "archived") return hold.shelf;

  if (session.pinned) return "inbox";

  const status = statusOf(session, read, working);

  switch (status) {
    case "needs-attention":
    case "unread":
    case "draft":
      return "inbox";
    case "working":
      return "working";
    case "done":
      return "done";
    default: {
      const _exhaustive: never = status;

      return _exhaustive;
    }
  }
}

function compareUpdated(left: SessionInfo, right: SessionInfo): number {
  return (
    Number(right.pinned) - Number(left.pinned) ||
    right.lastActivityAt - left.lastActivityAt ||
    left.sessionId.localeCompare(right.sessionId)
  );
}

/**
 * Needs a decision, then running, then finished and waiting on a look, then
 * drafts. Read state takes no part: opening a chat never moves it. A chat
 * leaves the ranking only when it is archived.
 */
function stageRank(session: SessionInfo, working: ReadonlySet<SessionId>): number {
  const mark = sessionActivityMark(session, working.has(session.sessionId));

  switch (mark) {
    case "waiting":
    case "failed":
      return 0;
    case "retry":
    case "working":
      return 1;
    case "idle":
      return sessionIsDraft(session) ? 3 : 2;
    default: {
      const _exhaustive: never = mark;

      return _exhaustive;
    }
  }
}

/** The row order a view settles on; the flat list merges workspaces with it. */
export function sessionOrder(
  sortByStatus: boolean,
  working: ReadonlySet<SessionId> = NO_WORKING_SESSIONS,
): (left: SessionInfo, right: SessionInfo) => number {
  if (!sortByStatus) return compareUpdated;

  return (left, right) =>
    Number(right.pinned) - Number(left.pinned) ||
    stageRank(left, working) - stageRank(right, working) ||
    compareUpdated(left, right);
}

function groupSessions(
  sessions: readonly SessionInfo[],
  grouping: SessionGrouping,
  environment: SessionEnvironment,
  now: number,
  read: ReadSessions,
  working: ReadonlySet<SessionId>,
): readonly SessionViewGroup[] {
  switch (grouping) {
    case "inbox":
    case "none":
    case "repository":
      return [{ key: grouping, label: undefined, sessions }];
    case "environment":
      return sessions.length === 0
        ? []
        : [{ key: environment, label: environment === "cloud" ? "Cloud" : "Local", sessions }];
    case "status": {
      const labels: Readonly<Record<SessionStatus, string>> = {
        "needs-attention": "Needs attention",
        unread: "Unread",
        working: "Working",
        draft: "Draft",
        done: "Done",
      };

      return STATUSES.flatMap((status) => {
        const members = sessions.filter((session) => statusOf(session, read, working) === status);

        return members.length === 0
          ? []
          : [{ key: status, label: labels[status], sessions: members }];
      });
    }

    case "updated": {
      const groups = [
        ["day", "Past day", (session: SessionInfo) => session.lastActivityAt >= now - DAY_MS],
        [
          "week",
          "Past week",
          (session: SessionInfo) =>
            session.lastActivityAt < now - DAY_MS && session.lastActivityAt >= now - 7 * DAY_MS,
        ],
        ["earlier", "Earlier", (session: SessionInfo) => session.lastActivityAt < now - 7 * DAY_MS],
      ] as const;

      return groups.flatMap(([key, label, predicate]) => {
        const members = sessions.filter(predicate);

        return members.length === 0 ? [] : [{ key, label, sessions: members }];
      });
    }

    default: {
      const _exhaustive: never = grouping;

      return _exhaustive;
    }
  }
}

/** Child sessions stay available to task/job inspection, but never become navigation rows. */
export function sessionsForNavigation(
  sessions: readonly SessionInfo[],
  includeArchived = false,
): readonly SessionInfo[] {
  return sessions.filter(
    (session) => session.parent === undefined && (includeArchived || !session.archived),
  );
}

/** Dimensions are ANDed; checked values within one dimension are ORed. */
export function sessionsForView(
  sessions: readonly SessionInfo[],
  settings: SessionViewSettings,
  environment: SessionEnvironment = "local",
  now = Date.now(),
  read: ReadSessions = EMPTY_READ_SESSIONS,
  working: ReadonlySet<SessionId> = NO_WORKING_SESSIONS,
): readonly SessionViewGroup[] {
  if (
    (settings.pullRequests.length > 0 && !settings.pullRequests.includes("none")) ||
    (settings.environments.length > 0 && !settings.environments.includes(environment))
  )
    return [];

  const filtered = sessionsForNavigation(sessions, settings.archived).filter(
    (session) =>
      settings.statuses.length === 0 ||
      settings.statuses.includes(statusOf(session, read, working)),
  );

  const ordered = filtered.toSorted(sessionOrder(settings.sortByStatus, working));

  return groupSessions(ordered, settings.grouping, environment, now, read, working);
}

export function hasSessionFilters(settings: SessionViewSettings): boolean {
  return (
    settings.archived ||
    settings.statuses.length > 0 ||
    settings.pullRequests.length > 0 ||
    settings.environments.length > 0
  );
}

/** Every filter dimension back to "show everything", grouping and ordering kept. */
export function clearSessionFilters(settings: SessionViewSettings): SessionViewSettings {
  return {
    ...settings,
    statuses: [],
    pullRequests: [],
    environments: [],
    archived: false,
  };
}

export function isOption<T extends string>(value: unknown, options: readonly T[]): value is T {
  return options.some((option) => option === value);
}

export function toggleOption<T extends string>(
  all: readonly T[],
  selected: readonly T[],
  option: T,
  checked: boolean,
): readonly T[] {
  return all.filter((candidate) => (candidate === option ? checked : selected.includes(candidate)));
}
