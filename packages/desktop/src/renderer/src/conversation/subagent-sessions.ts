import { createContext, useContext } from "react";
import type { SessionId, SessionInfo } from "@nyte-ai/protocol";

interface SubagentSessions {
  readonly children: ReadonlyMap<SessionId, SessionInfo>;
  readonly open: (sessionId?: SessionId) => void;
}

const SubagentSessionsContext = createContext<SubagentSessions | undefined>(undefined);

export const SubagentSessionsProvider = SubagentSessionsContext.Provider;

export function useChildSession(session: SessionId): SessionInfo | undefined {
  return useContext(SubagentSessionsContext)?.children.get(session);
}

export function useOpenSubagentTray(): ((sessionId?: SessionId) => void) | undefined {
  return useContext(SubagentSessionsContext)?.open;
}
