import type { JobId, SessionId } from "@nyte-ai/sdk";

/** A list or terminals view keeps what it was opened over, the tasks it listed then. */
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

/**
 * A list or terminals view stays open only while something it was opened over is still listed,
 * so it doesn't reopen by itself when new work starts.
 */
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
