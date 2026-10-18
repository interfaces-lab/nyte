import { useRouter } from "@tanstack/react-router";
import { useMemo, useSyncExternalStore } from "react";
import type { SessionId, SessionInfo } from "@nyte-ai/sdk";
import { Icon } from "@nyte-ai/ui/icon";
import { activateWorkspace } from "../chrome/use-show-session.ts";
import { StatusDot } from "../components/ui.tsx";
import { nyte } from "../nyte.ts";
import {
  keys,
  queryClient,
  sessionFolderPath,
  useWorkingSessionIds,
  useWorkspaceSessionDirectory,
} from "../queries.ts";
import { directoryWatch } from "../sdk.tsx";
import { sessionActivityMark } from "../session-activity.ts";
import { sessionHasUnreadCompletion } from "../session-read-state.ts";
import { useMountEffect } from "../use-mount-effect.ts";

import { activeTab, currentView, showsPage, tabPlace, tabPlaces } from "./model.ts";
import type { Place, WindowState } from "./model.ts";
import { locationPlace, navigateTo, pageSection, samePlaceAt } from "./places.ts";
import type { WindowTabItem } from "./window-tab-strip.tsx";
import { windowTabs } from "./window-tabs.ts";

export function useWindowTabsState(): WindowState {
  return useSyncExternalStore(windowTabs.subscribe, windowTabs.getSnapshot, windowTabs.getSnapshot);
}

async function restoreChatFolder(): Promise<void> {
  const place = tabPlace(activeTab(windowTabs.getSnapshot()));

  if (place.kind !== "session" || nyte.host.restore === undefined) return;
  queryClient.setQueryData(keys.host, await nyte.host.restore({ session: place.sessionId }));
}

export function useWindowTabsSync(): void {
  const router = useRouter();

  useMountEffect(() => {
    let followed = "";
    let switching = restoreChatFolder().then(
      () => undefined,
      () => undefined,
    );
    let wanted: string | null = null;

    const follow = (): void => {
      const tab = activeTab(windowTabs.getSnapshot());
      const place = tabPlace(tab);
      const location = locationPlace(router);

      if (location !== undefined && !samePlaceAt(place, location)) navigateTo(router, place);
      const focus = `${tab.id}:${place.kind === "session" ? place.sessionId : place.kind}`;

      if (focus === followed) return;

      if (place.kind !== "session") {
        followed = focus;

        return;
      }

      const folder = sessionFolderPath(place.sessionId);

      if (folder === undefined) return;
      followed = focus;
      wanted = folder;
      switching = switching
        .then(() => (wanted === folder ? activateWorkspace(folder) : undefined))
        .then(
          () => undefined,
          () => undefined,
        );
    };

    const adopt = (): void => {
      const location = locationPlace(router);

      if (location === undefined) return;
      const view = currentView(activeTab(windowTabs.getSnapshot()));

      if (view.kind === "page" && showsPage(location) && view.page.kind === location.kind) {
        if (pageSection(view.page) !== pageSection(location))
          windowTabs.dispatch({ kind: "page-section", section: pageSection(location) });

        return;
      }

      if (!samePlaceAt(tabPlace(activeTab(windowTabs.getSnapshot())), location))
        windowTabs.dispatch({ kind: "open", place: location, target: "here" });
    };

    adopt();
    follow();
    const unsubscribeRouter = router.subscribe("onResolved", adopt);
    const unsubscribeTabs = windowTabs.subscribe(follow);
    const unsubscribeDirectory = directoryWatch("roots").subscribe(follow);

    const unsubscribeWorkspaces = queryClient.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] === keys.workspaces[0]) follow();
    });

    return () => {
      unsubscribeRouter();
      unsubscribeTabs();
      unsubscribeDirectory();
      unsubscribeWorkspaces();
    };
  });
}

function sessionTitle(session: SessionInfo | undefined): string {
  if (session === undefined) return "Chat";

  return session.name ?? "New chat";
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

export function useWindowTabItems(state: WindowState): readonly WindowTabItem[] {
  const directory = useWorkspaceSessionDirectory();
  const working = useWorkingSessionIds();

  const sessions = useMemo(
    () =>
      new Map(
        (directory.data ?? []).flatMap((entry) =>
          entry.sessions.map((session) => [session.id, session] as const),
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
      session === undefined ? "idle" : sessionActivityMark(session, working.has(session.id));

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

          return listed !== undefined && sessionHasUnreadCompletion(listed);
        }),
      split:
        view.kind === "panes" && view.layout.kind === "split" ? view.layout.direction : undefined,
    };
  });
}
