import type { SessionInfo } from "@nyte-ai/protocol";
import { useSyncExternalStore } from "react";
import { Type } from "typebox";
import type { Static } from "typebox";
import { Value } from "typebox/value";

const STORAGE_KEY = "nyte.desktop.read-sessions.v1";
const readCompletionSchema = Type.Object({ runId: Type.String(), startedAt: Type.Number() });
const readSessionsSchema = Type.Record(Type.String(), readCompletionSchema);
type ReadCompletion = Static<typeof readCompletionSchema>;
export type ReadSessions = ReadonlyMap<string, ReadCompletion>;
export const EMPTY_READ_SESSIONS: ReadSessions = new Map();
type ReadStorage = Pick<Storage, "getItem" | "setItem">;

/** Completion identity, not lastActivityAt: renaming or pinning is not a new reply. */
export function sessionHasUnreadCompletion(session: SessionInfo, read: ReadSessions): boolean {
  return session.heads.some((head) => {
    if (head.run?.phase.kind !== "done") return false;
    const previous = read.get(JSON.stringify([session.sessionId, head.head]));
    return (
      previous === undefined ||
      head.run.startedAt > previous.startedAt ||
      (head.run.startedAt === previous.startedAt && head.run.runId !== previous.runId)
    );
  });
}

/** Read receipts belong to this desktop, independently of the host's execution state. */
export class SessionReadState {
  readonly #storage: ReadStorage | undefined;
  readonly #listeners = new Set<() => void>();
  #read: ReadSessions = EMPTY_READ_SESSIONS;

  constructor(storage?: ReadStorage) {
    this.#storage = storage;
    try {
      const raw = storage?.getItem(STORAGE_KEY);
      if (raw === null || raw === undefined) return;
      const parsed: unknown = JSON.parse(raw);
      if (Value.Check(readSessionsSchema, parsed)) this.#read = new Map(Object.entries(parsed));
    } catch {
      // A corrupt or unavailable preference does not prevent opening a thread.
    }
  }

  getSnapshot = (): ReadSessions => this.#read;

  subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  markRead(session: SessionInfo): void {
    if (!sessionHasUnreadCompletion(session, this.#read)) return;
    const next = new Map(this.#read);
    for (const head of session.heads) {
      if (head.run?.phase.kind !== "done") continue;
      const key = JSON.stringify([session.sessionId, head.head]);
      const previous = next.get(key);
      // A late directory response must not move a read receipt backwards.
      if (previous !== undefined && previous.startedAt > head.run.startedAt) continue;
      if (previous?.runId === head.run.runId) continue;
      next.set(key, { runId: head.run.runId, startedAt: head.run.startedAt });
    }
    this.#read = next;
    try {
      this.#storage?.setItem(STORAGE_KEY, JSON.stringify(Object.fromEntries(next)));
    } catch {
      // Keep the read receipt for this window even if persistence fails.
    }
    for (const listener of this.#listeners) listener();
  }
}

function browserStorage(): ReadStorage | undefined {
  try {
    return typeof window === "undefined" ? undefined : window.localStorage;
  } catch {
    return undefined;
  }
}

export const sessionReadState = new SessionReadState(browserStorage());

export function useReadSessions(): ReadSessions {
  return useSyncExternalStore(
    sessionReadState.subscribe,
    sessionReadState.getSnapshot,
    sessionReadState.getSnapshot,
  );
}
