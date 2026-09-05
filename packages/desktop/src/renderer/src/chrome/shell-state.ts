/**
 * Window-lifetime chrome state that more than one surface reads: whether the
 * rail is shown and how wide it is, and which non-route stage is active. It
 * lives outside the component tree so the titlebar, the rail, and keyboard
 * chords all steer the same values. The rail width is also written to the root as a CSS
 * variable, so the static boot shell and the mounted rail share one number.
 */
import { useSyncExternalStore } from "react";
import type { SessionId } from "@nyte-ai/core";
import { Type } from "typebox";
import { Value } from "typebox/value";

type WorkspaceStage = { readonly kind: "workspace" };
type CustomizeStage = { readonly kind: "customize"; readonly sessionId: SessionId | undefined };

export type ShellStage = WorkspaceStage | CustomizeStage;

export const SIDEBAR_WIDTH_DEFAULT = 220;
export const SIDEBAR_WIDTH_MIN = 190;
export const SIDEBAR_WIDTH_MAX = 400;
export const SIDEBAR_WIDTH_STEP = 8;

const SIDEBAR_KEY = "nyte.desktop.sidebar.v3";
const SIDEBAR_WIDTH_VARIABLE = "--nyte-sidebar-width";
/** A field of the wrong type reads as unset; the record survives. */
const persistedSidebarSchema = Type.Object({
  visible: Type.Optional(Type.Unknown()),
  width: Type.Optional(Type.Unknown()),
});
const widthSchema = Type.Number();

interface ShellState {
  readonly sidebarVisible: boolean;
  readonly sidebarWidth: number;
  readonly stage: ShellStage;
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

function readPersisted(): Pick<ShellState, "sidebarVisible" | "sidebarWidth"> {
  const fallback = { sidebarVisible: true, sidebarWidth: SIDEBAR_WIDTH_DEFAULT };
  try {
    const raw = storage()?.getItem(SIDEBAR_KEY);
    if (raw === null || raw === undefined) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (!Value.Check(persistedSidebarSchema, parsed)) return fallback;
    const { visible, width } = parsed;
    return {
      sidebarVisible: visible !== false,
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
      JSON.stringify({ visible: next.sidebarVisible, width: next.sidebarWidth }),
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

export const shellActions = Object.freeze({
  setSidebarVisible(visible: boolean): void {
    if (state.sidebarVisible === visible) return;
    const next = { ...state, sidebarVisible: visible };
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
    if (state.stage.kind === "customize" && state.stage.sessionId === sessionId) return;
    publish({ ...state, stage: { kind: "customize", sessionId } });
  },
  showWorkspace(): void {
    if (state.stage.kind === "workspace") return;
    publish({ ...state, stage: { kind: "workspace" } });
  },
});

export function useShellState(): ShellState {
  return useSyncExternalStore(subscribe, snapshot, snapshot);
}
