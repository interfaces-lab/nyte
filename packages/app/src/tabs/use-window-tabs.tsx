import { useRouter } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import { runMark } from "@nyte-ai/plugin/client/presentation";
import { Icon } from "@nyte-ai/ui/icon";
import { chatFolderPath, chatTitle, subscribeChats, useChats } from "../chats/index.ts";
import type { ChatDirectory } from "../chats/index.ts";
import { activateWorkspace } from "../sidebar/use-show-session.ts";
import { StatusDot } from "../components/ui.tsx";
import { nyte } from "../contract/nyte.ts";
import { keys, queryClient } from "../data/query-client.ts";
import { sessionsWatch } from "../data/watches.ts";
import { useChatWindow } from "../window/index.ts";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";

import { activeTab, showsPage, tabPlace, tabPlaces } from "./model.ts";
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

      const folder = chatFolderPath(place.sessionId);

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
      const view = activeTab(windowTabs.getSnapshot()).view;

      if (view.kind === "page" && showsPage(location) && view.page.kind === location.kind) {
        if (pageSection(view.page) !== pageSection(location))
          windowTabs.dispatch({ kind: "page-section", section: pageSection(location) });

        return;
      }

      if (!samePlaceAt(tabPlace(activeTab(windowTabs.getSnapshot())), location))
        windowTabs.dispatch({ kind: "open", place: location, target: "permanent" });
    };

    const forgetGone = (): void => {
      const listed = sessionsWatch("all").value;

      if (listed === undefined) return;

      const live = new Set(
        listed.filter((session) => !session.archived).map((session) => session.id),
      );

      windowTabs.dispatch({ kind: "forget-closed", live });
    };

    adopt();
    follow();
    forgetGone();
    const unsubscribeRouter = router.subscribe("onResolved", adopt);
    const unsubscribeTabs = windowTabs.subscribe(follow);
    const unsubscribeChats = subscribeChats(follow);
    const unsubscribeAllSessions = sessionsWatch("all").subscribe(forgetGone);

    return () => {
      unsubscribeRouter();
      unsubscribeTabs();
      unsubscribeChats();
      unsubscribeAllSessions();
    };
  });
}

function placeTitle(place: Place, chats: ChatDirectory): string {
  switch (place.kind) {
    case "blank":
      return "New chat";
    case "session":
      return chatTitle(chats.get(place.sessionId));
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
  const chats = useChats((directory) => directory);
  const unread = useChatWindow((snapshot) => snapshot.unread);

  return state.tabs.map((tab) => {
    const places = tabPlaces(tab);
    const place = tabPlace(tab);
    const view = tab.view;
    const chat = place.kind === "session" ? chats.get(place.sessionId) : undefined;
    const mark = chat === undefined ? "idle" : runMark(chat.status);

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

    const sessions = places.flatMap((candidate) =>
      candidate.kind === "session" ? [candidate.sessionId] : [],
    );

    return {
      id: tab.id,
      title: placeTitle(place, chats),
      tooltip: places.map((candidate) => placeTitle(candidate, chats)).join(" | "),
      sessions,
      glyph,
      unread: sessions.some((sessionId) => unread.has(sessionId)),
      preview: view.kind === "preview",
      split:
        view.kind === "panes" && view.layout.kind === "split" ? view.layout.direction : undefined,
    };
  });
}
