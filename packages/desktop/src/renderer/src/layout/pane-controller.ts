import type { SessionId } from "@nyte-ai/protocol";
import {
  activePane,
  activeSelection,
  orderedPanes,
  paneById,
  paneForSession,
  parsePersistedPaneLayout,
  reducePaneLayout,
  serializePaneLayout,
} from "./pane-layout.ts";
import type {
  DropPlacement,
  PaneId,
  PaneLayout,
  PaneLayoutAction,
  PaneSelection,
  SplitDirection,
} from "./pane-layout.ts";
import { SessionViewStateStore } from "./session-view-state.ts";

interface LayoutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
}

export interface PaneControllerSnapshot {
  readonly layout: PaneLayout;
  readonly focusRequest: { readonly paneId: PaneId; readonly revision: number };
}

function actionRequestsFocus(action: PaneLayoutAction): boolean {
  return action.kind !== "resize" && action.kind !== "remove-session";
}

function selectedSession(action: PaneLayoutAction): SessionId | undefined {
  if (action.kind === "select" || action.kind === "select-in-pane") {
    return action.selection.kind === "session" ? action.selection.sessionId : undefined;
  }
  return undefined;
}

export class PaneController {
  readonly #storage: LayoutStorage | undefined;
  readonly #storageKey: string;
  readonly #viewState: SessionViewStateStore;
  readonly #listeners = new Set<() => void>();
  #snapshot: PaneControllerSnapshot;

