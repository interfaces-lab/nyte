/**
 * Shelves for the flat chat list, drafted for `packages/app/src/chrome/sidebar-view.ts`.
 *
 * Inbox holds what needs you: a question or a failure, a finished run nobody
 * has opened, a pinned chat, and drafts. Working and Done fold below it;
 * Archived shows only while the Archived filter is on. The open chat keeps the
 * shelf it was opened from until you leave it, so reading it or sending in it
 * never moves the row you are looking at.
 */
import type { SessionId, SessionInfo } from "@nyte-ai/protocol";
import {
  sessionIsDraft,
  sessionOrder,
  sessionsForNavigation,
  type SessionStatus,
} from "@nyte-ai/app/chrome/sidebar-view.ts";
import { sessionActivityMark } from "@nyte-ai/app/session-activity.ts";
import { sessionHasUnreadCompletion, type ReadSessions } from "@nyte-ai/app/session-read-state.ts";

/** What Inbox Only keeps, and what the Inbox shelf holds. */
export const INBOX_STATUSES = [
  "needs-attention",
  "unread",
  "draft",
] as const satisfies readonly SessionStatus[];

export type ShelfName = "inbox" | "working" | "done" | "archived";

const STATUS_SHELF = {
  "needs-attention": "inbox",
  unread: "inbox",
  draft: "inbox",
  working: "working",
  done: "done",
} as const satisfies Readonly<Record<SessionStatus, ShelfName>>;

/** `statusOf` in sidebar-view.ts keeps this private; export that one when the draft moves. */
export function sessionStatus(session: SessionInfo, read: ReadSessions): SessionStatus {
  const mark = sessionActivityMark(session, false);

  switch (mark) {
    case "waiting":
    case "failed":
      return "needs-attention";
    case "retry":
    case "working":
      return "working";
    case "idle":
      if (sessionHasUnreadCompletion(session, read)) return "unread";

      return sessionIsDraft(session) ? "draft" : "done";
    default: {
      const _exhaustive: never = mark;

      return _exhaustive;
    }
  }
}

/** The open chat and the shelf it was opened from. */
export interface Hold {
  readonly sessionId: SessionId;
  readonly shelf: ShelfName;
}

/** Archiving beats the hold: the row leaves even while it is open. */
export function shelfOf(
  session: SessionInfo,
  read: ReadSessions,
  hold: Hold | undefined,
): ShelfName {
  if (session.archived) return "archived";

  if (hold?.sessionId === session.sessionId) return hold.shelf;

  if (session.pinned) return "inbox";

  return STATUS_SHELF[sessionStatus(session, read)];
}

export interface RailView {
  readonly grouping: "inbox" | "none";
  readonly statuses: readonly SessionStatus[];
  readonly archived: boolean;
}

export type Shelves = Readonly<Record<ShelfName, readonly SessionInfo[]>>;

export type RailRows =
  | { readonly kind: "list"; readonly sessions: readonly SessionInfo[] }
  | { readonly kind: "shelves"; readonly shelves: Shelves };

/** `sessionsForView` plus the hold and the Inbox grouping. The open chat passes every status filter. */
export function railRows(
  sessions: readonly SessionInfo[],
  view: RailView,
  read: ReadSessions,
  hold: Hold | undefined,
): RailRows {
  const listed = sessionsForNavigation(sessions, view.archived)
    .filter(
      (session) =>
        view.statuses.length === 0 ||
        session.sessionId === hold?.sessionId ||
        view.statuses.includes(sessionStatus(session, read)),
    )
    .toSorted(sessionOrder(true));

  if (view.grouping === "none") return { kind: "list", sessions: listed };

  const on = (shelf: ShelfName): readonly SessionInfo[] =>
    listed.filter((session) => shelfOf(session, read, hold) === shelf);

  return {
    kind: "shelves",
    shelves: {
      inbox: on("inbox"),
      working: on("working"),
      done: on("done"),
      archived: on("archived"),
    },
  };
}

export function isInboxOnly(statuses: readonly SessionStatus[]): boolean {
  return (
    statuses.length === INBOX_STATUSES.length &&
    INBOX_STATUSES.every((status) => statuses.includes(status))
  );
}
