import { hashKey } from "@tanstack/react-query";
import { useRouter } from "@tanstack/react-router";
import { useState, useSyncExternalStore } from "react";
import type { SessionId, WorkspaceInfo } from "@nyte-ai/sdk";
import { chatFolderPath, subscribeChats, useChats } from "../chats/index.ts";
import { activateWorkspace } from "../sidebar/use-show-session.ts";
import { nyte } from "../contract/nyte.ts";
import { handleOpenOutcome } from "../panes/open-workspace.tsx";
import type { HostState } from "../contract/nyte.ts";
import { useProjects } from "../data/projects.ts";
import { keys, queryClient } from "../data/query-client.ts";
import { sessionRows, subscribeSessionRow, subscribeSessionRows } from "../data/session-rows.ts";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";

import { goneChats, watchedChats } from "./gone-chats.ts";
import { activeTab, tabPlace } from "./model.ts";
import type { WindowState } from "./model.ts";
import { locationPlace, navigateTo } from "./places.ts";
import {
  adoptLocation,
  checkedFolder,
  followFolder,
  restoredFolder,
  routeFor,
  unreadableFolder,
} from "./route-sync.ts";
import type { FolderFollow, ShownFolder } from "./route-sync.ts";
import { windowTabItems } from "./tab-items.ts";
import type { WindowTabItem } from "./window-tab-strip.tsx";
import { windowTabs } from "./window-tabs.ts";

export function useWindowTabsState(): WindowState {
  return useSyncExternalStore(windowTabs.subscribe, windowTabs.getSnapshot, windowTabs.getSnapshot);
}

function shownFolder(): ShownFolder {
  const state = queryClient.getQueryState<HostState>(keys.host);
  const workspace = state?.data?.workspace;

  return { workspace, chosen: workspace !== undefined && state?.dataUpdatedAt !== 0 };
}

async function restoreChatFolder(): Promise<void> {
  const place = tabPlace(activeTab(windowTabs.getSnapshot()));
  const restore = nyte.host.restore;

  if (place.kind !== "session" || restore === undefined) return;
  const asked = shownFolder();
  const restored = await restore({ session: place.sessionId });
  const shown = restoredFolder(asked, shownFolder(), restored);

  if (shown !== undefined) queryClient.setQueryData(keys.host, shown);
}

export function useWindowTabsSync(): void {
  const router = useRouter();

  useMountEffect(() => {
    let follow: FolderFollow = { followed: "", wanted: null };

    let switching = restoreChatFolder().then(
      () => undefined,
      () => undefined,
    );

    const sync = (): void => {
      const state = windowTabs.getSnapshot();
      const place = routeFor(state, locationPlace(router));

      if (place !== undefined) navigateTo(router, place);
      const followed = followFolder(follow, activeTab(state), chatFolderPath);
      follow = followed.next;

      if (followed.step.kind === "none") return;
      const folder = followed.step.folder;
      switching = switching
        .then(() => (follow.wanted === folder ? activateWorkspace(folder) : undefined))
        .then(
          () => undefined,
          () => undefined,
        );
    };

    const adopt = (): void => {
      const action = adoptLocation(windowTabs.getSnapshot(), locationPlace(router));

      if (action !== undefined) windowTabs.dispatch(action);
    };

    adopt();
    sync();
    const unsubscribeRouter = router.subscribe("onResolved", adopt);
    const unsubscribeTabs = windowTabs.subscribe(sync);
    const unsubscribeChats = subscribeChats(sync);
    const unsubscribeGone = forgetGoneChats();
    const unsubscribeFolder = checkShownFolder();

    return () => {
      unsubscribeRouter();
      unsubscribeTabs();
      unsubscribeChats();
      unsubscribeGone();
      unsubscribeFolder();
    };
  });
}

function checkShownFolder(): () => void {
  const listKey = hashKey(keys.workspaces);
  let asking: string | undefined;

  const check = (): void => {
    const asked = unreadableFolder(
      shownFolder().workspace,
      queryClient.getQueryData<readonly WorkspaceInfo[]>(keys.workspaces),
    );

    if (asked === undefined || asking === asked.path) return;
    asking = asked.path;

    void nyte.host.openWorkspace({ path: asked.path }).then((outcome) => {
      asking = undefined;
      const shown = checkedFolder(asked, shownFolder().workspace, outcome);

      if (shown === undefined) return;
      queryClient.setQueryData(keys.host, shown);
      handleOpenOutcome(outcome);
    });
  };

  const reread = (): void =>
    void queryClient.invalidateQueries({ queryKey: keys.workspaces, exact: true });

  const unsubscribe = queryClient.getQueryCache().subscribe((event) => {
    if (event.type === "updated" && event.query.queryHash === listKey) check();
  });

  window.addEventListener("focus", reread);
  check();

  return () => {
    unsubscribe();
    window.removeEventListener("focus", reread);
  };
}

function forgetGoneChats(): () => void {
  const reads = new Map<SessionId, () => void>();
  let known = sessionRows().hosted;

  const forget = (): void => {
    const rows = sessionRows();
    const gone = goneChats(known, rows);
    known = rows.hosted;
    windowTabs.dispatch({ kind: "close-chats", sessionIds: gone.close });
    windowTabs.dispatch({ kind: "forget-closed", gone: gone.forget });
  };

  const read = (): void => {
    const shown = watchedChats(windowTabs.getSnapshot());

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

const NO_ITEMS: readonly WindowTabItem[] = [];

export function useWindowTabItems(state: WindowState): readonly WindowTabItem[] {
  const projects = useProjects();
  const [previous, keep] = useState(NO_ITEMS);
  const items = useChats((chats) => windowTabItems(state, chats, projects, previous));

  if (items !== previous) keep(items);

  return items;
}
