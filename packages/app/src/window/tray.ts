import type { SessionId } from "@nyte-ai/sdk";

/** What a chat's tray shows over its composer: nothing, its agents, its terminals or one agent's chat. */
export type TrayView =
  | { readonly kind: "closed" }
  | { readonly kind: "list"; readonly retainedSessionId: SessionId | undefined }
  | { readonly kind: "terminals" }
  | { readonly kind: "detail"; readonly sessionId: SessionId };

export interface TrayAction {
  readonly kind: "tray";
  readonly parent: SessionId;
  readonly view: TrayView;
}

/** Each chat's open tray after `action`; a closed tray is forgotten. */
export function reduceTrays(
  trays: ReadonlyMap<SessionId, TrayView>,
  action: TrayAction,
): ReadonlyMap<SessionId, TrayView> {
  const next = new Map(trays);

  if (action.view.kind === "closed") next.delete(action.parent);
  else next.set(action.parent, action.view);

  return next;
}
