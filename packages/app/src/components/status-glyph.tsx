import type { ReactElement } from "react";
import { Icon } from "@nyte-ai/ui/icon";
import type { SessionMark } from "@nyte-ai/plugin/client/presentation";
import { StatusDot } from "./ui.tsx";

export function StatusGlyph({
  mark,
  unread,
}: {
  readonly mark: SessionMark;
  readonly unread: boolean;
}): ReactElement | null {
  if (mark !== "idle") return <StatusDot mark={mark} />;

  return unread ? <Icon name="eye" size={14} label="Unread" /> : null;
}
