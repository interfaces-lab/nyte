import { useSyncExternalStore } from "react";
import type { BrowserDownload, BrowserKey, BrowserSurfaceState, HostEvent } from "../bridge.ts";
import type { WorkbenchController, WorkbenchTabId, WorkbenchViewKey } from "./controller.ts";
import { workbenchController, workbenchViewKey } from "./controller.ts";

interface BrowserSurfaceView {
  readonly state: BrowserSurfaceState | undefined;
  readonly downloads: readonly BrowserDownload[];
  readonly finding: boolean;
  readonly login: { readonly host: string; readonly realm: string } | undefined;
}

const EMPTY: BrowserSurfaceView = Object.freeze({
  state: undefined,
  downloads: [],
  finding: false,
  login: undefined,
});

const DOWNLOADS_SHOWN = 5;

let views: ReadonlyMap<string, BrowserSurfaceView> = new Map();

const listeners = new Set<() => void>();

const keyListeners = new Map<string, (key: BrowserKey) => void>();

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
  event: Extract<
    HostEvent,
    {
      kind: "browser_changed" | "browser_download" | "browser_open_tab" | "browser_login_requested";
    }
  >,
): void {
  const current = views.get(event.surface);
  const tab = browserTab(event.surface);

  if (event.kind === "browser_open_tab") {
    if (tab === undefined) return;
    workbenchController.actions.openTab({
      view: tab.view,
      tab: { kind: "browser", url: event.url },
      activate: !event.background,
    });

    return;
  }

  const held = current ?? EMPTY;
  const owned = current !== undefined || tab !== undefined;

  if (event.kind === "browser_login_requested") {
    if (owned) set(event.surface, { ...held, login: { host: event.host, realm: event.realm } });

    return;
  }

  if (event.kind === "browser_download") {
    if (!owned) return;
    const rest = held.downloads.filter((download) => download.id !== event.download.id);
    set(event.surface, { ...held, downloads: [event.download, ...rest].slice(0, DOWNLOADS_SHOWN) });

    return;
  }

  const { state } = event;

  if (!owned && state.agentHolders === 0) return;
  const login = state.loading ? undefined : held.login;
  set(event.surface, { ...held, state, login });

  if (tab !== undefined && state.url !== "") {
    workbenchController.actions.updateTab({
      view: tab.view,
      id: tab.id,
      kind: "browser",
      patch: { url: state.url },
    });
  }
}

export function dismissDownload(surface: string, id: string): void {
  const current = views.get(surface);

  if (current === undefined) return;
  set(surface, { ...current, downloads: current.downloads.filter((item) => item.id !== id) });
}

export function dismissLogin(surface: string): void {
  const current = views.get(surface);

  if (current?.login !== undefined) set(surface, { ...current, login: undefined });
}

export function setBrowserFinding(surface: string, finding: boolean): void {
  const current = views.get(surface) ?? EMPTY;

  if (current.finding !== finding) set(surface, { ...current, finding });
}

export function onBrowserKey(surface: string, listener: (key: BrowserKey) => void): () => void {
  keyListeners.set(surface, listener);

  return () => {
    if (keyListeners.get(surface) === listener) keyListeners.delete(surface);
  };
}

export function applyBrowserKey(event: Extract<HostEvent, { kind: "browser_key" }>): void {
  keyListeners.get(event.surface)?.(event.key);
}

export function claimBrowserSurface(surface: string): void {
  if (!views.has(surface)) set(surface, EMPTY);
}

export function applyBrowserAgentOpened(
  controller: Pick<WorkbenchController, "actions" | "getView">,
  event: Extract<HostEvent, { kind: "browser_agent_opened" }>,
): void {
  const view = workbenchViewKey(event.owner ?? undefined);
  const existing = controller.getView(view).tabs.find((tab) => tab.kind === "browser");

  if (existing === undefined) {
    controller.actions.openTab({
      view,
      tab: { kind: "browser", url: event.url },
      activate: false,
    });

    return;
  }

  controller.actions.updateTab({
    view,
    id: existing.id,
    kind: "browser",
    patch: { url: event.url },
  });
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
