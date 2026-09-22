import { createContext, useContext } from "react";
import type { SessionId, SessionInfo } from "@nyte-ai/protocol";

export type ProvisionalSubagentSession = {
  readonly kind: "provisional";
  readonly sessionId: SessionId;
  readonly title: string;
  readonly startedAt: number;
};

export type SubagentSession = SessionInfo | ProvisionalSubagentSession;

interface SubagentSessions {
  readonly children: ReadonlyMap<SessionId, SubagentSession>;
  readonly open: (sessionId?: SessionId) => void;
}

const SubagentSessionsContext = createContext<SubagentSessions | undefined>(undefined);

export const SubagentSessionsProvider = SubagentSessionsContext.Provider;

export function useChildSession(session: SessionId): SubagentSession | undefined {
  return useContext(SubagentSessionsContext)?.children.get(session);
}

export function useOpenSubagentTray(): ((sessionId?: SessionId) => void) | undefined {
  return useContext(SubagentSessionsContext)?.open;
}
