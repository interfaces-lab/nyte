import type { ProjectId } from "@nyte-ai/schema";
import type { SessionId } from "@nyte-ai/sdk";
import type { WindowDrafts } from "../chat/composer/drafts.ts";
import type { PaneId } from "../panes/layout.ts";
import type { LayoutStore } from "../panes/layout-store.ts";
import type { PaneCommand, PaneFocus } from "../panes/pane-commands.ts";
import { chatPanes, paneForSession } from "../panes/pane-layout.ts";
import type { ChatPane, PaneSelection } from "../panes/pane-layout.ts";
import { SessionViewStateStore } from "../panes/session-view-state.ts";
import type { ComposerViewState } from "../panes/session-view-state.ts";
import { focusRequests, reduce, shownLayout } from "./model.ts";
import type { WindowAction, WindowState } from "./model.ts";

const BLANK: PaneSelection = { kind: "blank" };

const newId = (): string => crypto.randomUUID();

/** One tab's panes, as the pane context hands them to the components inside it. */
export interface TabPanes {
  readonly window: WindowStore;
  readonly tabId: string;
  readonly layout: LayoutStore;
  readonly viewState: SessionViewStateStore;
}

/**
 * The window's tabs and their panes behind one reducer, with the DOM focus requests each change
 * sends to the panes of a tab. Blank drafts live outside the reducer, so the draft operations
 * compose a draft change with a pane command.
 */
export class WindowStore {
  #state: WindowState;
  readonly #drafts: () => WindowDrafts;
  readonly #listeners = new Set<() => void>();
  readonly #focusListeners = new Set<(tabId: string, pane: PaneId) => void>();

  constructor(state: WindowState, drafts: () => WindowDrafts) {
    this.#state = state;
    this.#drafts = drafts;
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);

    return () => this.#listeners.delete(listener);
  };

  readonly getSnapshot = (): WindowState => this.#state;

  /** Replaces the state without notifying, before anything reads it: the window's saved tabs. */
  restore(state: WindowState): void {
    this.#state = state;
  }

  dispatch(action: WindowAction): void {
    const before = this.#state;

    const after = reduce(before, action, newId, (tabId, pane) =>
      this.viewState(tabId).readBlank(pane),
    );

    this.#state = after;

    if (after !== before) for (const listener of this.#listeners) listener();

    for (const [tabId, pane] of focusRequests(before, after, action))
      this.requestFocus(tabId, pane);
  }

  run(tabId: string, command: PaneCommand, focus?: PaneFocus): void {
    this.dispatch({ kind: "pane", tabId, command, focus });
  }

  onFocusRequest(tabId: string, listener: (pane: PaneId) => void): () => void {
    const scoped = (requested: string, pane: PaneId): void => {
      if (requested === tabId) listener(pane);
    };

    this.#focusListeners.add(scoped);

    return () => this.#focusListeners.delete(scoped);
  }

  requestFocus(tabId: string, pane: PaneId): void {
    for (const listener of this.#focusListeners) listener(tabId, pane);
  }

  viewState(tabId: string): SessionViewStateStore {
    return new SessionViewStateStore(this.#drafts(), tabId);
  }

  tab(tabId: string): TabPanes {
    return {
      window: this,
      tabId,
      viewState: this.viewState(tabId),
      layout: {
        subscribe: this.subscribe,
        getSnapshot: () => shownLayout(this.#state, tabId),
        dispatch: (...actions) => this.dispatch({ kind: "arrange", tabId, actions }),
        onFocusRequest: (listener) => this.onFocusRequest(tabId, listener),
        requestFocus: (pane) => this.requestFocus(tabId, pane),
      },
    };
  }

  newChat(tabId: string, project?: ProjectId): void {
    this.viewState(tabId).startNewDraft(shownLayout(this.#state, tabId).focus[0], project);
    this.run(tabId, { kind: "show", selection: BLANK }, "always");
  }

  selectDraft(tabId: string, draftId: string): void {
    const visible = this.#paneShowingDraft(tabId, draftId);

    if (visible !== undefined) {
      this.run(tabId, { kind: "focus", pane: visible.pane }, "always");

      return;
    }

    const focused = shownLayout(this.#state, tabId).focus[0];

    if (!this.viewState(tabId).activateDraft(focused, draftId)) return;
    this.run(tabId, { kind: "show", selection: BLANK }, "always");
  }

  removeDraft(tabId: string, draftId: string): void {
    const visible = this.#paneShowingDraft(tabId, draftId);

    if (!this.viewState(tabId).removeDraft(draftId)) return;

    if (visible !== undefined) this.requestFocus(tabId, visible.pane);
  }

  openDraftChat(
    tabId: string,
    draftId: string,
    sessionId: SessionId,
    composer?: ComposerViewState,
  ): void {
    const visible = this.#paneShowingDraft(tabId, draftId);
    const viewState = this.viewState(tabId);

    if (composer !== undefined)
      viewState.updateDraft(sessionId, (draft) => ({ ...draft, composer }));

    if (visible !== undefined)
      this.run(tabId, {
        kind: "show-in",
        pane: visible.pane,
        selection: { kind: "session", sessionId },
      });
    viewState.removeDraft(draftId);
  }

  /** Blanks the chat's pane and returns its undo, which reports whether the chat came back. */
  hide(tabId: string, sessionId: SessionId): () => boolean {
    const previous = shownLayout(this.#state, tabId);
    const pane = paneForSession(previous, sessionId);

    if (pane === undefined) return () => false;
    const focused = previous.focus[0];
    this.run(tabId, { kind: "hide", sessionId });

    return () => {
      const before = this.#state;
      this.run(tabId, { kind: "unhide", sessionId, pane, focused });

      return this.#state !== before;
    };
  }

  #paneShowingDraft(tabId: string, draftId: string): ChatPane | undefined {
    const viewState = this.viewState(tabId);

    return chatPanes(shownLayout(this.#state, tabId)).find(
      (pane) => pane.selection.kind === "blank" && viewState.readBlank(pane.pane).id === draftId,
    );
  }
}
