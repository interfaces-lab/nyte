import type { ReactElement } from "react";
import type { SessionInfo } from "@nyte-ai/protocol";
import type { SessionMark } from "@nyte-ai/client";
import { Icon } from "@nyte-ai/ui/icon";
import { StatusDot } from "../components/ui.tsx";
import { sessionHasUnreadCompletion, useReadSessions } from "../session-read-state.ts";
import { sessionIsDraft } from "./sidebar-view.ts";

/**
 * One glyph per stage, by shape: the live marks while a run works, waits, or
 * failed; an eye once it finished and nobody has opened it; the draft glyph
 * for a chat nothing has been said in.
 */
export function StatusGlyph({
  session,
  mark,
}: {
  readonly session: SessionInfo;
  readonly mark: SessionMark;
}): ReactElement | null {
  const read = useReadSessions();

  if (mark !== "idle") return <StatusDot mark={mark} />;

  if (sessionHasUnreadCompletion(session, read))
    return <Icon name="eye" size={14} label="Unread" />;

  return sessionIsDraft(session) ? <Icon name="draft" size={14} label="Draft" /> : null;
}
