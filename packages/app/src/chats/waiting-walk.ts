import type { SessionId } from "@nyte-ai/sdk";
import type { DerivedStore } from "../data/derived-store.ts";
import { waitingBelow } from "./waiting.ts";
import type { WaitingChat } from "./waiting.ts";

const walks = new Map<SessionId, DerivedStore<readonly WaitingChat[]>>();

/** The one walk below `root` that every reader shares; it is dropped when its last listener leaves. */
export function waitingWalk(root: SessionId): DerivedStore<readonly WaitingChat[]> {
  const existing = walks.get(root);

  if (existing !== undefined) return existing;

  const walk = waitingBelow(root);
  let listening = 0;

  const shared: DerivedStore<readonly WaitingChat[]> = {
    getSnapshot: walk.getSnapshot,
    subscribe(notice) {
      const leave = walk.subscribe(notice);
      listening += 1;

      return () => {
        leave();
        listening -= 1;

        if (listening === 0 && walks.get(root) === shared) walks.delete(root);
      };
    },
  };

  walks.set(root, shared);

  return shared;
}
