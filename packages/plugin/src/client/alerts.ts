import type { SessionInfo } from "@nyte-ai/schema";
import type { HeadAttention } from "./presentation.ts";

/**
 * Whether a chat's alert is told on the chat itself. A top-level chat's always is. An ask is told
 * where it is answered: a side chat's on the side chat, since it never counts as its parent's
 * background work, and a subagent's on its parent, unless the parent does not ask for it
 * (`parentAsks`). Any other alert of a chat below is told only when `belowEnds`.
 *
 * @category presentation
 */
export function alertsOnChat(
  session: Pick<SessionInfo, "parent" | "side">,
  alert: HeadAttention["alert"],
  parentAsks: boolean,
  belowEnds: boolean,
): boolean {
  if (session.parent === null) return true;

  if (alert.state !== "waiting") return belowEnds;

  return session.side === true || !parentAsks;
}
