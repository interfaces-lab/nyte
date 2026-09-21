import { useSyncExternalStore } from "react";
import type { BrowserSurfaceState, HostEvent } from "../../../shared/ipc.ts";
import type { WorkbenchTabId, WorkbenchViewKey } from "./controller.ts";
import { workbenchController } from "./controller.ts";

interface BrowserSurfaceView {
  readonly state: BrowserSurfaceState | undefined;
  readonly refusedDownload: string | undefined;
  readonly history: readonly Pick<BrowserSurfaceState, "url" | "title">[];
}

const EMPTY: BrowserSurfaceView = Object.freeze({
  state: undefined,
  refusedDownload: undefined,
  history: [],
});

let views: ReadonlyMap<string, BrowserSurfaceView> = new Map();
const listeners = new Set<() => void>();

function set(surface: string, view: BrowserSurfaceView): void {
  const next = new Map(views);
  next.set(surface, Object.freeze(view));
  views = next;
  for (const listener of listeners) listener();
}

/** The workbench tab whose id names this surface, when one is open. */
function browserTab(
  surface: string,
): { readonly view: WorkbenchViewKey; readonly id: WorkbenchTabId } | undefined {
  for (const [view, state] of workbenchController.getSnapshot().views) {
    const tab = state.tabs.find(
      (candidate) => candidate.id === surface && candidate.kind === "browser",
    );
    if (tab !== undefined) return { view, id: tab.id };
  }
  return undefined;
}

/**
 * A surface's events land while something in the renderer still owns it: a
 * live store entry, a workbench tab named after it, or an agent holding it
 * ahead of any panel. A surface the panel forgot and no tab names is closed or
 * closing in main, and a late event must not write it back.
 */
export function applyBrowserEvent(
  event: Extract<HostEvent, { kind: "browser_changed" | "browser_download_refused" }>,
): void {
  const current = views.get(event.surface);
  const tab = browserTab(event.surface);
  if (event.kind === "browser_download_refused") {
    if (current === undefined && tab === undefined) return;
    set(event.surface, { ...(current ?? EMPTY), refusedDownload: event.url });
    return;
  }
  const { state } = event;
  if (current === undefined && tab === undefined && state.agentHolders === 0) return;
  const held = current ?? EMPTY;
  const refusedDownload = state.loading ? undefined : held.refusedDownload;
  const latest = held.history[0];
  const history =
    !state.loading &&
    state.error === undefined &&
    state.url !== "" &&
    (latest?.url !== state.url || latest.title !== state.title)
      ? [
          { url: state.url, title: state.title },
          ...held.history.filter((entry) => entry.url !== state.url),
        ]
      : held.history;
  set(event.surface, { state, refusedDownload, history });
  if (tab !== undefined && state.url !== "") {
    workbenchController.actions.updateTab({
      view: tab.view,
      id: tab.id,
      kind: "browser",
      patch: { url: state.url },
    });
  }
}

export function dismissRefusedDownload(surface: string): void {
  const current = views.get(surface);
  if (current?.refusedDownload !== undefined)
    set(surface, { ...current, refusedDownload: undefined });
}

export function clearBrowserHistory(): void {
  for (const [surface, view] of views) set(surface, { ...view, history: [] });
}

/**
 * An agent opened a page on a surface. Open the Browser tab for the matching
 * view key so the user sees the page. The page already exists in main — the
 * renderer is only revealing it, not creating a new one.
 */
export function applyBrowserAgentOpened(
  event: Extract<HostEvent, { kind: "browser_agent_opened" }>,
): void {
  // Apply the surface state so the panel adopts the already-live page.
  const current = views.get(event.surface) ?? EMPTY;
  set(event.surface, {
    ...current,
    state: event.state,
    refusedDownload: undefined,
    history: current.history,
  });

  const snapshot = workbenchController.getSnapshot();
  for (const [viewKey] of snapshot.views) {
    if (viewKey === event.surface) {
      const id = workbenchController.actions.openTab({
        view: viewKey,
        tab: { kind: "browser", url: event.url },
        activate: true,
      });
      set(id, {
        ...current,
        state: event.state,
        refusedDownload: undefined,
        history: current.history,
      });
      return;
    }
  }
  // The view may not exist yet (the user never opened this session's pane).
  // That is fine — when they navigate to the session, the controller will
  // create the view and the panel will adopt the surface.
}

export function forgetBrowserSurface(surface: string): void {
  if (!views.has(surface)) return;
  const next = new Map(views);
  next.delete(surface);
  views = next;
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useBrowserSurface(surface: string): BrowserSurfaceView {
  return useSyncExternalStore(
    subscribe,
    () => views.get(surface) ?? EMPTY,
    () => EMPTY,
  );
}
