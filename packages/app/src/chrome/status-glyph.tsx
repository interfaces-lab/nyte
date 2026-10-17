import type { ReactElement } from "react";
import type { SessionInfo } from "@nyte-ai/sdk";
import { Icon } from "@nyte-ai/ui/icon";
import type { SessionMark } from "@nyte-ai/plugin/client/presentation";
import { StatusDot } from "../components/ui.tsx";
import { sessionHasUnreadCompletion } from "../session-read-state.ts";

/**
 * One glyph per stage, by shape: the live marks while a run works, waits, or
 * failed; an eye once it finished and nobody has opened it.
 */
export function StatusGlyph({
  session,
  mark,
}: {
  readonly session: SessionInfo;
  readonly mark: SessionMark;
}): ReactElement | null {
  if (mark !== "idle") return <StatusDot mark={mark} />;

  return sessionHasUnreadCompletion(session) ? <Icon name="eye" size={14} label="Unread" /> : null;
}
