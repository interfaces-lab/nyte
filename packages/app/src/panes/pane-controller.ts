import type { ProjectId } from "@nyte-ai/schema";
import type { SessionId } from "@nyte-ai/sdk";
import {
  activePane,
  orderedPanes,
  paneForSession,
  paneSelection,
  reducePaneLayout,
} from "./pane-layout.ts";
import type {
  DropPlacement,
  PaneId,
  PaneLayout,
  PaneLayoutAction,
  SplitDirection,
} from "./pane-layout.ts";
import type { ComposerViewState, SessionViewStateStore } from "./session-view-state.ts";

export interface PaneControllerSnapshot {
  readonly layout: PaneLayout;
  readonly focusRequest: { readonly paneId: PaneId; readonly revision: number };
}

type LayoutRoute = (current: PaneLayout, next: PaneLayout) => PaneLayout;

/** A window tab's panes: its window owns and saves the layout, and `route` hands it each change. */
interface PaneControllerOptions {
  readonly initialLayout: PaneLayout;
  readonly route: LayoutRoute;
  readonly viewState: SessionViewStateStore;
}

export class PaneController {
  readonly #viewState: SessionViewStateStore;
  readonly #listeners = new Set<() => void>();
  readonly #route: LayoutRoute;
  #snapshot: PaneControllerSnapshot;

  constructor(options: PaneControllerOptions) {
    this.#route = options.route;
    this.#viewState = options.viewState;
    this.#snapshot = {
      layout: options.initialLayout,
      focusRequest: { paneId: activePane(options.initialLayout).id, revision: 0 },
    };
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
    const reduced = reducePaneLayout(current, action);

    if (reduced === current) return current;
    const layout = this.#route(current, reduced);

    if (layout === current) return current;

    const focusRequest =
      action.kind !== "resize" && action.kind !== "remove-session"
        ? {
            paneId: activePane(layout).id,
            revision: this.#snapshot.focusRequest.revision + 1,
          }
        : this.#snapshot.focusRequest;

    this.#snapshot = { layout, focusRequest };

    for (const listener of this.#listeners) listener();

    return layout;
  }

  show(layout: PaneLayout): void {
    if (layout === this.#snapshot.layout) return;
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

  newChat(project?: ProjectId): PaneLayout {
    const before = this.#snapshot.layout;
    const paneId = activePane(before).id;
    this.#viewState.startNewDraft(paneId, project);
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

    if (composer !== undefined)
      this.#viewState.updateSession(sessionId, (state) => ({ ...state, composer }));

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

  #requestFocus(paneId: PaneId): void {
    this.#snapshot = {
      ...this.#snapshot,
      focusRequest: { paneId, revision: this.#snapshot.focusRequest.revision + 1 },
    };

    for (const listener of this.#listeners) listener();
  }
}
