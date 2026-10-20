import type { SessionId, SessionInfo } from "@nyte-ai/sdk";
import { sessionActivityMark } from "../session-activity.ts";
import { sessionHasUnreadCompletion } from "../session-read-state.ts";

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

export const SORTS = ["created", "updated", "status"] as const;

export const SHELVES = ["inbox", "working", "done", "archived"] as const;

export const SHOW_FIELDS = ["updated", "environment", "pr", "branch", "machine"] as const;

export const STATUSES = ["needs-attention", "unread", "working", "draft", "done"] as const;

export const PULL_REQUESTS = ["draft", "open", "merged", "closed", "none"] as const;

export const ENVIRONMENTS = ["cloud", "local"] as const;

type SessionGrouping = (typeof GROUPINGS)[number];

type SessionSort = (typeof SORTS)[number];

export type SessionShowField = (typeof SHOW_FIELDS)[number];

export type SessionStatus = (typeof STATUSES)[number];

export type SessionPullRequest = (typeof PULL_REQUESTS)[number];

export type SessionEnvironment = (typeof ENVIRONMENTS)[number];

export type SessionShelf = (typeof SHELVES)[number];

export interface SessionViewSettings {
  readonly grouping: SessionGrouping;
  readonly sort: SessionSort;
  readonly show: readonly SessionShowField[];
  readonly statuses: readonly SessionStatus[];
  readonly pullRequests: readonly SessionPullRequest[];
  readonly environments: readonly SessionEnvironment[];
  readonly archived: boolean;
}

export interface SessionViewGroup {
  readonly key: string;
  readonly label: string | undefined;
  readonly sessions: readonly SessionInfo[];
}

export const DEFAULT_SESSION_VIEW: SessionViewSettings = Object.freeze({
  grouping: "none",
  sort: "created",
  show: ["updated", "environment", "pr"] as const,
  statuses: [],
  pullRequests: [],
  environments: [],
  archived: false,
});

function deriveSessionStatus(
  session: SessionInfo,
  working: ReadonlySet<SessionId>,
): Exclude<SessionStatus, "draft"> {
  const mark = sessionActivityMark(session, working.has(session.id));

  switch (mark) {
    case "waiting":
    case "failed":
      return "needs-attention";
    case "retry":
    case "working":
      return "working";
    case "idle":
      return sessionHasUnreadCompletion(session) ? "unread" : "done";
    default: {
      const _exhaustive: never = mark;

      return _exhaustive;
    }
  }
}

export interface ShelfHold {
  readonly sessionId: SessionId;
  readonly shelf: SessionShelf;
}

export function deriveShelf(
  session: SessionInfo,
  working: ReadonlySet<SessionId>,
  hold: ShelfHold | undefined,
): SessionShelf {
  if (session.archived) return "archived";

  if (hold?.sessionId === session.id && hold.shelf !== "archived") return hold.shelf;

  if (session.pinned) return "inbox";

  const status = deriveSessionStatus(session, working);

  switch (status) {
    case "needs-attention":
    case "unread":
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

function compareCreated(left: SessionInfo, right: SessionInfo): number {
  return (
    Number(right.pinned) - Number(left.pinned) ||
    right.createdAt - left.createdAt ||
    left.id.localeCompare(right.id)
  );
}

function compareUpdated(left: SessionInfo, right: SessionInfo): number {
  return (
    Number(right.pinned) - Number(left.pinned) ||
    right.lastActivityAt - left.lastActivityAt ||
    left.id.localeCompare(right.id)
  );
}

function stageRank(session: SessionInfo, working: ReadonlySet<SessionId>): number {
  const mark = sessionActivityMark(session, working.has(session.id));

  switch (mark) {
    case "waiting":
    case "failed":
      return 0;
    case "retry":
    case "working":
      return 1;
    case "idle":
      return 2;
    default: {
      const _exhaustive: never = mark;

      return _exhaustive;
    }
  }
}

export function sessionOrder(
  sort: SessionSort,
  working: ReadonlySet<SessionId> = NO_WORKING_SESSIONS,
): (left: SessionInfo, right: SessionInfo) => number {
  switch (sort) {
    case "created":
      return compareCreated;
    case "updated":
      return compareUpdated;
    case "status":
      return (left, right) =>
        Number(right.pinned) - Number(left.pinned) ||
        stageRank(left, working) - stageRank(right, working) ||
        compareUpdated(left, right);
    default: {
      const _exhaustive: never = sort;

      return _exhaustive;
    }
  }
}

function groupSessions(
  sessions: readonly SessionInfo[],
  grouping: SessionGrouping,
  environment: SessionEnvironment,
  now: number,
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
        const members = sessions.filter(
          (session) => deriveSessionStatus(session, working) === status,
        );

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

export function sessionsForNavigation(
  sessions: readonly SessionInfo[],
  includeArchived = false,
): readonly SessionInfo[] {
  return sessions.filter(
    (session) => session.parent === null && (includeArchived || !session.archived),
  );
}

export function sessionsForView(
  sessions: readonly SessionInfo[],
  settings: SessionViewSettings,
  environment: SessionEnvironment = "local",
  now = Date.now(),
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
      settings.statuses.includes(deriveSessionStatus(session, working)),
  );

  const ordered = filtered.toSorted(sessionOrder(settings.sort, working));

  return groupSessions(ordered, settings.grouping, environment, now, working);
}

export function hasSessionFilters(settings: SessionViewSettings): boolean {
  return (
    settings.archived ||
    settings.statuses.length > 0 ||
    settings.pullRequests.length > 0 ||
    settings.environments.length > 0
  );
}

export function clearSessionFilters(settings: SessionViewSettings): SessionViewSettings {
  return {
    ...settings,
    statuses: [],
    pullRequests: [],
    environments: [],
    archived: false,
  };
}

export function amongOptions<T extends string>(value: unknown, options: readonly T[]): value is T {
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
