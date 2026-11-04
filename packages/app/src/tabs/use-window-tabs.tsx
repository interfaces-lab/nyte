import { useRouter } from "@tanstack/react-router";
import { useSyncExternalStore } from "react";
import { Icon } from "@nyte-ai/ui/icon";
import type { SessionId } from "@nyte-ai/sdk";
import { chatFolderPath, chatTitle, subscribeChats, useChats } from "../chats/index.ts";
import type { ChatDirectory } from "../chats/index.ts";
import { activateWorkspace } from "../sidebar/use-show-session.ts";
import { nyte } from "../contract/nyte.ts";
import { keys, queryClient } from "../data/query-client.ts";
import { sessionRows, subscribeSessionRow, subscribeSessionRows } from "../data/session-rows.ts";
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

    adopt();
    follow();
    const unsubscribeRouter = router.subscribe("onResolved", adopt);
    const unsubscribeTabs = windowTabs.subscribe(follow);
    const unsubscribeChats = subscribeChats(follow);
    const unsubscribeGone = forgetGoneChats();

    return () => {
      unsubscribeRouter();
      unsubscribeTabs();
      unsubscribeChats();
      unsubscribeGone();
    };
  });
}

/**
 * A chat the host's lists lack may only be outside its most active, so each tab's chat is read on
 * its own. Each read hears the rows with a notice of its own: the rows keep one per listener, so a
 * shared one would stop with the first read that ends.
 *
 * An open tab closes only when its chat becomes archived, since a chat opened from the archive
 * stays open.
 */
function forgetGoneChats(): () => void {
  const reads = new Map<SessionId, () => void>();
  let known = sessionRows().hosted;

  const forget = (): void => {
    const { hosted, missing } = sessionRows();

    const archived = [...hosted.values()].flatMap((session) =>
      session.archived ? [session.id] : [],
    );

    const archiving = archived.filter((id) => known.get(id)?.archived === false);
    known = hosted;
    windowTabs.dispatch({ kind: "close-chats", sessionIds: new Set([...missing, ...archiving]) });
    windowTabs.dispatch({ kind: "forget-closed", gone: new Set([...missing, ...archived]) });
  };

  const read = (): void => {
    const state = windowTabs.getSnapshot();

    const shown = new Set(
      [...state.tabs, ...state.closed.map(({ tab }) => tab)].flatMap((tab) =>
        tabPlaces(tab).flatMap((place) => (place.kind === "session" ? [place.sessionId] : [])),
      ),
    );

    for (const [id, leave] of reads)
      if (!shown.has(id)) {
        leave();
        reads.delete(id);
      }

    for (const id of shown)
      if (!reads.has(id))
        reads.set(
          id,
          subscribeSessionRow(id, () => forget()),
        );
  };

  read();
  forget();
  const unsubscribe = windowTabs.subscribe(read);
  const unsubscribeRows = subscribeSessionRows(forget);

  return () => {
    unsubscribe();
    unsubscribeRows();

    for (const leave of reads.values()) leave();
  };
}

function placeTitle(place: Place, chats: ChatDirectory): string {
  switch (place.kind) {
    case "blank":
      return "New chat";
    case "session":
      return chatTitle(chats.get(place.sessionId));
    case "customize":
      return "Customize";
    default: {
      const _exhaustive: never = place;

      return _exhaustive;
    }
  }
}

export function useWindowTabItems(state: WindowState): readonly WindowTabItem[] {
  const chats = useChats((directory) => directory);

  return state.tabs.map((tab) => {
    const places = tabPlaces(tab);
    const place = tabPlace(tab);
    const view = tab.view;
    const chat = place.kind === "session" ? chats.get(place.sessionId) : undefined;
    const sessions = places.flatMap((candidate) =>
      candidate.kind === "session" ? [candidate.sessionId] : [],
    );

    const glyph =
      place.kind === "session" ? undefined : (
        <Icon
          name={
            place.kind === "blank"
              ? "new-chat"
              : place.kind === "customize"
                ? "customize"
                : "server"
          }
          size="sm"
        />
      );

    return {
      id: tab.id,
      title: placeTitle(place, chats),
      tooltip: places.map((candidate) => placeTitle(candidate, chats)).join(" | "),
      sessions,
      parent: chat?.parent ?? undefined,
      chat: place.kind === "session" ? place.sessionId : undefined,
      glyph,
      preview: view.kind === "preview",
      split:
        view.kind === "panes" && view.layout.kind === "split" ? view.layout.direction : undefined,
    };
  });
}
