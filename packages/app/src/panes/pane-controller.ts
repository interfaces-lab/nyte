import type { ProjectId } from "@nyte-ai/schema";
import type { SessionId } from "@nyte-ai/sdk";
import { layoutPanes } from "./layout.ts";
import type { Layout, LayoutAction, PaneId, SplitDirection } from "./layout.ts";
import type { LayoutStore } from "./layout-store.ts";
import type { PaneContent } from "./pane-kinds.ts";
import {
  activeSelection,
  chatContent,
  chatPanes,
  findSessionTab,
  focusedChat,
  paneForSession,
  showChat,
} from "./pane-layout.ts";
import type { ChatPane, DropPlacement, PaneSelection } from "./pane-layout.ts";
import type { ComposerViewState, SessionViewStateStore } from "./session-view-state.ts";

type Actions = readonly LayoutAction<PaneContent>[];

const BLANK: PaneSelection = { kind: "blank" };

const EDGES = {
  left: { direction: "right", side: "before" },
  right: { direction: "right", side: "after" },
  top: { direction: "down", side: "before" },
  bottom: { direction: "down", side: "after" },
} as const satisfies Record<
  Exclude<DropPlacement, "center">,
  { readonly direction: SplitDirection; readonly side: "before" | "after" }
>;

/**
 * The chat commands of one window tab's layout. Each command that changes what the panes show asks
 * the focused pane to take the keyboard, as does one that finds nothing to change.
 */
export class PaneController {
  readonly #store: LayoutStore;
  readonly #viewState: SessionViewStateStore;

  constructor(options: { readonly store: LayoutStore; readonly viewState: SessionViewStateStore }) {
    this.#store = options.store;
    this.#viewState = options.viewState;
  }

  get store(): LayoutStore {
    return this.#store;
  }

  get viewState(): SessionViewStateStore {
    return this.#viewState;
  }

  readonly subscribe = (listener: () => void): (() => void) => this.#store.subscribe(listener);

  readonly getSnapshot = (): Layout<PaneContent> => this.#store.getSnapshot();

  selectSession(sessionId: SessionId): void {
    this.#show(showChat(this.getSnapshot(), { kind: "session", sessionId }));
  }

  selectSessionInPane(pane: PaneId, sessionId: SessionId): void {
    this.#show(this.#inPane(pane, { kind: "session", sessionId }));
  }

  newChat(project?: ProjectId): void {
    const pane = this.getSnapshot().focus[0];
    this.#viewState.startNewDraft(pane, project);
    this.#showOrFocus(showChat(this.getSnapshot(), BLANK));
  }

  selectDraft(draftId: string): void {
    const visible = this.#paneShowingDraft(draftId);

    if (visible !== undefined) {
      this.#showOrFocus([{ kind: "focus", pane: visible.pane }]);

      return;
    }

    if (!this.#viewState.activateDraft(this.getSnapshot().focus[0], draftId)) return;
    this.#showOrFocus(showChat(this.getSnapshot(), BLANK));
  }

  removeDraft(draftId: string): void {
    const visible = this.#paneShowingDraft(draftId);

    if (!this.#viewState.removeDraft(draftId)) return;

    if (visible !== undefined) this.#store.requestFocus(visible.pane);
  }

  openDraftChat(draftId: string, sessionId: SessionId, composer?: ComposerViewState): void {
    const visible = this.#paneShowingDraft(draftId);

    if (composer !== undefined)
      this.#viewState.updateSession(sessionId, (state) => ({ ...state, composer }));

    if (visible !== undefined) this.selectSessionInPane(visible.pane, sessionId);
    this.#viewState.removeDraft(draftId);
  }

  /** Opens a new chat in a pane after the focused one. */
  split(direction: SplitDirection): void {
    this.#show([
      {
        kind: "open",
        content: chatContent(BLANK),
        place: { kind: "edge", pane: this.getSnapshot().focus[0], direction, side: "after" },
        activate: true,
      },
    ]);
  }

