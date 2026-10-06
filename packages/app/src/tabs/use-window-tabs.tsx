/**
 * The desktop's window tabs meet the rest of the app here: the route mirrors
 * the active tab's focused place, the host's current folder follows the
 * focused chat, and the strip reads its items from the session directory.
 */
import { useRouter } from "@tanstack/react-router";
import { useMemo, useSyncExternalStore } from "react";
import type { SessionId, SessionInfo } from "@nyte-ai/protocol";
import { Icon } from "@nyte-ai/ui/icon";
import type { WorkspaceSessionDirectory } from "../bridge.ts";
import { activateWorkspace } from "../chrome/use-show-session.ts";
import { StatusDot } from "../components/ui.tsx";
import { userDisplayText } from "../conversation/transcript-presentation.ts";
import { keys, queryClient, useWorkspaceSessionDirectory } from "../queries.ts";
import { sessionActivityMark } from "../session-activity.ts";
import { sessionHasUnreadCompletion, useReadSessions } from "../session-read-state.ts";
import { useMountEffect } from "../use-mount-effect.ts";
import { useOptimisticSessionIds } from "../use-outbox.ts";
import { activeTab, currentView, isPage, tabPlace, tabPlaces } from "./model.ts";
import type { Place, WindowState } from "./model.ts";
import { locationPlace, navigateTo, pageSection, samePlaceAt } from "./places.ts";
import type { WindowTabItem } from "./window-tab-strip.tsx";
import { windowTabs } from "./window-tabs.ts";

export function useWindowTabsState(): WindowState {
  return useSyncExternalStore(windowTabs.subscribe, windowTabs.getSnapshot, windowTabs.getSnapshot);
}

function sessionFolder(sessionId: SessionId): string | null | undefined {
  const directory = queryClient
    .getQueryData<readonly WorkspaceSessionDirectory[]>(keys.sessionDirectory)
    ?.find((candidate) => candidate.sessions.some((session) => session.sessionId === sessionId));

  return directory?.environment === "local" ? directory.workspacePath : undefined;
}

/**
 * Keep the route on the active tab's focused place, record a page's section
 * as the route moves it, and make the focused chat's folder current.
 */
export function useWindowTabsSync(): void {
  const router = useRouter();

  useMountEffect(() => {
    if (!windowTabs.enabled) return undefined;
    let followed = "";
    // Switches run one at a time and only the latest, so a fast ⌃Tab ends on its last folder.
    let switching = Promise.resolve();
    let wanted: string | null = null;

    const sync = (): void => {
      const state = windowTabs.getSnapshot();
      const tab = activeTab(state);
      const place = tabPlace(tab);
      const location = locationPlace(router);

      if (location !== undefined && !samePlaceAt(place, location)) navigateTo(router, place);
      const focus = `${tab.id}:${place.kind === "session" ? place.sessionId : place.kind}`;

      if (focus === followed) return;
      followed = focus;

      if (place.kind !== "session") return;
      const folder = sessionFolder(place.sessionId);

      if (folder === undefined) return;
      wanted = folder;
      switching = switching
        .then(() => (wanted === folder ? activateWorkspace(folder) : undefined))
        .then(
          () => undefined,
          () => undefined,
        );
    };

    const unsubscribeRouter = router.subscribe("onResolved", () => {
      const location = locationPlace(router);

      if (location === undefined || !isPage(location)) return;
      const view = currentView(activeTab(windowTabs.getSnapshot()));

      // A page reached by URL alone, as Settings reaches Environments, becomes the tab's.
      if (view.kind !== "page" || view.page.kind !== location.kind)
        windowTabs.dispatch({ kind: "open", place: location, target: "here" });
      else if (pageSection(view.page) !== pageSection(location))
        windowTabs.dispatch({ kind: "page-section", section: pageSection(location) });
    });

    sync();
    const unsubscribeTabs = windowTabs.subscribe(sync);

    return () => {
      unsubscribeRouter();
      unsubscribeTabs();
    };
  });
}

function sessionTitle(session: SessionInfo | undefined): string {
  if (session === undefined) return "Chat";

  return (
    session.name ?? (session.preview === undefined ? "New chat" : userDisplayText(session.preview))
  );
}

function placeTitle(place: Place, sessions: ReadonlyMap<SessionId, SessionInfo>): string {
  switch (place.kind) {
    case "blank":
      return "New chat";
    case "session":
      return sessionTitle(sessions.get(place.sessionId));
    case "customize":
      return "Customize";
    case "environments":
      return "Environments";
    default: {
      const _exhaustive: never = place;

      return _exhaustive;
    }
  }
}

/** The strip's items: titles, status marks and unread dots from the session directory. */
export function useWindowTabItems(state: WindowState): readonly WindowTabItem[] {
  const directory = useWorkspaceSessionDirectory();
  const read = useReadSessions();
  const optimistic = useOptimisticSessionIds();

  const sessions = useMemo(
    () =>
      new Map(
        (directory.data ?? []).flatMap((entry) =>
          entry.sessions.map((session) => [session.sessionId, session] as const),
        ),
      ),
    [directory.data],
  );

  return state.tabs.map((tab) => {
    const places = tabPlaces(tab);
    const place = tabPlace(tab);
    const view = currentView(tab);
    const session = place.kind === "session" ? sessions.get(place.sessionId) : undefined;

    const mark =
      session === undefined
        ? "idle"
        : sessionActivityMark(session, optimistic.has(session.sessionId));

    const glyph =
      place.kind === "session" ? (
        mark === "idle" ? undefined : (
          <StatusDot mark={mark} />
        )
      ) : (
        <Icon
          name={
            place.kind === "blank"
              ? "new-chat"
              : place.kind === "customize"
                ? "customize"
                : "server"
          }
          size={13}
        />
      );

    return {
      id: tab.id,
      title: placeTitle(place, sessions),
      tooltip: places.map((candidate) => placeTitle(candidate, sessions)).join(" | "),
      glyph,
      unread:
        tab.id !== state.activeTabId &&
        places.some((candidate) => {
          if (candidate.kind !== "session") return false;
          const listed = sessions.get(candidate.sessionId);

          return listed !== undefined && sessionHasUnreadCompletion(listed, read);
        }),
      split:
        view.kind === "panes" && view.layout.kind === "split" ? view.layout.direction : undefined,
    };
  });
}
