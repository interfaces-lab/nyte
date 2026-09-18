/**
 * Which subagent the Agents panel shows, per workbench view. The list of
 * subagents itself comes from the parent session's jobs; only the selection
 * is window state, so it is not persisted.
 */
import type { SessionId } from "@nyte-ai/protocol";
import { useSyncExternalStore } from "react";

let selected: ReadonlyMap<string, SessionId> = new Map();
const listeners = new Set<() => void>();

function publish(next: ReadonlyMap<string, SessionId>): void {
  selected = next;
  for (const listener of listeners) listener();
}

function getSnapshot(): ReadonlyMap<string, SessionId> {
  return selected;
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSelectedAgent(owner: string): SessionId | undefined {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot).get(owner);
}

export const agentActions = {
  select(owner: string, childSessionId: SessionId): void {
    if (selected.get(owner) === childSessionId) return;
    publish(new Map(selected).set(owner, childSessionId));
  },
  clear(owner: string): void {
    if (!selected.has(owner)) return;
    const next = new Map(selected);
    next.delete(owner);
    publish(next);
  },
};
