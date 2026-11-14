import { asId } from "@nyte-ai/schema";
import type { PartView, SessionId } from "@nyte-ai/sdk";
import type { DerivedStore } from "../data/derived-store.ts";
import { chatStore } from "../data/chat-store.ts";
import { reconcile } from "../data/keep.ts";

/** A descendant with an open ask, and its parts: the same array while its parts are unchanged. */
export interface WaitingChat {
  readonly id: SessionId;
  readonly title: string;
  readonly parts: readonly PartView[];
}

interface WaitingChild {
  readonly id: SessionId;
  readonly title: string;
}

const NONE: readonly WaitingChat[] = [];

export function waitingBelow(root: SessionId): DerivedStore<readonly WaitingChat[]> {
  const listeners = new Set<() => void>();
  const watched = new Map<SessionId, () => void>();
  let value = NONE;

  const notify = (): void => {
    for (const notice of listeners) notice();
  };

  const read = (): readonly WaitingChat[] => {
    const next = waitingChildren(root).flatMap((child) => {
      const parts = chatStore(child.id).value?.parts;

      return parts !== undefined && parts.some(asking) ? [{ ...child, parts }] : [];
    });

    const same =
      next.length === value.length &&
      next.every(
        (entry, index) =>
          entry.id === value[index]?.id &&
          entry.title === value[index].title &&
          entry.parts === value[index].parts,
      );

    if (!same) value = next.length === 0 ? NONE : next;

    return value;
  };

  const follow = (): void => {
    const walked = new Set([root, ...waitingChildren(root).map((child) => child.id)]);
    reconcile(
      watched,
      walked,
      (id) => chatStore(id).subscribe(follow),
      (unsubscribe) => unsubscribe(),
    );
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

/**
 * Every child still running below `session`, at any depth. An ask can outlive its run's wait: a
 * question past its minute stays open while the run goes on, so a working child is walked too.
 */
function waitingChildren(session: SessionId): readonly WaitingChild[] {
  return (chatStore(session).value?.background ?? []).flatMap((item) => {
    if (item.kind !== "child" || (item.state !== "waiting" && item.state !== "working")) return [];
    const id = asId<"session">(item.id);

    return [{ id, title: item.title }, ...waitingChildren(id)];
  });
}

/** An approval, question or secret: a modal part its run hasn't ended. */
function asking(part: PartView): boolean {
  return part.placement.kind === "modal" && part.status.kind === "live";
}
