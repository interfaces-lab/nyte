import type { SessionInfo } from "@nyte-ai/core";

const DAY_MS = 24 * 60 * 60 * 1_000;

export const GROUPINGS = ["repository", "workspace", "updated", "status", "environment"] as const;
export const ORDERINGS = ["updated", "status"] as const;
export const SHOW_FIELDS = ["updated", "environment", "pr", "branch", "machine"] as const;
export const STATUSES = ["needs-attention", "unread", "working", "draft", "done"] as const;
export const PULL_REQUESTS = ["draft", "open", "merged", "closed", "none"] as const;
export const ENVIRONMENTS = ["cloud", "local"] as const;
export const SOURCES = [
  "desktop",
  "mobile",
  "web",
  "cli",
  "setup",
  "slack",
  "linear",
  "source-control",
  "grok-bot",
  "sdk",
  "api",
  "automations",
  "bugbot",
  "frontend-qa",
] as const;

export type SessionGrouping = (typeof GROUPINGS)[number];
export type SessionOrdering = (typeof ORDERINGS)[number];
export type SessionShowField = (typeof SHOW_FIELDS)[number];
export type SessionStatus = (typeof STATUSES)[number];
export type SessionPullRequest = (typeof PULL_REQUESTS)[number];
export type SessionEnvironment = (typeof ENVIRONMENTS)[number];
export type SessionSource = (typeof SOURCES)[number];

export const DEFAULT_SOURCES: readonly SessionSource[] = [
  "desktop",
  "mobile",
  "web",
  "cli",
  "setup",
  "slack",
  "linear",
  "source-control",
];

export interface SessionViewSettings {
  readonly grouping: SessionGrouping;
  readonly ordering: SessionOrdering;
  readonly show: readonly SessionShowField[];
  readonly statuses: readonly SessionStatus[];
  readonly pullRequests: readonly SessionPullRequest[];
  readonly environments: readonly SessionEnvironment[];
  readonly sources: readonly SessionSource[];
  /** When unchecked, Archived hides archived sessions. */
  readonly archived: boolean;
}

export interface SessionViewGroup {
  readonly key: string;
  readonly label: string | undefined;
  readonly sessions: readonly SessionInfo[];
}

export const DEFAULT_SESSION_VIEW: SessionViewSettings = Object.freeze({
  // One flat list by default; groupings are opt-in from the filter menu.
  grouping: "workspace",
  ordering: "updated",
  show: ["updated", "environment", "pr"] as const,
  statuses: STATUSES,
  pullRequests: PULL_REQUESTS,
  environments: ENVIRONMENTS,
  sources: DEFAULT_SOURCES,
  archived: false,
});

export type SessionMark = "waiting" | "retry" | "working" | "failed" | "idle";

/**
 * The sidebar mark summarizes busy, retry, permission, and idle states. One
 * glyph carries that whole set; the filter labels stay coarser.
 */
/** Untitled chats with no preview are drafts; a name or preview is a finished row. */
export function sessionIsDraft(session: SessionInfo): boolean {
  return session.name === undefined && session.preview === undefined;
}

export function sessionMark(session: SessionInfo): SessionMark {
  let failed = false;
  for (const head of session.heads) {
    const kind = head.run?.phase.kind;
    if (kind === undefined) continue;
    if (kind === "waiting") return "waiting";
    if (kind === "retry") return "retry";
    if (kind === "respond" || kind === "tools") return "working";
    if (kind === "failed") failed = true;
  }
  return failed ? "failed" : "idle";
}

function statusOf(session: SessionInfo): SessionStatus {
  const mark = sessionMark(session);
  switch (mark) {
    case "waiting":
      return "needs-attention";
    case "retry":
    case "working":
      return "working";
    case "failed":
    case "idle":
      if (sessionIsDraft(session)) return "draft";
      return "done";
    default: {
      const _exhaustive: never = mark;
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

const STATUS_ORDER: Readonly<Record<SessionStatus, number>> = {
  "needs-attention": 0,
  unread: 1,
  working: 2,
  draft: 3,
  done: 4,
};

function compareStatus(left: SessionInfo, right: SessionInfo): number {
  return (
    Number(right.pinned) - Number(left.pinned) ||
    STATUS_ORDER[statusOf(left)] - STATUS_ORDER[statusOf(right)] ||
    compareUpdated(left, right)
  );
}

function groupSessions(
  sessions: readonly SessionInfo[],
  grouping: SessionGrouping,
  environment: SessionEnvironment,
  now: number,
): readonly SessionViewGroup[] {
  switch (grouping) {
    case "repository":
    case "workspace":
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
        const members = sessions.filter((session) => statusOf(session) === status);
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
): readonly SessionViewGroup[] {
  const filtered = sessionsForNavigation(sessions, settings.archived).filter(
    (session) =>
      settings.statuses.includes(statusOf(session)) &&
      settings.pullRequests.includes("none") &&
      settings.environments.includes(environment) &&
      settings.sources.includes("desktop"),
  );
  const ordered = filtered.toSorted(
    settings.ordering === "updated" ? compareUpdated : compareStatus,
  );
  return groupSessions(ordered, settings.grouping, environment, now);
}

function sameSelection<T extends string>(selected: readonly T[], all: readonly T[]): boolean {
  return selected.length === all.length && all.every((option) => selected.includes(option));
}

export function hasSessionFilters(settings: SessionViewSettings): boolean {
  return (
    settings.archived ||
    !sameSelection(settings.statuses, STATUSES) ||
    !sameSelection(settings.pullRequests, PULL_REQUESTS) ||
    !sameSelection(settings.environments, ENVIRONMENTS) ||
    !sameSelection(settings.sources, DEFAULT_SOURCES)
  );
}

/** Every filter dimension back to "show everything", grouping and ordering kept. */
export function clearSessionFilters(settings: SessionViewSettings): SessionViewSettings {
  return {
    ...settings,
    statuses: STATUSES,
    pullRequests: PULL_REQUESTS,
    environments: ENVIRONMENTS,
    sources: DEFAULT_SOURCES,
    archived: false,
  };
}

export function needsCompleteSessionDirectory(settings: SessionViewSettings): boolean {
  return (
    hasSessionFilters(settings) ||
    settings.grouping !== DEFAULT_SESSION_VIEW.grouping ||
    settings.ordering !== DEFAULT_SESSION_VIEW.ordering
  );
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
  const next = new Set(selected);
  if (checked) next.add(option);
  else next.delete(option);
  return all.filter((candidate) => next.has(candidate));
}