  constructor({ storage, storageKey }: { storage?: LayoutStorage; storageKey: string }) {
    this.#storage = storage;
    this.#storageKey = storageKey;
    this.#viewState = new SessionViewStateStore(
      storage === undefined ? undefined : { storage, storageKey: `${storageKey}:composer-drafts` },
    );
    let persisted: string | null = null;
    try {
      persisted = storage?.getItem(storageKey) ?? null;
    } catch {
      persisted = null;
    }
    const layout = parsePersistedPaneLayout(persisted);
    this.#snapshot = {
      layout,
      focusRequest: { paneId: activePane(layout).id, revision: 0 },
    };
    this.#rememberLayout(layout);
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly getSnapshot = (): PaneControllerSnapshot => this.#snapshot;

  get viewState(): SessionViewStateStore {
    return this.#viewState;
  }

  dispatch(action: PaneLayoutAction): PaneLayout {
    const current = this.#snapshot.layout;
    this.#rememberLayout(current);
    let layout = reducePaneLayout(current, action);
    const restoredSessionId = selectedSession(action);
    if (layout.kind === "split" && restoredSessionId !== undefined) {
      const restored = this.#viewState.readSession(restoredSessionId, activePane(layout).id).split;
      if (
        restored !== undefined &&
        (layout.direction !== restored.direction || layout.ratio !== restored.ratio)
      ) {
        layout = { ...layout, direction: restored.direction, ratio: restored.ratio };
      }
    }
    if (layout === current) return current;
    this.#rememberLayout(layout);
    const focusRequest = actionRequestsFocus(action)
      ? {
          paneId: activePane(layout).id,
          revision: this.#snapshot.focusRequest.revision + 1,
        }
      : this.#snapshot.focusRequest;
    this.#snapshot = { layout, focusRequest };
    try {
      this.#storage?.setItem(this.#storageKey, serializePaneLayout(layout));
    } catch {
      // A denied or full local store must not break pane navigation.
    }
    for (const listener of this.#listeners) listener();
    return layout;
  }

  syncSelection(selection: PaneSelection): PaneLayout {
    return this.dispatch({ kind: "select", selection });
  }

  selectSession(sessionId: SessionId): PaneLayout {
    return this.dispatch({ kind: "select", selection: { kind: "session", sessionId } });
  }

  selectSessionInPane(paneId: PaneId, sessionId: SessionId): PaneLayout {
    return this.dispatch({
      kind: "select-in-pane",
      paneId,
      selection: { kind: "session", sessionId },
    });
  }

  selectBlank(): PaneLayout {
    return this.dispatch({ kind: "select", selection: { kind: "blank" } });
  }

  newChat(): PaneLayout {
    const before = this.#snapshot.layout;
    const paneId = activePane(before).id;
    this.#viewState.startNewDraft(paneId);
    const layout = this.selectBlank();
    if (layout === before) this.#requestFocus(paneId);
    return layout;
  }

  selectDraft(draftId: string): PaneLayout {
    const before = this.#snapshot.layout;
    const visible = orderedPanes(before).find(
      (pane) =>
        pane.selection.kind === "blank" && this.#viewState.readBlank(pane.id).id === draftId,
    );
    if (visible !== undefined) {
      const layout = this.focus(visible.id);
      if (layout === before) this.#requestFocus(visible.id);
      return layout;
    }
    const paneId = activePane(before).id;
    if (!this.#viewState.activateDraft(paneId, draftId)) return before;
    const layout = this.selectBlank();
    if (layout === before) this.#requestFocus(paneId);
    return layout;
  }

  removeDraft(draftId: string): PaneLayout {
    const layout = this.#snapshot.layout;
    const visible = orderedPanes(layout).find(
      (pane) =>
        pane.selection.kind === "blank" && this.#viewState.readBlank(pane.id).id === draftId,
    );
    if (!this.#viewState.removeDraft(draftId)) return layout;
    if (visible !== undefined) this.#requestFocus(visible.id);
    return layout;
  }

  split(direction: SplitDirection): PaneLayout {
    return this.dispatch({ kind: "split", direction });
  }

  close(paneId: PaneId): PaneLayout {
    return this.dispatch({ kind: "close", paneId });
  }

  focus(paneId: PaneId): PaneLayout {
    return this.dispatch({ kind: "focus", paneId });
  }

  resize(ratio: number): PaneLayout {
    return this.dispatch({ kind: "resize", ratio });
  }

  drop(sessionId: SessionId, targetPaneId: PaneId, placement: DropPlacement): PaneLayout {
    return this.dispatch({
      kind: "drop-session",
      sessionId,
      targetPaneId,
      placement,
    });
  }

  removeSession(sessionId: SessionId): PaneLayout {
    return this.dispatch({ kind: "remove-session", sessionId });
  }

  /** Undo restores only the untouched blank pane, never a newer chat or draft. */
  removeSessionWithUndo(sessionId: SessionId): () => boolean {
    const previous = this.#snapshot.layout;
    const pane = paneForSession(previous, sessionId);
    if (pane === undefined) return () => false;
    const focused = activePane(previous).id;
    this.removeSession(sessionId);
    this.focus(focused);
    const removedPane = paneById(this.#snapshot.layout, pane.id);
    return () => {
      const current = this.#snapshot.layout;
      if (paneById(current, pane.id) !== removedPane) return false;
      if (this.#viewState.readBlank(pane.id).composer.draft !== "") return false;
      const active = activePane(current);
      this.selectSessionInPane(pane.id, sessionId);
      this.focus(active.selection.kind === "blank" ? focused : active.id);
      return true;
    };
  }

  #requestFocus(paneId: PaneId): void {
    this.#snapshot = {
      ...this.#snapshot,
      focusRequest: { paneId, revision: this.#snapshot.focusRequest.revision + 1 },
    };
    for (const listener of this.#listeners) listener();
  }

  #rememberLayout(layout: PaneLayout): void {
    const split =
      layout.kind === "split" ? { direction: layout.direction, ratio: layout.ratio } : undefined;
    const selected = activeSelection(layout);
    for (const pane of orderedPanes(layout)) {
      if (pane.selection.kind !== "session") continue;
      const sessionId = pane.selection.sessionId;
      this.#viewState.updateSession(sessionId, pane.id, (current) => ({
        ...current,
        focusedPaneId:
          selected.kind === "session" && selected.sessionId === sessionId
            ? activePane(layout).id
            : current.focusedPaneId,
        split,
      }));
    }
  }
}
