import { useSyncExternalStore } from "react";
import type { SessionId } from "@nyte-ai/sdk";
import type { ProjectId } from "@nyte-ai/schema";
import type { AppInfo } from "../contract/bridge.ts";
import { elementVariable } from "../lib/element-variable.ts";
import { preferences, SIDEBAR_WIDTH } from "../preferences/index.ts";
import { activeTab } from "./model.ts";
import type { Page } from "./model.ts";
import { windowTabs } from "./window-tabs.ts";

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return preferences.sidebarWidth.get();

  return Math.min(SIDEBAR_WIDTH.max, Math.max(SIDEBAR_WIDTH.min, Math.round(width)));
}

const sidebarWidth = elementVariable(
  "--nyte-sidebar-width",
  `${String(preferences.sidebarWidth.get())}px`,
);

/** A ref for each element that reads the sidebar width. */
export const attachSidebarWidth = sidebarWidth.attach;

export function applySidebarWidth(width: number): void {
  sidebarWidth.set(`${String(width)}px`);
}

preferences.sidebarWidth.subscribe(() => applySidebarWidth(preferences.sidebarWidth.get()));

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

export function useOverlays(): Overlays {
  return useSyncExternalStore(subscribeOverlays, readOverlays, readOverlays);
}

function stagePage(): Page | undefined {
  const view = activeTab(windowTabs.getSnapshot()).view;

  return view.kind === "page" ? view.page : undefined;
}

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
      target: "permanent",
      place: { kind: "customize", section: undefined, sessionId },
    });
  },
  /** Opens a project's page, or the page that creates one. */
  openProject(project: ProjectId | "new"): void {
    windowTabs.dispatch({
      kind: "open",
      target: "permanent",
      place: { kind: "project", section: project, sessionId: undefined },
    });
  },
  showWorkspace(): void {
    windowTabs.dispatch({ kind: "leave-page" });
  },
});
