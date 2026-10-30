import type { RegisteredRouter } from "@tanstack/react-router";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
import type { SessionId } from "@nyte-ai/sdk";
import { toast } from "@nyte-ai/ui/toast";
import { chatDirectory, subscribeChats } from "../chats/index.ts";
import type { HostState } from "../contract/nyte.ts";
import { keys, queryClient } from "../data/query-client.ts";
import { connection } from "../data/connection.ts";
import { windowTabs } from "../tabs/window-tabs.ts";
import { workbenchShowsChat } from "../workbench/model.ts";
import { workbenchViewKey } from "../workbench/paths.ts";
import { workbench } from "../workbench/store.ts";
import { derivedStore } from "../data/derived-store.ts";
import type { StoreSource } from "../data/derived-store.ts";
import { expose } from "./exposure.ts";
import { reduceTrays } from "./tray.ts";
import type { TrayAction, Trays, TrayView } from "./tray.ts";

export interface WindowSnapshot {
  /** Chats on screen, whether or not anyone can read them now; text paces only in these. */
  readonly shown: ReadonlySet<SessionId>;
  /** Chats the user is looking at: what marks a chat read, holds its divider and silences its notices. */
  readonly looking: ReadonlySet<SessionId>;
  /** Chats with a finished reply nobody has read, except those the user is looking at. */
  readonly unread: ReadonlySet<SessionId>;
  /** Each chat's open tray, by parent; a chat without one shows its tray closed. */
  readonly trays: ReadonlyMap<SessionId, TrayView>;
  /** Each chat's ended tasks the user cleared from its trays, by parent. */
  readonly cleared: ReadonlyMap<SessionId, ReadonlySet<string>>;
  /** The workbench is maximized over the chats instead of showing them. */
  readonly covered: boolean;
}

export { showTray, type TrayView } from "./tray.ts";

export { unreadOnHost } from "./exposure.ts";

/** What this window holds itself; the rest of its view it reads from the stores it listens to. */
interface Own {
  readonly trays: Trays;
  readonly settings: boolean;
}

let own: Own = { trays: { views: new Map(), cleared: new Map() }, settings: false };

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
      const view = workbench.getView(workbenchViewKey(host));

      return view.expanded && view.layout.kind === "maximized" && !workbenchShowsChat(view.layout);
    },
    subscribe(notice: () => void) {
      const leave = [
        workbench.subscribe(notice),
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
    const trays = read.own.read().trays.views;
    const cleared = read.own.read().trays.cleared;
    const covered = read.covered.read();

    const exposure = expose({
      tabs: read.tabs.read(),
      trays,
      settings: read.own.read().settings,
      covered,
      focused: read.focused.read(),
      chats: read.chats.read(),
    });

    return {
      shown: sameSet(previous.shown, exposure.shown) ? previous.shown : exposure.shown,
      looking: sameSet(previous.looking, exposure.looking) ? previous.looking : exposure.looking,
      unread: sameSet(previous.unread, exposure.unread) ? previous.unread : exposure.unread,
      trays,
      cleared,
      covered,
    };
  },
  {
    shown: new Set<SessionId>(),
    looking: new Set<SessionId>(),
    unread: new Set<SessionId>(),
    trays: new Map<SessionId, TrayView>(),
    cleared: new Map<SessionId, ReadonlySet<string>>(),
    covered: false,
  },
);

function act(action: TrayAction): void {
  setOwn({ ...own, trays: reduceTrays(own.trays, action) });
}

/** Moves each chat's read mark to the tip it is unread through; a chat with nothing unread is left alone. A failure says so. */
function markRead(ids: readonly SessionId[]): void {
  const chats = chatDirectory();

  void Promise.all(
    ids.flatMap((id) => {
      const tip = chats.get(id)?.unreadTip;

      return tip === undefined || tip === null
        ? []
        : [connection().session(id).head(tip.head).see(tip.commit)];
    }),
  ).catch(() =>
    toast.add({
      type: "error",
      title: "Couldn't mark this chat as read. Try again.",
      id: "session-mark-read-error",
    }),
  );
}

/** This window: what it shows, what the user is looking at, and the actions that change it. */
export const chatWindow = {
  getSnapshot: store.getSnapshot,
  subscribe: store.subscribe,
  act,
  markRead,
};

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
