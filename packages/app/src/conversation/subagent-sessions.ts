import { createContext, useContext } from "react";
import type { CallId, SessionId, SessionInfo } from "@nyte-ai/sdk";

interface SubagentSessions {
  readonly children: readonly SessionInfo[];
  readonly open: (sessionId: SessionId) => void;
}

const SubagentSessionsContext = createContext<SubagentSessions | undefined>(undefined);

export const SubagentSessionsProvider = SubagentSessionsContext.Provider;

export function useChildSession(session: SessionId | undefined): SessionInfo | undefined {
  const children = useContext(SubagentSessionsContext)?.children;

  return session === undefined ? undefined : children?.find((child) => child.id === session);
}

export function useCalledChild(call: CallId): SessionInfo | undefined {
  return useContext(SubagentSessionsContext)?.children.find((child) => child.call === call);
}

export function useSubagentChildren(): readonly SessionInfo[] {
  return useContext(SubagentSessionsContext)?.children ?? [];
}

export function useOpenSubagentTray(): ((sessionId: SessionId) => void) | undefined {
  return useContext(SubagentSessionsContext)?.open;
}
