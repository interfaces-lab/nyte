import type { SessionId, SessionView } from "@nyte-ai/sdk";
import type { DerivedStore } from "../data/derived-store.ts";
import { sessionWatch } from "../data/watches.ts";
import type { Chat, ChatDirectory } from "./directory.ts";

/** A chat below another whose own run waits on the user, with its view, which holds what it asks. */
export interface WaitingChat {
  readonly chat: Chat;
  /** Undefined while its view loads. */
  readonly view: SessionView | undefined;
}

const NONE: readonly WaitingChat[] = [];

const stores = new Map<SessionId, DerivedStore<readonly WaitingChat[]>>();

/**
 * Every chat below `root`, at any depth, whose own run waits on the user's approval or answer,
 * each with its view, which this store holds open while anyone listens.
 */
export function waitingBelow(
  root: SessionId,
  directory: {
    readonly read: () => ChatDirectory;
    readonly subscribe: (notice: () => void) => () => void;
  },
): DerivedStore<readonly WaitingChat[]> {
  const known = stores.get(root);

  if (known !== undefined) return known;
  const listeners = new Set<() => void>();
  const watched = new Map<SessionId, () => void>();
  let value = NONE;
  let leave: (() => void) | undefined;

  const notify = (): void => {
    for (const notice of listeners) notice();
  };

  const read = (): readonly WaitingChat[] => {
    const chats = directory.read();

    const next = [...chats.values()].flatMap((chat) =>
      chat.status.kind === "waiting-for-approval" && below(chats, chat, root)
        ? [{ chat, view: sessionWatch(chat.id).value }]
        : [],
    );

    const same =
      next.length === value.length &&
      next.every(
        (entry, index) => entry.chat === value[index]?.chat && entry.view === value[index].view,
      );

    if (!same) value = next.length === 0 ? NONE : next;

    return value;
  };

  const follow = (): void => {
    const waiting = new Set(read().map((entry) => entry.chat.id));

    for (const [id, unsubscribe] of watched)
      if (!waiting.has(id)) {
        unsubscribe();
        watched.delete(id);
      }

    for (const id of waiting)
      if (!watched.has(id)) watched.set(id, sessionWatch(id).subscribe(notify));
    notify();
  };

  const store: DerivedStore<readonly WaitingChat[]> = {
    getSnapshot: read,
    subscribe(notice) {
      listeners.add(notice);

      if (leave === undefined) {
        leave = directory.subscribe(follow);
        follow();
      }

      return () => {
        listeners.delete(notice);

        if (listeners.size > 0) return;
        leave?.();
        leave = undefined;

        for (const unsubscribe of watched.values()) unsubscribe();
        watched.clear();
      };
    },
  };

  stores.set(root, store);

  return store;
}

function below(chats: ChatDirectory, chat: Chat, root: SessionId): boolean {
  let parent = chat.parent;

  while (parent !== null) {
    if (parent === root) return true;
    parent = chats.get(parent)?.parent ?? null;
  }

  return false;
}
