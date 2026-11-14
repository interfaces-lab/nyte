import type { JobId, SessionId } from "@nyte-ai/sdk";

export type TrayView =
  | { readonly kind: "closed" }
  | { readonly kind: "list"; readonly openedOver: readonly SessionId[] }
  | { readonly kind: "terminals"; readonly openedOver: readonly JobId[] }
  | { readonly kind: "detail"; readonly sessionId: SessionId };

export type TrayAction =
  | { readonly kind: "tray"; readonly parent: SessionId; readonly view: TrayView }
  | { readonly kind: "clear"; readonly parent: SessionId; readonly tasks: readonly string[] };

export interface Trays {
  readonly views: ReadonlyMap<SessionId, TrayView>;
  readonly cleared: ReadonlyMap<SessionId, ReadonlySet<string>>;
}

const CLOSED: TrayView = { kind: "closed" };

export function reduceTrays(trays: Trays, action: TrayAction): Trays {
  if (action.kind === "clear") {
    const cleared = new Map(trays.cleared);
    cleared.set(action.parent, new Set([...(cleared.get(action.parent) ?? []), ...action.tasks]));

    return { ...trays, cleared };
  }

  const views = new Map(trays.views);

  if (action.view.kind === "closed") views.delete(action.parent);
  else views.set(action.parent, action.view);

  return { ...trays, views };
}

export function showTray(
  view: TrayView,
  listed: { readonly agents: readonly SessionId[]; readonly terminals: readonly JobId[] },
): TrayView {
  if (view.kind === "list")
    return view.openedOver.some((id) => listed.agents.includes(id)) ? view : CLOSED;

  if (view.kind === "terminals")
    return view.openedOver.some((id) => listed.terminals.includes(id)) ? view : CLOSED;

  return view;
}

/**
 * The tray view to draw while React renders a detail in the background: the agent's chat once the
 * deferred render reaches it, and until then the view drawn last. A deferred value can lag more
 * than one change behind, so after Back to the list it can still hold the agent opened before;
 * drawing it would show that agent's chat for a frame.
 */
export function drawnTray(current: TrayView, deferred: TrayView, drawn: TrayView): TrayView {
  if (current.kind !== "detail") return current;

  return deferred.kind === "detail" && deferred.sessionId === current.sessionId ? deferred : drawn;
}
