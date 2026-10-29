import type { SessionId } from "@nyte-ai/sdk";
import {
  activePane,
  activeSelection,
  orderedPanes,
  paneForSession,
  paneSelection,
  parsePersistedPaneLayout,
  reducePaneLayout,
  serializePaneLayout,
} from "./pane-layout.ts";
import type {
  DropPlacement,
  PaneId,
  PaneLayout,
  PaneLayoutAction,
  SplitDirection,
} from "./pane-layout.ts";
import { SessionViewStateStore, WindowDrafts } from "./session-view-state.ts";
import type { ComposerViewState } from "./session-view-state.ts";

interface LayoutStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface PaneControllerSnapshot {
  readonly layout: PaneLayout;
  readonly focusRequest: { readonly paneId: PaneId; readonly revision: number };
}

type LayoutRoute = (current: PaneLayout, next: PaneLayout) => PaneLayout;

/** Standalone, a controller keeps its own layout and drafts; a window's tab routes both through its window. */
type PaneControllerOptions =
  | { readonly storage?: LayoutStorage; readonly storageKey: string }
  | {
      readonly initialLayout: PaneLayout;
      readonly route: LayoutRoute;
      readonly viewState: SessionViewStateStore;
    };

interface SavedLayout {
  readonly storage: LayoutStorage;
  readonly key: string;
}

function selectedSession(action: PaneLayoutAction): SessionId | undefined {
  if (action.kind === "select" || action.kind === "select-in-pane") {
    return action.selection.kind === "session" ? action.selection.sessionId : undefined;
  }

  return undefined;
}

export class PaneController {
  readonly #saved: SavedLayout | undefined;
  readonly #viewState: SessionViewStateStore;
  readonly #listeners = new Set<() => void>();
  readonly #route: LayoutRoute | undefined;
  #snapshot: PaneControllerSnapshot;

  constructor(options: PaneControllerOptions) {
    if ("route" in options) {
      this.#saved = undefined;
      this.#route = options.route;
      this.#viewState = options.viewState;
    } else {
      const storage = options.storage;
      this.#saved = storage === undefined ? undefined : { storage, key: options.storageKey };
      this.#route = undefined;

      this.#viewState = new SessionViewStateStore(
        new WindowDrafts(
          storage === undefined
            ? undefined
            : { storage, storageKey: `${options.storageKey}:composer-drafts` },
        ),
        "",
      );
    }

    const layout =
      "route" in options ? options.initialLayout : parsePersistedPaneLayout(this.#readLayout());

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

    if (this.#route !== undefined) {
      layout = this.#route(current, layout);

      if (layout === current) return current;
    }

    this.#rememberLayout(layout);

    const focusRequest =
      action.kind !== "resize" && action.kind !== "remove-session"
        ? {
            paneId: activePane(layout).id,
            revision: this.#snapshot.focusRequest.revision + 1,
          }
        : this.#snapshot.focusRequest;

    this.#snapshot = { layout, focusRequest };

    try {
      this.#saved?.storage.setItem(this.#saved.key, serializePaneLayout(layout));
    } catch {}

    for (const listener of this.#listeners) listener();

    return layout;
  }

  show(layout: PaneLayout): void {
    if (layout === this.#snapshot.layout) return;
    this.#rememberLayout(layout);
    this.#snapshot = {
      layout,
      focusRequest: {
        paneId: activePane(layout).id,
        revision: this.#snapshot.focusRequest.revision + 1,
      },
    };

    for (const listener of this.#listeners) listener();
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

    const visible = this.#paneShowingDraft(draftId);

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
    const visible = this.#paneShowingDraft(draftId);

    if (!this.#viewState.removeDraft(draftId)) return layout;

    if (visible !== undefined) this.#requestFocus(visible.id);

    return layout;
  }

  openDraftChat(draftId: string, sessionId: SessionId, composer?: ComposerViewState): void {
    const visible = this.#paneShowingDraft(draftId);

    if (composer !== undefined) {
      const paneId = visible?.id ?? activePane(this.#snapshot.layout).id;
      this.#viewState.updateSession(sessionId, paneId, (state) => ({ ...state, composer }));
    }

    if (visible !== undefined) this.selectSessionInPane(visible.id, sessionId);
    this.#viewState.removeDraft(draftId);
  }

  #paneShowingDraft(draftId: string) {
    return orderedPanes(this.#snapshot.layout).find(
      (pane) =>
        pane.selection.kind === "blank" && this.#viewState.readBlank(pane.id).id === draftId,
    );
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

  removeSessionWithUndo(sessionId: SessionId): () => boolean {
    const previous = this.#snapshot.layout;
    const paneId = paneForSession(previous, sessionId);

    if (paneId === undefined) return () => false;
    const focused = activePane(previous).id;
    this.removeSession(sessionId);
    this.focus(focused);

    return () => {
      const current = this.#snapshot.layout;

      if (paneSelection(current, paneId)?.kind !== "blank") return false;

      const { composer } = this.#viewState.readBlank(paneId);

      if (composer.draft !== "" || composer.attachments.length > 0) return false;
      const active = activePane(current);
      this.selectSessionInPane(paneId, sessionId);
      this.focus(active.selection.kind === "blank" ? focused : active.id);

      return true;
    };
  }

  #readLayout(): string | null {
    try {
      return this.#saved?.storage.getItem(this.#saved.key) ?? null;
    } catch {
      return null;
    }
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
