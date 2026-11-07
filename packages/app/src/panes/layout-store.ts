import { useSyncExternalStoreWithSelector } from "use-sync-external-store/with-selector";
import { reduceLayout } from "./layout.ts";
import type { Layout, LayoutAction, PaneId } from "./layout.ts";
import { paneRules } from "./pane-kinds.ts";
import type { PaneContent } from "./pane-kinds.ts";

export interface LayoutStore {
  readonly subscribe: (listener: () => void) => () => void;
  readonly getSnapshot: () => Layout<PaneContent>;
  readonly dispatch: (...actions: readonly LayoutAction<PaneContent>[]) => void;
  readonly onFocusRequest: (listener: (pane: PaneId) => void) => () => void;
  readonly requestFocus: (pane: PaneId) => void;
}

export function createLayoutStore(initial: Layout<PaneContent>): LayoutStore {
  let layout = initial;
  const listeners = new Set<() => void>();
  const focus = createFocusRequests();

  return {
    subscribe(listener) {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    getSnapshot: () => layout,
    dispatch(...actions) {
      const next = actions.reduce(
        (current, action) => reduceLayout(current, action, paneRules),
        layout,
      );

      if (next === layout) return;
      layout = next;

      for (const listener of listeners) listener();
    },
    onFocusRequest: focus.onFocusRequest,
    requestFocus: focus.requestFocus,
  };
}

export function createFocusRequests(): Pick<LayoutStore, "onFocusRequest" | "requestFocus"> {
  const listeners = new Set<(pane: PaneId) => void>();

  return {
    onFocusRequest(listener) {
      listeners.add(listener);

      return () => listeners.delete(listener);
    },
    requestFocus(pane) {
      for (const listener of listeners) listener(pane);
    },
  };
}

export function useLayoutSelect<T>(
  store: LayoutStore,
  select: (layout: Layout<PaneContent>) => T,
  equal?: (left: T, right: T) => boolean,
): T {
  return useSyncExternalStoreWithSelector(
    store.subscribe,
    store.getSnapshot,
    store.getSnapshot,
    select,
    equal,
  );
}
