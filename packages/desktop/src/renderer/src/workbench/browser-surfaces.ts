import { useSyncExternalStore } from "react";
import type { BrowserSurfaceState, HostEvent } from "../../../shared/ipc.ts";
import { workbenchController } from "./controller.ts";

export interface BrowserSurfaceView {
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

export function applyBrowserEvent(
  event: Extract<HostEvent, { kind: "browser_changed" | "browser_download_refused" }>,
): void {
  const current = views.get(event.surface) ?? EMPTY;
  if (event.kind === "browser_changed") {
    const { state } = event;
    const refusedDownload = state.loading ? undefined : current.refusedDownload;
    const latest = current.history[0];
    const history =
      !state.loading &&
      state.error === undefined &&
      state.url !== "" &&
      (latest?.url !== state.url || latest.title !== state.title)
        ? [
            { url: state.url, title: state.title },
            ...current.history.filter((entry) => entry.url !== state.url),
          ]
        : current.history;
    set(event.surface, { state, refusedDownload, history });
    // Closed tabs can still receive native events during the surface's close grace period.
    for (const [key, view] of workbenchController.getSnapshot().views) {
      if (key === event.surface && view.openTabs.includes("browser") && state.url !== "") {
        workbenchController.actions.setBrowserUrl(key, state.url);
        break;
      }
    }
    return;
  }
  set(event.surface, { ...current, refusedDownload: event.url });
}

export function dismissRefusedDownload(surface: string): void {
  const current = views.get(surface);
  if (current?.refusedDownload !== undefined)
    set(surface, { ...current, refusedDownload: undefined });
}

export function clearBrowserHistory(): void {
  for (const [surface, view] of views) set(surface, { ...view, history: [] });
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
