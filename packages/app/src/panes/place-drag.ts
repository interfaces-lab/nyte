import type { SessionId } from "@nyte-ai/sdk";
import { Value } from "typebox/value";
import { sessionId } from "../data/schemas.ts";
import type { LastingTab } from "../tabs/model.ts";
import { parseTab } from "../tabs/window-tabs.ts";

/**
 * Native drags carry a place between windows as well as within one. Each kind has its own type,
 * because a drop target can read only the types until the drop: panes take chats, strips take tabs.
 */
const SESSION_TYPE = "application/x-nyte-session";

const TAB_TYPE = "application/x-nyte-tab";

/** A chat stays where it was dragged from, so a drop copies it. */
export function startSessionDrag(transfer: DataTransfer, session: SessionId): void {
  transfer.setData(SESSION_TYPE, session);
  transfer.effectAllowed = "copy";
}

/** A tab leaves the window it was dragged from, so a drop moves it. */
export function startTabDrag(transfer: DataTransfer, tab: LastingTab): void {
  transfer.setData(TAB_TYPE, JSON.stringify(tab));
  transfer.effectAllowed = "move";
}

export function carriesSession(transfer: DataTransfer): boolean {
  return transfer.types.includes(SESSION_TYPE);
}

export function carriesTab(transfer: DataTransfer): boolean {
  return transfer.types.includes(TAB_TYPE);
}

export function readSessionDrag(transfer: DataTransfer): SessionId | undefined {
  const value = transfer.getData(SESSION_TYPE);

  return Value.Check(sessionId, value) ? value : undefined;
}

export function readTabDrag(transfer: DataTransfer): LastingTab | undefined {
  const value = transfer.getData(TAB_TYPE);

  return value === "" ? undefined : parseTab(value);
}
