import type { TaskState } from "@nyte-ai/plugin/client/presentation";
import type { SessionId, SessionInfo } from "@nyte-ai/sdk";
import type { ChatDirectory } from "../chats/index.ts";
import {
  STATUSES,
  type SessionEnvironment,
  type SessionGrouping,
  type SessionShelf,
  type SessionSort,
  type SessionStatus,
  type SessionViewSettings,
} from "../preferences/session-view.ts";

const DAY_MS = 24 * 60 * 60 * 1_000;

const NO_CHATS: ChatDirectory = new Map();

const NONE_UNREAD: ReadonlySet<SessionId> = new Set();

export interface SessionViewGroup {
  readonly key: string;
  readonly label: string | undefined;
  readonly sessions: readonly SessionInfo[];
}

/** Days back through which each Updated bucket reaches, counted in local calendar days. */
const UPDATED_BUCKETS = [
  ["today", "Today", 0],
  ["yesterday", "Yesterday", 1],
  ["week", "Last 7 Days", 6],
  ["month", "Last 30 Days", 29],
  ["older", "Older", Infinity],
] as const;

export const COLLAPSED_SESSION_LIMIT = 5;

const SESSION_PAGE_SIZE = 8;

/** The state a listed chat draws; a chat the directory doesn't have yet is done. */
export function chatMark(session: SessionInfo, chats: ChatDirectory): TaskState {
  return chats.get(session.id)?.mark ?? "done";
}

/** A chat's status in the sidebar; `unread` is the window's answer, which leaves out chats the user is looking at. */
function deriveSessionStatus(
  session: SessionInfo,
  chats: ChatDirectory,
  unread: ReadonlySet<SessionId>,
): Exclude<SessionStatus, "draft"> {
  const mark = chatMark(session, chats);

  switch (mark) {
    case "waiting":
    case "failed":
      return "needs-attention";
    case "retrying":
    case "working":
      return "working";
    case "background":
    case "done":
      return unread.has(session.id) ? "unread" : "done";
    default: {
      const _exhaustive: never = mark;

      return _exhaustive;
    }
  }
}

/** Whether the chat's own run is going, or it or work it started waits on the user. */
export function sessionIsRunning(session: SessionInfo, chats: ChatDirectory): boolean {
  const mark = chatMark(session, chats);

  return mark === "working" || mark === "retrying" || mark === "waiting";
}

export interface ShelfHold {
  readonly sessionId: SessionId;
  readonly shelf: SessionShelf;
}

export function deriveShelf(
  session: SessionInfo,
  chats: ChatDirectory,
  unread: ReadonlySet<SessionId>,
  hold: ShelfHold | undefined,
): SessionShelf {
  if (session.archived) return "archived";

  if (hold?.sessionId === session.id && hold.shelf !== "archived") return hold.shelf;

  if (session.pinned) return "inbox";

  const status = deriveSessionStatus(session, chats, unread);

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

function stageRank(session: SessionInfo, chats: ChatDirectory): number {
  const mark = chatMark(session, chats);

  switch (mark) {
    case "waiting":
    case "failed":
      return 0;
    case "retrying":
    case "working":
      return 1;
    case "background":
    case "done":
      return 2;
    default: {
      const _exhaustive: never = mark;

      return _exhaustive;
    }
  }
}

export function sessionOrder(
  sort: SessionSort,
  chats: ChatDirectory = NO_CHATS,
): (left: SessionInfo, right: SessionInfo) => number {
  switch (sort) {
    case "created":
      return compareCreated;
    case "updated":
      return compareUpdated;
    case "status":
      return (left, right) =>
        Number(right.pinned) - Number(left.pinned) ||
        stageRank(left, chats) - stageRank(right, chats) ||
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
  chats: ChatDirectory,
  unread: ReadonlySet<SessionId>,
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
          (session) => deriveSessionStatus(session, chats, unread) === status,
        );

        return members.length === 0
          ? []
          : [{ key: status, label: labels[status], sessions: members }];
      });
    }

    case "updated": {
      const today = startOfDay(now);

      const bucket = (session: SessionInfo) => {
        const days = Math.round((today - startOfDay(session.lastActivityAt)) / DAY_MS);

        return UPDATED_BUCKETS.find(([, , through]) => days <= through)?.[0];
      };

      return UPDATED_BUCKETS.flatMap(([key, label]) => {
        const members = sessions.filter((session) => bucket(session) === key);

        return members.length === 0 ? [] : [{ key, label, sessions: members }];
      });
    }

    default: {
      const _exhaustive: never = grouping;

      return _exhaustive;
    }
  }
}

function startOfDay(time: number): number {
  return new Date(time).setHours(0, 0, 0, 0);
}

export function sessionsForNavigation(sessions: readonly SessionInfo[]): readonly SessionInfo[] {
  return sessions.filter((session) => session.parent === null && !session.archived);
}

export function sessionsForView(
  sessions: readonly SessionInfo[],
  settings: SessionViewSettings,
  environment: SessionEnvironment,
  now: number,
  chats: ChatDirectory = NO_CHATS,
  unread: ReadonlySet<SessionId> = NONE_UNREAD,
): readonly SessionViewGroup[] {
  if (settings.environments.length > 0 && !settings.environments.includes(environment)) return [];

  const filtered = sessions.filter(
    (session) =>
      session.parent === null &&
      session.archived === settings.archived &&
      (settings.statuses.length === 0 ||
        settings.statuses.includes(deriveSessionStatus(session, chats, unread))),
  );

  const ordered = filtered.toSorted(sessionOrder(settings.sort, chats));

  return groupSessions(ordered, settings.grouping, environment, now, chats, unread);
}

/** A workspace's chats in a grouped view: pinned chats leave it for the Pinned section above. */
export function folderView(
  sessions: readonly SessionInfo[],
  settings: SessionViewSettings,
  now: number,
  chats: ChatDirectory,
  unread: ReadonlySet<SessionId>,
): readonly SessionViewGroup[] {
  return sessionsForView(
    sessions.filter((session) => !session.pinned),
    settings,
    "local",
    now,
    chats,
    unread,
  );
}

export interface SessionPage {
  readonly visible: number;
  readonly next: number;
  /** What the list's revealed count becomes when "Show More" is pressed. */
  readonly revealed: number;
}

/**
 * Pages a list of `total` rows that shows `base` of them before anything is revealed. `selected`
 * is the open chat's index or -1; an open chat past the fold raises the page to include it. A
 * single leftover row is shown rather than hidden behind "Show 1 More".
 */
export function sessionPage(
  total: number,
  base: number,
  revealed: number,
  selected: number,
): SessionPage {
  const fit = (count: number): number => (total - count <= 1 ? total : count);
  const shown = Math.max(base + revealed, selected + 1);
  const visible = fit(shown);

  return {
    visible,
    next: fit(shown + SESSION_PAGE_SIZE) - visible,
    revealed: shown + SESSION_PAGE_SIZE - base,
  };
}

export function hasSessionFilters(settings: SessionViewSettings): boolean {
  return settings.archived || settings.statuses.length > 0 || settings.environments.length > 0;
}

export function clearSessionFilters(settings: SessionViewSettings): SessionViewSettings {
  return {
    ...settings,
    statuses: [],
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
