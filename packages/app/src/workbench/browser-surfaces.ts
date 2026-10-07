import { useSyncExternalStore } from "react";
import type { SessionId } from "@nyte-ai/protocol";
import type { BrowserDownload, BrowserSurfaceState, HostEvent } from "../bridge.ts";
import { nyte } from "../nyte.ts";
import type { WorkbenchTabId, WorkbenchViewKey } from "./controller.ts";
import { workbenchController, workbenchViewKey } from "./controller.ts";

interface BrowserSurfaceView {
  readonly state: BrowserSurfaceState | undefined;
  /** Newest first. A finished download stays until dismissed. */
  readonly downloads: readonly BrowserDownload[];
  readonly history: readonly Pick<BrowserSurfaceState, "url" | "title">[];
  /** The find bar is open; set by Cmd+F from the page or the panel. */
  readonly finding: boolean;
  /** An HTTP authentication challenge waiting for the user. */
  readonly login: { readonly host: string; readonly realm: string } | undefined;
  /** The cookie jar the panel opened this surface in: a workspace path, or null for home. */
  readonly owner: string | null | undefined;
}

const EMPTY: BrowserSurfaceView = Object.freeze({
  state: undefined,
  downloads: [],
  history: [],
  finding: false,
  login: undefined,
  owner: undefined,
});

const DOWNLOADS_SHOWN = 5;

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
  event: Extract<
    HostEvent,
    {
      kind:
        | "browser_changed"
        | "browser_download"
        | "browser_open_tab"
        | "browser_find_requested"
        | "browser_login_requested";
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

  if (event.kind === "browser_find_requested") {
    if (owned) set(event.surface, { ...held, finding: true });

    return;
  }

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
  // A new load ends any challenge the previous one left open.
  const login = state.loading ? undefined : held.login;
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

  set(event.surface, { ...held, state, history, login });

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

export function claimBrowserSurface(surface: string, owner: string | null): void {
  set(surface, { ...(views.get(surface) ?? EMPTY), owner });
}

/** Main clears history per cookie jar, so the displayed history follows the same owner. */
export function clearBrowserHistory(owner: string | null): void {
  for (const [surface, view] of views) {
    if (view.owner === owner) set(surface, { ...view, history: [] });
  }
}

/**
 * An agent opened a page on a surface. Open or update the Browser tab in the
 * workbench of the workspace the page belongs to. The tab is shown only when
 * the agent's chat is the focused one; another chat's page must not displace
 * what the user is viewing.
 */
export function applyBrowserAgentOpened(
  event: Extract<HostEvent, { kind: "browser_agent_opened" }>,
  focusedSession: SessionId | undefined,
): void {
  if (nyte.host.browser === undefined) return;
  const current = views.get(event.surface) ?? EMPTY;
  const revealed = { ...current, state: event.state };
  set(event.surface, revealed);

  const id = workbenchController.actions.openTab({
    view: workbenchViewKey(event.owner ?? undefined),
    tab: { kind: "browser", url: event.url },
    activate: event.session === focusedSession,
  });

  set(id, revealed);
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
