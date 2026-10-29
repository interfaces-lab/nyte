import type { JobId, SessionId } from "@nyte-ai/sdk";

/**
 * What a chat's tray shows over its composer: nothing, its agents, its terminals or one agent's chat.
 * A list or terminals view keeps what it was opened over, the agents listed or the terminals live then.
 */
export type TrayView =
  | { readonly kind: "closed" }
  | {
      readonly kind: "list";
      readonly retainedSessionId: SessionId | undefined;
      readonly openedOver: readonly SessionId[];
    }
  | { readonly kind: "terminals"; readonly openedOver: readonly JobId[] }
  | { readonly kind: "detail"; readonly sessionId: SessionId };

export interface TrayAction {
  readonly kind: "tray";
  readonly parent: SessionId;
  readonly view: TrayView;
}

const CLOSED: TrayView = { kind: "closed" };

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

/**
 * The tray as shown, given the agents its chat lists and the terminals it runs now. A list or
 * terminals view is open only while something it was opened over is still there, so it doesn't
 * reopen by itself when new work starts.
 */
export function showTray(
  view: TrayView,
  present: { readonly listed: readonly SessionId[]; readonly live: readonly JobId[] },
): TrayView {
  if (view.kind === "list")
    return view.openedOver.some((id) => present.listed.includes(id)) ? view : CLOSED;

  if (view.kind === "terminals")
    return view.openedOver.some((id) => present.live.includes(id)) ? view : CLOSED;

  return view;
}
