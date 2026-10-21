import { createContext, useContext } from "react";
import type { CallId, SessionId, SessionInfo } from "@nyte-ai/sdk";
import { childrenWatch, useWatchSelect } from "../sdk.tsx";
import type { WatchSource } from "../sdk.tsx";

interface SubagentSessions {
  readonly children: WatchSource<readonly SessionInfo[]>;
  readonly open: (sessionId: SessionId) => void;
}

const SubagentSessionsContext = createContext<SubagentSessions | undefined>(undefined);

export const SubagentSessionsProvider = SubagentSessionsContext.Provider;

const NO_CHILDREN: readonly SessionInfo[] = [];

/**
 * The context a conversation gives its agent cards: its child list and how to open a child.
 * Each subscribe and read goes to the family's current store, as a hidden conversation keeps
 * this context while the family may replace the idle store it held.
 */
export function subagentSessions(
  parent: SessionId,
  open: (sessionId: SessionId) => void,
): SubagentSessions {
  return {
    children: {
      subscribeByFrame: (listener) => childrenWatch(parent).subscribeByFrame(listener),
      getState: () => childrenWatch(parent).getState(),
    },
    open,
  };
}

function sameValue(left: unknown, right: unknown): boolean {
  return Object.is(left, right) || JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Reads one selection of the listed children and re-renders only when its value changes. Each
 * update brings every child as a new object, so selections compare by value.
 */
export function useSubagentChildren<S>(select: (children: readonly SessionInfo[]) => S): S {
  return useWatchSelect(
    useContext(SubagentSessionsContext)?.children,
    (state) => select(state.value ?? NO_CHILDREN),
    sameValue,
  );
}

export function useChildSession(session: SessionId | undefined): SessionInfo | undefined {
  return useSubagentChildren((children) =>
    session === undefined ? undefined : children.find((child) => child.id === session),
  );
}

export function useCalledChild(call: CallId): SessionInfo | undefined {
  return useSubagentChildren((children) => children.find((child) => child.call === call));
}

export function useOpenSubagentTray(): ((sessionId: SessionId) => void) | undefined {
  return useContext(SubagentSessionsContext)?.open;
}
