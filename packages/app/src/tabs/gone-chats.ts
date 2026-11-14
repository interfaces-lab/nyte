import type { SessionId, SessionInfo } from "@nyte-ai/sdk";
import type { SessionRows } from "../data/session-rows.ts";
import { tabPlaces } from "./model.ts";
import type { WindowState } from "./model.ts";

export interface GoneChats {
  readonly close: ReadonlySet<SessionId>;
  readonly forget: ReadonlySet<SessionId>;
}

/**
 * Every chat a tab shows, closed-tab history could reopen, or a pane hidden for it waits on, so a
 * delete made here closes that pane when it commits as one made elsewhere does.
 */
export function watchedChats(state: WindowState): ReadonlySet<SessionId> {
  return new Set([
    ...[...state.tabs, ...state.closed.map((closed) => closed.tab)].flatMap((tab) =>
      tabPlaces(tab).flatMap((place) => (place.kind === "session" ? [place.sessionId] : [])),
    ),
    ...state.hidden.map((entry) => entry.sessionId),
  ]);
}

/**
 * Chats to close in the open tabs and to forget from closed-tab history. A missing chat goes from
 * both. An archived chat leaves history, but closes only when `previous` saw it unarchived, so a
 * chat opened while archived stays open.
 */
export function goneChats(
  previous: ReadonlyMap<SessionId, SessionInfo>,
  now: Pick<SessionRows, "hosted" | "missing">,
): GoneChats {
  const archived = [...now.hosted.values()].flatMap((session) =>
    session.archived ? [session.id] : [],
  );

  const archiving = archived.filter((id) => previous.get(id)?.archived === false);

  return {
    close: new Set([...now.missing, ...archiving]),
    forget: new Set([...now.missing, ...archived]),
  };
}
