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
import { derivedStore } from "../derived-store.ts";
import type { StoreSource } from "../derived-store.ts";
import { expose, shownChats } from "./exposure.ts";

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

/** What this window holds itself; the rest of its view it reads from the stores it listens to. */
interface Own {
  readonly details: ReadonlyMap<SessionId, SessionId>;
  readonly settings: boolean;
}

let own: Own = { details: new Map(), settings: false };

const ownListeners = new Set<() => void>();

function setOwn(next: Own): void {
  own = next;

  for (const notice of ownListeners) notice();
}

const sources = {
  own: {
    read: () => own,
    subscribe(notice: () => void) {
      ownListeners.add(notice);

      return () => ownListeners.delete(notice);
    },
  },
  tabs: { read: windowTabs.getSnapshot, subscribe: windowTabs.subscribe },
  covered: {
    read() {
      const host = queryClient.getQueryData<HostState>(keys.host)?.workspace?.path;
      const workbench = workbenchController.getView(workbenchViewKey(host));

      return (
        workbench.expanded &&
        workbench.layout.kind === "maximized" &&
        !workbenchShowsChat(workbench.layout)
      );
    },
    subscribe(notice: () => void) {
      const leave = [
        workbenchController.subscribe(notice),
        queryClient.getQueryCache().subscribe((event) => {
          if (event.query.queryKey[0] === keys.host[0]) notice();
        }),
      ];

      return () => {
        for (const unsubscribe of leave) unsubscribe();
      };
    },
  },
  focused: {
    read: () => document.visibilityState === "visible" && document.hasFocus(),
    subscribe(notice: () => void) {
      window.addEventListener("focus", notice);
      window.addEventListener("blur", notice);
      document.addEventListener("visibilitychange", notice);

      return () => {
        window.removeEventListener("focus", notice);
        window.removeEventListener("blur", notice);
        document.removeEventListener("visibilitychange", notice);
      };
    },
  },
  chats: { read: chatDirectory, subscribe: subscribeChats },
} satisfies Readonly<Record<string, StoreSource<unknown>>>;

const store = derivedStore(
  sources,
  (read, previous: WindowSnapshot) => {
    const details = read.own.read().details;
    const covered = read.covered.read();

    const exposure = expose({
      tabs: read.tabs.read(),
      details,
      settings: read.own.read().settings,
      covered,
      focused: read.focused.read(),
      chats: read.chats.read(),
    });

    return {
      shown: sameSet(previous.shown, exposure.shown) ? previous.shown : exposure.shown,
      looking: sameSet(previous.looking, exposure.looking) ? previous.looking : exposure.looking,
      unread: sameSet(previous.unread, exposure.unread) ? previous.unread : exposure.unread,
      details,
      covered,
    };
  },
  {
    shown: new Set<SessionId>(),
    looking: new Set<SessionId>(),
    unread: new Set<SessionId>(),
    details: new Map<SessionId, SessionId>(),
    covered: false,
  },
);

function act(action: ChatWindowAction): void {
  const next = new Map(own.details);

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

  setOwn({ ...own, details: next });
}

/** This window: what it shows, what the user is looking at, and the actions that change it. */
export const chatWindow = { getSnapshot: store.getSnapshot, subscribe: store.subscribe, act };

/** What `select` makes of this window; a change that selects an equal value doesn't render. */
export function useChatWindow<S>(
  select: (snapshot: WindowSnapshot) => S,
  isEqual?: (previous: S, next: S) => boolean,
): S {
  return useSyncExternalStoreWithSelector(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
    select,
    isEqual,
  );
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
    const settings = router.state.matches.some((match) => match.routeId === "/settings/$section");

    if (settings !== own.settings) setOwn({ ...own, settings });
  };

  read();

  return router.subscribe("onResolved", read);
}

function sameSet<T>(left: ReadonlySet<T>, right: ReadonlySet<T>): boolean {
  return left.size === right.size && [...left].every((item) => right.has(item));
}
