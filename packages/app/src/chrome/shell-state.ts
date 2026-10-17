/**
 * Window chrome that more than one surface steers: the rail, the About
 * dialog, the search palette, and the page that covers the stage. The rail's visibility and width
 * are preferences; its width is also written to the root as a CSS variable, so
 * the static boot shell and the mounted rail share one number. The covering
 * page is the active tab's view, so opening or leaving one is tab navigation.
 */
import { useSyncExternalStore } from "react";
import type { SessionId } from "@nyte-ai/sdk";
import type { AppInfo } from "../bridge.ts";
import { preferences, SIDEBAR_WIDTH } from "../preferences/index.ts";
import { activeTab, currentView } from "../tabs/model.ts";
import type { Page } from "../tabs/model.ts";
import { windowTabs } from "../tabs/window-tabs.ts";

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return preferences.sidebarWidth.get();

  return Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, Math.round(width)));
}

/** Show a width on the rail without keeping it, as a drag does until release. */
export function applySidebarWidth(width: number): void {
  document.documentElement.style.setProperty("--nyte-sidebar-width", `${String(width)}px`);
}

applySidebarWidth(preferences.sidebarWidth.get());

preferences.sidebarWidth.subscribe(() => applySidebarWidth(preferences.sidebarWidth.get()));

/** What the window shows over its stage for a moment: About, or the search palette. */
interface Overlays {
  readonly about: AppInfo | undefined;
  readonly search: boolean;
}

let overlays: Overlays = { about: undefined, search: false };

const overlayListeners = new Set<() => void>();

function subscribeOverlays(listener: () => void): () => void {
  overlayListeners.add(listener);

  return () => {
    overlayListeners.delete(listener);
  };
}

function readOverlays(): Overlays {
  return overlays;
}

function showOverlays(next: Overlays): void {
  if (next.about === overlays.about && next.search === overlays.search) return;
  overlays = next;

  for (const listener of overlayListeners) listener();
}

/** The About dialog's details while it is open, and whether search is open. */
export function useOverlays(): Overlays {
  return useSyncExternalStore(subscribeOverlays, readOverlays, readOverlays);
}

function stagePage(): Page | undefined {
  const view = currentView(activeTab(windowTabs.getSnapshot()));

  return view.kind === "page" ? view.page : undefined;
}

/** The page covering the stage in the active tab; undefined while the panes show. */
export function useStagePage(): Page | undefined {
  return useSyncExternalStore(windowTabs.subscribe, stagePage, stagePage);
}

export const shellActions = Object.freeze({
  showAbout(about: AppInfo | undefined): void {
    showOverlays({ ...overlays, about });
  },
  setSearchOpen(search: boolean): void {
    showOverlays({ ...overlays, search });
  },
  toggleSearch(): void {
    showOverlays({ ...overlays, search: !overlays.search });
  },
  toggleSidebar(): void {
    preferences.sidebarVisible.set(!preferences.sidebarVisible.get());
  },
  setSidebarWidth(width: number): void {
    preferences.sidebarWidth.set(clampSidebarWidth(width));
  },
  openCustomize(sessionId: SessionId | undefined): void {
    windowTabs.dispatch({
      kind: "open",
      target: "here",
      place: { kind: "customize", section: undefined, sessionId },
    });
  },
  openEnvironments(): void {
    windowTabs.dispatch({
      kind: "open",
      target: "here",
      place: { kind: "environments", section: undefined },
    });
  },
  showWorkspace(): void {
    windowTabs.dispatch({ kind: "leave-page" });
  },
});
