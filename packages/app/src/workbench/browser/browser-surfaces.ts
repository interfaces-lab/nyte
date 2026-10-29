import { useSyncExternalStore } from "react";
import type {
  BrowserBridge,
  BrowserDownload,
  BrowserKey,
  BrowserSurfaceState,
  HostEvent,
} from "../../contract/bridge.ts";
import { errorMessage } from "../../contract/errors.ts";
import { nyte } from "../../contract/nyte.ts";
import { parseWebUrl } from "./browser-address.ts";
import { openUrl } from "../commands.ts";
import { browserSurface } from "../model.ts";
import type { WorkbenchTabId, WorkbenchViewKey } from "../model.ts";
import { workbenchViewKey } from "../paths.ts";
import { workbench } from "../store.ts";
import type { WorkbenchStore } from "../store.ts";

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

function browserTab(
  surface: string,
): { readonly view: WorkbenchViewKey; readonly id: WorkbenchTabId } | undefined {
  for (const [view, state] of workbench.getSnapshot().views) {
    const tab = state.tabs.find(
      (candidate) => candidate.kind === "browser" && browserSurface(candidate) === surface,
    );

    if (tab !== undefined) return { view, id: tab.id };
  }

  return undefined;
}

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
    if (tab !== undefined) openUrl(tab.view, event.url, !event.background);

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

  const state = event.state;

  if (!owned && state.agentHolders === 0) return;
  const login = state.loading ? undefined : held.login;
  set(event.surface, { ...held, state, login });

  if (tab !== undefined && state.url !== "") {
    workbench.dispatch(tab.view, {
      kind: "patch",
      id: tab.id,
      change: { kind: "browser", patch: { url: state.url } },
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

export function browserBridge(): BrowserBridge {
  const browser = nyte.host.browser;

  if (browser === undefined) throw new Error("This host does not provide browser tabs");

  return browser;
}

type BrowserOwner = { readonly kind: "home" } | { readonly kind: "project"; readonly path: string };

/** The surfaces a mounted panel holds; a page opened for a surface since released is not mirrored. */
const held = new Set<string>();

/**
 * Holds `surface` for a mounted panel and opens `url` in it; the surface may already be an
 * agent's page, which then shows as it is. Returns the release.
 */
export function holdBrowserSurface(
  surface: string,
  url: string,
  owner: BrowserOwner,
  failed: (message: string) => void,
): () => void {
  held.add(surface);
  void openBrowserPage(surface, url, owner).then(undefined, (cause: unknown) =>
    failed(errorMessage(cause)),
  );

  return () => {
    held.delete(surface);
    forgetBrowserSurface(surface);
    void browserBridge().close({ surface });
  };
}

/** Points a held surface at `url`; a value that is not a web address opens nothing. */
export async function openBrowserPage(
  surface: string,
  url: string,
  owner: BrowserOwner,
): Promise<void> {
  if (parseWebUrl(url) === undefined) return;

  if (!views.has(surface)) set(surface, EMPTY);
  const state = await browserBridge().open({ surface, url, owner });

  if (held.has(surface)) applyBrowserEvent({ kind: "browser_changed", surface, state });
}

/** Shows an agent's page in its workspace's Browser tab for that page, quietly adding one if none is open. */
export function applyBrowserAgentOpened(
  store: Pick<WorkbenchStore, "dispatch">,
  event: Extract<HostEvent, { kind: "browser_agent_opened" }>,
): void {
  store.dispatch(workbenchViewKey(event.owner ?? undefined), {
    kind: "open",
    tab: { id: crypto.randomUUID(), kind: "browser", url: event.url, surface: event.surface },
    activate: false,
  });
}

function forgetBrowserSurface(surface: string): void {
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
