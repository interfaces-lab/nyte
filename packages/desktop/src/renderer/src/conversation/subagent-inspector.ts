/**
 * The chat a transcript belongs to and how it opens a subagent. The
 * conversation provides it; a task tool call reads it, so the call row can
 * find its job and child session without knowing about panes or the workbench.
 */
import { createContext, useContext } from "react";
import type { SessionId } from "@nyte-ai/protocol";

interface SubagentInspector {
  readonly sessionId: SessionId;
  readonly inspect: (childSessionId: SessionId) => void;
}

const SubagentInspectorContext = createContext<SubagentInspector | undefined>(undefined);

export const SubagentInspectorProvider = SubagentInspectorContext.Provider;

export function useSubagentInspector(): SubagentInspector | undefined {
  return useContext(SubagentInspectorContext);
}
