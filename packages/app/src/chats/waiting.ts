import { runStatus } from "@nyte-ai/plugin/client/presentation";
import { asId } from "@nyte-ai/schema";
import type { SessionId } from "@nyte-ai/sdk";
import type { ChatView } from "../data/chat-store.ts";
import type { DerivedStore } from "../data/derived-store.ts";
import { chatStore } from "../data/chat-store.ts";

export interface WaitingChat {
  readonly id: SessionId;
  readonly title: string;
  readonly view: ChatView;
}

interface WaitingChild {
  readonly id: SessionId;
  readonly title: string;
}

const NONE: readonly WaitingChat[] = [];

/**
 * The host marks a child item waiting while it or anything below it waits, so this walks down only
 * those items, and holds the views it walks open while anyone listens. Each caller owns its store.
 */
export function waitingBelow(root: SessionId): DerivedStore<readonly WaitingChat[]> {
  const listeners = new Set<() => void>();
  const watched = new Map<SessionId, () => void>();
  let value = NONE;

  const notify = (): void => {
    for (const notice of listeners) notice();
  };

  const read = (): readonly WaitingChat[] => {
    const next = waitingChildren(root).flatMap((child) => {
      const view = chatStore(child.id).value;

      return view !== undefined && runStatus(view.execution).kind === "waiting-for-approval"
        ? [{ ...child, view }]
        : [];
    });

    const same =
      next.length === value.length &&
      next.every(
        (entry, index) =>
          entry.id === value[index]?.id &&
          entry.title === value[index].title &&
          entry.view === value[index].view,
      );

    if (!same) value = next.length === 0 ? NONE : next;

    return value;
  };

  const follow = (): void => {
    const walked = new Set([root, ...waitingChildren(root).map((child) => child.id)]);

    for (const [id, unsubscribe] of watched)
      if (!walked.has(id)) {
        unsubscribe();
        watched.delete(id);
      }

    for (const id of walked) if (!watched.has(id)) watched.set(id, chatStore(id).subscribe(follow));
    notify();
  };

  const store: DerivedStore<readonly WaitingChat[]> = {
    getSnapshot: read,
    subscribe(notice) {
      listeners.add(notice);

      if (watched.size === 0) follow();

      return () => {
        listeners.delete(notice);

        if (listeners.size > 0) return;

        for (const unsubscribe of watched.values()) unsubscribe();
        watched.clear();
      };
    },
  };

  return store;
}

function waitingChildren(session: SessionId): readonly WaitingChild[] {
  return (chatStore(session).value?.background ?? []).flatMap((item) => {
    if (item.kind !== "child" || item.state !== "waiting") return [];
    const id = asId<"session">(item.id);

    return [{ id, title: item.title }, ...waitingChildren(id)];
  });
}
