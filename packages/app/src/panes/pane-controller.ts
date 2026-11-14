import type { ProjectId } from "@nyte-ai/schema";
import type { SessionId } from "@nyte-ai/sdk";
import type { Layout, PaneId, SplitDirection } from "./layout.ts";
import type { LayoutStore } from "./layout-store.ts";
import { focusRequest, planPane } from "./pane-commands.ts";
import type { PaneCommand, PaneFocus, PanePlan } from "./pane-commands.ts";
import type { PaneContent } from "./pane-kinds.ts";
import { chatPanes, paneForSession } from "./pane-layout.ts";
import type { ChatPane, DropPlacement, PaneSelection } from "./pane-layout.ts";
import type { ComposerViewState, SessionViewStateStore } from "./session-view-state.ts";

const BLANK: PaneSelection = { kind: "blank" };

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
    this.#run({ kind: "show", selection: { kind: "session", sessionId } });
  }

  selectSessionInPane(pane: PaneId, sessionId: SessionId): void {
    this.#run({ kind: "show-in", pane, selection: { kind: "session", sessionId } });
  }

  newChat(project?: ProjectId): void {
    const pane = this.getSnapshot().focus[0];
    this.#viewState.startNewDraft(pane, project);
    this.#run({ kind: "show", selection: BLANK }, "always");
  }

  selectDraft(draftId: string): void {
    const visible = this.#paneShowingDraft(draftId);

    if (visible !== undefined) {
      this.#run({ kind: "focus", pane: visible.pane }, "always");

      return;
    }

    if (!this.#viewState.activateDraft(this.getSnapshot().focus[0], draftId)) return;
    this.#run({ kind: "show", selection: BLANK }, "always");
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

  split(direction: SplitDirection): void {
    this.#run({ kind: "split", direction });
  }

  close(pane: PaneId): void {
    this.#run({ kind: "close", pane });
  }

  focus(pane: PaneId): void {
    this.#run({ kind: "focus", pane });
  }

  drop(sessionId: SessionId, pane: PaneId, placement: DropPlacement): void {
    this.#run({ kind: "drop", sessionId, pane, placement });
  }

  removeSessionWithUndo(sessionId: SessionId): () => boolean {
    const previous = this.getSnapshot();
    const pane = paneForSession(previous, sessionId);

    if (pane === undefined) return () => false;
    const focused = previous.focus[0];
    this.#run({ kind: "hide", sessionId });

    return () => this.#run({ kind: "unhide", sessionId, pane, focused }).actions.length > 0;
  }

  #paneShowingDraft(draftId: string): ChatPane | undefined {
    return chatPanes(this.getSnapshot()).find(
      (pane) =>
        pane.selection.kind === "blank" && this.#viewState.readBlank(pane.pane).id === draftId,
    );
  }

  #run(command: PaneCommand, focus?: PaneFocus): PanePlan {
    const before = this.getSnapshot();
    const planned = planPane(before, command, (pane) => this.#viewState.readBlank(pane));
    const plan = focus === undefined ? planned : { ...planned, focus };
    this.#store.dispatch(...plan.actions);
    const pane = focusRequest(before, this.getSnapshot(), plan);

    if (pane !== undefined) this.#store.requestFocus(pane);

    return plan;
  }
}
