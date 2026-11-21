import type { RegisteredRouter } from "@tanstack/react-router";
import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
import type { TaskState } from "@nyte-ai/plugin/client/presentation";
import type { CommitId, SessionId } from "@nyte-ai/sdk";
import { toast } from "@nyte-ai/ui/toast";
import { CLOSED, nextSideChat } from "../chat/side-chat/side-chat-state.ts";
import type { SideChatEvent, SideChatWindow } from "../chat/side-chat/side-chat-state.ts";
import { chatDirectory, subscribeChats, useChat } from "../chats/index.ts";
import { chatStore } from "../data/chat-store.ts";
import { reconcile } from "../data/keep.ts";
import type { HostState } from "../contract/nyte.ts";
import { keys, queryClient, queryDataReader } from "../data/query-client.ts";
import { connection } from "../data/connection.ts";
import { subscribeHomeFolder } from "../data/workspaces.ts";
import { windowTabs } from "../tabs/window-tabs.ts";
import { workbenchShowsChat } from "../workbench/model.ts";
import { workbenchViewKey } from "../workbench/paths.ts";
import { workbench } from "../workbench/store.ts";
import { derivedStore } from "../data/derived-store.ts";
import type { StoreSource } from "../data/derived-store.ts";
import { expose } from "./exposure.ts";
import { toSee } from "./seen.ts";
import { reduceTrays } from "./tray.ts";
import type { TrayAction, Trays, TrayView } from "./tray.ts";

export interface WindowSnapshot {
  readonly shown: ReadonlySet<SessionId>;
  readonly looking: ReadonlySet<SessionId>;
  readonly unread: ReadonlySet<SessionId>;
  readonly trays: ReadonlyMap<SessionId, TrayView>;
  readonly cleared: ReadonlyMap<SessionId, ReadonlySet<string>>;
  readonly sides: ReadonlyMap<SessionId, SideChatWindow>;
  readonly covered: boolean;
}

export { drawnTray, showTray, type TrayView } from "./tray.ts";

export { unreadOnHost, viewedChat } from "./exposure.ts";

interface Own {
  readonly trays: Trays;
  readonly sides: ReadonlyMap<SessionId, SideChatWindow>;
  readonly settings: boolean;
}

let own: Own = {
  trays: { views: new Map(), cleared: new Map() },
  sides: new Map(),
  settings: false,
};

const ownListeners = new Set<() => void>();

function setOwn(next: Own): void {
  own = next;

  for (const notice of ownListeners) notice();
}

const readHost = queryDataReader<HostState>(keys.host);

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
      const host = readHost()?.workspace?.path;
      const view = workbench.getView(workbenchViewKey(host));

      return view.expanded && view.layout.kind === "maximized" && !workbenchShowsChat(view.layout);
    },
    subscribe(notice: () => void) {
      let path = readHost()?.workspace?.path;

      const leave = [
        workbench.subscribe(notice),
        queryClient.getQueryCache().subscribe((event) => {
          if (event.query.queryKey[0] !== keys.host[0]) return;
          const next = readHost()?.workspace?.path;

          if (next === path) return;
          path = next;
          notice();
        }),
        subscribeHomeFolder(notice),
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
    const sides = read.own.read().sides;
    const covered = read.covered.read();

    const exposure = expose({
      tabs: read.tabs.read(),
      trays,
      sides,
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
      sides,
      covered,
    };
  },
  {
    shown: new Set<SessionId>(),
    looking: new Set<SessionId>(),
    unread: new Set<SessionId>(),
    trays: new Map<SessionId, TrayView>(),
    cleared: new Map<SessionId, ReadonlySet<string>>(),
    sides: new Map<SessionId, SideChatWindow>(),
    covered: false,
  },
);

function act(action: TrayAction): void {
  setOwn({ ...own, trays: reduceTrays(own.trays, action) });
}

function sideChat(parent: SessionId): SideChatWindow {
  return own.sides.get(parent) ?? CLOSED;
}

function moveSideChat(parent: SessionId, event: SideChatEvent): void {
  const before = sideChat(parent);
  const next = nextSideChat(before, event);

  if (next !== before) setOwn({ ...own, sides: new Map(own.sides).set(parent, next) });
}

function followSeen(): () => void {
  let sent: ReadonlyMap<SessionId, CommitId> = new Map();
  const views = new Map<SessionId, () => void>();
  let frame: number | undefined;

  const step = (): void => {
    frame ??= requestAnimationFrame(decide);
  };

  const decide = (): void => {
    frame = undefined;
    const looking = store.getSnapshot().looking;
    const chats = chatDirectory();

    reconcile(
      views,
      new Set([...looking].filter((id) => (chats.get(id)?.unreadTip ?? null) !== null)),
      (id) => chatStore(id).subscribe(step),
      (leave) => leave(),
    );
    const next = toSee(sent, looking, chats, (id) => chatStore(id).value !== undefined);
    sent = next.sent;

    if (next.see.length > 0) markRead(next.see);
  };

  const leave = store.subscribe(step);
  step();

  return () => {
    leave();

    if (frame !== undefined) cancelAnimationFrame(frame);

    for (const unsubscribe of views.values()) unsubscribe();
    views.clear();
  };
}

let drawing = 0;

let stopSeen: (() => void) | undefined;

function subscribe(notice: () => void): () => void {
  const leave = store.subscribe(notice);
  drawing += 1;
  stopSeen ??= followSeen();

  return () => {
    leave();
    drawing -= 1;

    if (drawing > 0) return;
    stopSeen?.();
    stopSeen = undefined;
  };
}

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

export const chatWindow = {
  getSnapshot: store.getSnapshot,
  subscribe,
  act,
  markRead,
  sideChat,
  moveSideChat,
};

export function useChatWindow<S>(
  select: (snapshot: WindowSnapshot) => S,
  isEqual?: (previous: S, next: S) => boolean,
): S {
  return useSyncExternalStoreWithSelector(
    subscribe,
    store.getSnapshot,
    store.getSnapshot,
    select,
    isEqual,
  );
}

export interface ChatMark {
  readonly state: TaskState;
  readonly unread: boolean;
}

export function useChatMark(id: SessionId): ChatMark {
  const chat = useChat(id);
  const unread = useChatWindow((snapshot) => snapshot.unread.has(id));

  return { state: chat.kind === "ready" ? chat.chat.mark : "done", unread };
}

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
