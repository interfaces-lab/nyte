import type { RegisteredRouter } from "@tanstack/react-router";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
import type { SessionId } from "@nyte-ai/sdk";
import { chatDirectory, subscribeChats, useChats } from "../chats/index.ts";
import type { ChatDirectory } from "../chats/index.ts";
import type { HostState } from "../nyte.ts";
import { keys, queryClient } from "../queries.ts";
import { windowTabs } from "../tabs/window-tabs.ts";
import {
  workbenchController,
  workbenchShowsChat,
  workbenchViewKey,
} from "../workbench/controller.ts";
import { expose, shownChats } from "./exposure.ts";
import type { WindowView } from "./exposure.ts";

export interface WindowSnapshot {
  /** Chats on screen, whether or not anyone can read them now; text paces only in these. */
  readonly shown: ReadonlySet<SessionId>;
  /** Chats the user is looking at: what marks a chat read, holds its divider and silences its notices. */
  readonly looking: ReadonlySet<SessionId>;
  /** Chats with a finished reply nobody has read, except those the user is looking at. */
  readonly unread: ReadonlySet<SessionId>;
  /** The agent each chat's tray shows over it, by parent. */
  readonly details: ReadonlyMap<SessionId, SessionId>;
  /** The workbench is maximized over the chats instead of showing them. */
  readonly covered: boolean;
}

export type ChatWindowAction =
  | { readonly kind: "detail-opened"; readonly parent: SessionId; readonly child: SessionId }
  | { readonly kind: "detail-closed"; readonly parent: SessionId };

const listeners = new Set<() => void>();

let details: ReadonlyMap<SessionId, SessionId> = new Map();

let settings = false;

let inputs: WindowView | undefined;

let snapshot: WindowSnapshot = {
  shown: new Set(),
  looking: new Set(),
  unread: new Set(),
  details,
  covered: false,
};

function getSnapshot(): WindowSnapshot {
  const host = queryClient.getQueryData<HostState>(keys.host)?.workspace?.path;
  const workbench = workbenchController.getView(workbenchViewKey(host));

  const next: WindowView = {
    tabs: windowTabs.getSnapshot(),
    details,
    settings,
    covered:
      workbench.expanded &&
      workbench.layout.kind === "maximized" &&
      !workbenchShowsChat(workbench.layout),
    focused: document.visibilityState === "visible" && document.hasFocus(),
    chats: chatDirectory(),
  };

  if (
    inputs !== undefined &&
    inputs.tabs === next.tabs &&
    inputs.details === next.details &&
    inputs.settings === next.settings &&
    inputs.covered === next.covered &&
    inputs.focused === next.focused &&
    inputs.chats === next.chats
  )
    return snapshot;

  inputs = next;
  const exposure = expose(next);

  snapshot = {
    shown: sameSet(snapshot.shown, exposure.shown) ? snapshot.shown : exposure.shown,
    looking: sameSet(snapshot.looking, exposure.looking) ? snapshot.looking : exposure.looking,
    unread: sameSet(snapshot.unread, exposure.unread) ? snapshot.unread : exposure.unread,
    details,
    covered: next.covered,
  };

  return snapshot;
}

let leaveSources: (() => void) | undefined;

function subscribe(notice: () => void): () => void {
  listeners.add(notice);
  leaveSources ??= watchSources();

  return () => {
    listeners.delete(notice);

    if (listeners.size > 0) return;
    leaveSources?.();
    leaveSources = undefined;
  };
}

function watchSources(): () => void {
  const leave = [
    windowTabs.subscribe(notifyAll),
    workbenchController.subscribe(notifyAll),
    subscribeChats(notifyAll),
    queryClient.getQueryCache().subscribe((event) => {
      if (event.query.queryKey[0] === keys.host[0]) notifyAll();
    }),
  ];

  window.addEventListener("focus", notifyAll);
  window.addEventListener("blur", notifyAll);
  document.addEventListener("visibilitychange", notifyAll);

  return () => {
    for (const unsubscribe of leave) unsubscribe();
    window.removeEventListener("focus", notifyAll);
    window.removeEventListener("blur", notifyAll);
    document.removeEventListener("visibilitychange", notifyAll);
  };
}

function act(action: ChatWindowAction): void {
  const next = new Map(details);

  switch (action.kind) {
    case "detail-opened":
      next.set(action.parent, action.child);
      break;
    case "detail-closed":
      next.delete(action.parent);
      break;
    default: {
      const _exhaustive: never = action;

      return _exhaustive;
    }
  }

  details = next;
  notifyAll();
}

function notifyAll(): void {
  for (const notice of listeners) notice();
}

/** This window: what it shows, what the user is looking at, and the actions that change it. */
export const chatWindow = { getSnapshot, subscribe, act };

/** What `select` makes of this window; a change that selects an equal value doesn't render. */
export function useChatWindow<S>(
  select: (snapshot: WindowSnapshot) => S,
  isEqual?: (previous: S, next: S) => boolean,
): S {
  return useSyncExternalStoreWithSelector(subscribe, getSnapshot, getSnapshot, select, isEqual);
}

/** The chat directory as this window shows it: unread only where nobody is looking. */
export function useShownChats(): ChatDirectory {
  const chats = useChats((directory) => directory);
  const unread = useChatWindow((snapshot) => snapshot.unread);

  return shownChats(chats, unread);
}

/** Follows whether settings has the stage, which leaves no chat on screen. */
export function followStage(router: RegisteredRouter): () => void {
  const read = (): void => {
    const next = router.state.matches.some((match) => match.routeId === "/settings/$section");

    if (next === settings) return;
    settings = next;
    notifyAll();
  };

  read();

  return router.subscribe("onResolved", read);
}

function sameSet<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  return left.size === right.size && [...left].every((item) => right.has(item));
}