  /** The last pane stays and shows a new chat instead. */
  close(pane: PaneId): void {
    const layout = this.getSnapshot();
    const closing = layoutPanes(layout.root).find((entry) => entry.id === pane);

    if (closing === undefined) return;

    if (layoutPanes(layout.root).length === 1) {
      this.#show(this.#inPane(pane, BLANK));

      return;
    }

    this.#show(closing.tabs.map((tab) => ({ kind: "close", tab: tab.id })));
  }

  focus(pane: PaneId): void {
    this.#show([{ kind: "focus", pane }]);
  }

  /**
   * The center shows the chat in that pane, trading places with the pane already showing it; an
   * edge opens it in a new pane there, or moves the pane already showing it there.
   */
  drop(sessionId: SessionId, pane: PaneId, placement: DropPlacement): void {
    const layout = this.getSnapshot();
    const target = chatPanes(layout).find((entry) => entry.pane === pane);
    const source = findSessionTab(layout, sessionId);

    if (target === undefined || source?.pane === pane) return;
    const selection: PaneSelection = { kind: "session", sessionId };

    if (placement === "center") {
      this.#show(
        source === undefined
          ? this.#inPane(pane, selection)
          : [
              { kind: "set-content", tab: target.tab, content: chatContent(selection) },
              { kind: "set-content", tab: source.tab, content: chatContent(target.selection) },
              { kind: "focus", pane },
            ],
      );

      return;
    }

    const place = { kind: "edge", pane, ...EDGES[placement] } as const;

    this.#show([
      source === undefined
        ? { kind: "open", content: chatContent(selection), place, activate: true }
        : { kind: "move", tab: source.tab, place },
    ]);
  }

  /** Keeps the focus where it was. */
  removeSession(sessionId: SessionId): void {
    const layout = this.getSnapshot();
    const pane = paneForSession(layout, sessionId);

    if (pane === undefined) return;
    this.#store.dispatch(...this.#inPane(pane, BLANK), { kind: "focus", pane: layout.focus[0] });
  }

  removeSessionWithUndo(sessionId: SessionId): () => boolean {
    const previous = this.getSnapshot();
    const pane = paneForSession(previous, sessionId);

    if (pane === undefined) return () => false;
    const focused = previous.focus[0];
    this.removeSession(sessionId);

    return () => {
      const current = this.getSnapshot();
      const shown = chatPanes(current).find((entry) => entry.pane === pane);

      if (shown?.selection.kind !== "blank") return false;

      const composer = this.#viewState.readBlank(pane).composer;

      if (composer.draft !== "" || composer.attachments.length > 0) return false;
      const keep = activeSelection(current).kind === "blank" ? focused : current.focus[0];
      this.#show([
        ...this.#inPane(pane, { kind: "session", sessionId }),
        { kind: "focus", pane: keep },
      ]);

      return true;
    };
  }

  /** Shows `selection` in `pane` and focuses it, or focuses the pane already showing that chat. */
  #inPane(pane: PaneId, selection: PaneSelection): Actions {
    const layout = this.getSnapshot();
    const target = chatPanes(layout).find((entry) => entry.pane === pane);

    if (target === undefined) return [];

    const shown =
      selection.kind === "session" ? paneForSession(layout, selection.sessionId) : undefined;

    if (shown !== undefined) return [{ kind: "focus", pane: shown }];

    return [
      { kind: "set-content", tab: target.tab, content: chatContent(selection) },
      { kind: "focus", pane },
    ];
  }

  #paneShowingDraft(draftId: string): ChatPane | undefined {
    return chatPanes(this.getSnapshot()).find(
      (pane) =>
        pane.selection.kind === "blank" && this.#viewState.readBlank(pane.pane).id === draftId,
    );
  }

  /** Applies the actions; a change asks the focused pane to take the keyboard. */
  #show(actions: Actions): boolean {
    const before = this.getSnapshot();
    this.#store.dispatch(...actions);
    const after = this.getSnapshot();

    if (after === before) return false;
    this.#store.requestFocus(focusedChat(after)?.pane ?? after.focus[0]);

    return true;
  }

  /** As `#show`, and the focused pane takes the keyboard even when nothing changed. */
  #showOrFocus(actions: Actions): void {
    if (!this.#show(actions)) this.#store.requestFocus(this.getSnapshot().focus[0]);
  }
}
