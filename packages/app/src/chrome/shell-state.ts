/**
 * Window-lifetime chrome state that more than one surface reads: whether the
 * rail is shown and how wide it is, and which non-route stage is active. It
 * lives outside the component tree so the titlebar, the rail, and keyboard
 * chords all steer the same values. The rail width is also written to the root as a CSS
 * variable, so the static boot shell and the mounted rail share one number.
 */
import { useSyncExternalStore } from "react";
import type { SessionId } from "@nyte-ai/protocol";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { AppInfo } from "../bridge.ts";

type WorkspaceStage = { readonly kind: "workspace" };

type CustomizeStage = { readonly kind: "customize"; readonly sessionId: SessionId | undefined };

type EnvironmentsStage = { readonly kind: "environments" };

type ShellStage = WorkspaceStage | CustomizeStage | EnvironmentsStage;

const SIDEBAR_WIDTH_DEFAULT = 220;

export const SIDEBAR_WIDTH_MIN = 214;

export const SIDEBAR_WIDTH_MAX = 400;

export const SIDEBAR_WIDTH_STEP = 8;

const SIDEBAR_KEY = "nyte.desktop.sidebar.v3";

const SIDEBAR_WIDTH_VARIABLE = "--nyte-sidebar-width";

/** A field of the wrong type reads as unset; the record survives. */
const persistedSidebarSchema = Type.Object({
  visible: Type.Optional(Type.Unknown()),
  width: Type.Optional(Type.Unknown()),
  homeVisible: Type.Optional(Type.Unknown()),
});

const widthSchema = Type.Number();

interface ShellState {
  readonly sidebarVisible: boolean;
  readonly sidebarWidth: number;
  readonly homeVisible: boolean;
  readonly stage: ShellStage;
  readonly about: AppInfo | undefined;
}

export function clampSidebarWidth(width: number): number {
  if (!Number.isFinite(width)) return SIDEBAR_WIDTH_DEFAULT;

  return Math.min(SIDEBAR_WIDTH_MAX, Math.max(SIDEBAR_WIDTH_MIN, Math.round(width)));
}

function storage(): Storage | undefined {
  try {
    return window.localStorage;
  } catch {
    return undefined;
  }
}

function readPersisted(): Pick<ShellState, "sidebarVisible" | "sidebarWidth" | "homeVisible"> {
  const fallback = { sidebarVisible: true, sidebarWidth: SIDEBAR_WIDTH_DEFAULT, homeVisible: true };

  try {
    const raw = storage()?.getItem(SIDEBAR_KEY);

    if (raw === null || raw === undefined) return fallback;
    const parsed: unknown = JSON.parse(raw);

    if (!Value.Check(persistedSidebarSchema, parsed)) return fallback;
    const { visible, width } = parsed;

    return {
      sidebarVisible: visible !== false,
      homeVisible: parsed.homeVisible !== false,
      sidebarWidth: Value.Check(widthSchema, width)
        ? clampSidebarWidth(width)
        : SIDEBAR_WIDTH_DEFAULT,
    };
  } catch {
    return fallback;
  }
}

function persist(next: ShellState): void {
  try {
    storage()?.setItem(
      SIDEBAR_KEY,
      JSON.stringify({
        visible: next.sidebarVisible,
        width: next.sidebarWidth,
        homeVisible: next.homeVisible,
      }),
    );
  } catch {
    // The in-memory choice still applies for this window.
  }
}

function applyWidth(width: number): void {
  document.documentElement.style.setProperty(SIDEBAR_WIDTH_VARIABLE, `${String(width)}px`);
}

let state: ShellState = {
  ...readPersisted(),
  stage: { kind: "workspace" },
  about: undefined,
};

applyWidth(state.sidebarWidth);

const listeners = new Set<() => void>();

function publish(next: ShellState): void {
  state = next;

  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);

  return () => {
    listeners.delete(listener);
  };
}

function snapshot(): ShellState {
  return state;
}

type ShellPage = Exclude<ShellStage, WorkspaceStage>;

let pageRoute: ((page: ShellPage | undefined) => void) | undefined;

export const shellActions = Object.freeze({
  showAbout(about: AppInfo | undefined): void {
    publish({ ...state, about });
  },
  setSidebarVisible(visible: boolean): void {
    if (state.sidebarVisible === visible) return;
    const next = { ...state, sidebarVisible: visible };
    persist(next);
    publish(next);
  },
  setHomeVisible(homeVisible: boolean): void {
    if (state.homeVisible === homeVisible) return;
    const next = { ...state, homeVisible };
    persist(next);
    publish(next);
  },
  toggleSidebar(): void {
    shellActions.setSidebarVisible(!state.sidebarVisible);
  },
  setSidebarWidth(width: number): void {
    const sidebarWidth = clampSidebarWidth(width);

    if (state.sidebarWidth === sidebarWidth) return;
    const next = { ...state, sidebarWidth };
    applyWidth(sidebarWidth);
    persist(next);
    publish(next);
  },
  openCustomize(sessionId: SessionId | undefined): void {
    if (pageRoute !== undefined) pageRoute({ kind: "customize", sessionId });
    else applyShellStage({ kind: "customize", sessionId });
  },
  openEnvironments(): void {
    if (pageRoute !== undefined) pageRoute({ kind: "environments" });
    else applyShellStage({ kind: "environments" });
  },
  showWorkspace(): void {
    // The tab knows a page it just opened before the stage, which waits on the route.
    if (pageRoute !== undefined) pageRoute(undefined);
    else if (state.stage.kind !== "workspace") applyShellStage({ kind: "workspace" });
  },
});

/**
 * Window tabs own the stage on the desktop: opening or leaving a page becomes
 * tab navigation, and the stage then follows the route like any other place.
 */
export function routeShellPages(route: (page: ShellPage | undefined) => void): void {
  pageRoute = route;
}

/** Show a stage as the route names it. */
export function applyShellStage(stage: ShellStage): void {
  if (
    stage.kind === state.stage.kind &&
    (stage.kind !== "customize" ||
      (state.stage.kind === "customize" && state.stage.sessionId === stage.sessionId))
  )
    return;
  publish({ ...state, stage });
}

export function useShellState(): ShellState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}

export function subscribeShellStage(listener: (stage: ShellStage) => void): () => void {
  return subscribe(() => listener(state.stage));
}
