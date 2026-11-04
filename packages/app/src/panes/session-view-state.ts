import type { ProjectId } from "@nyte-ai/schema";
import type { ImageContent } from "@nyte-ai/schema/model";
import type { ModelRef, SessionId, Thinking } from "@nyte-ai/sdk";
import type { Static } from "typebox";
import { Type } from "typebox";
import type { PaneId } from "./pane-layout.ts";
import type { WindowDrafts } from "../chat/composer/drafts.ts";

const KEPT_SESSION_VIEWS = 64;

export const IMAGE_CONTENT = Type.Object({
  type: Type.Literal("image"),
  data: Type.String(),
  mimeType: Type.String(),
});

export const strict = { additionalProperties: false };

export interface ComposerViewState {
  readonly draft: string;
  readonly attachments: readonly ComposerImageAttachment[];
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly focused: boolean;
}

export type ScrollViewState =
  | { readonly kind: "end" }
  | { readonly kind: "anchor"; readonly key: string; readonly offset: number };

export interface SessionViewState {
  readonly composer: ComposerViewState;
  readonly scroll: Partial<Record<PaneId, ScrollViewState>>;
  readonly stepGroups: ReadonlyMap<string, boolean>;
}

export interface DraftChoice {
  readonly model: ModelRef;
  readonly thinking: Thinking | undefined;
}

export interface BlankViewState {
  readonly composer: ComposerViewState;
  readonly choice: DraftChoice | undefined;
  /** The project the chat starts in; absent for none. */
  readonly project?: ProjectId;
}

export type DraftStatus =
  | { readonly kind: "editing" }
  | { readonly kind: "waiting" }
  | { readonly kind: "starting" }
  | {
      readonly kind: "refused";
      readonly message: string;
      readonly fix: "choose-model" | undefined;
    }
  | { readonly kind: "failed"; readonly cause: string };

export type DraftFailure = Extract<DraftStatus, { kind: "refused" } | { kind: "failed" }>;

export interface ChatDraft extends BlankViewState {
  readonly id: string;
  readonly updatedAt: number;
  readonly status: DraftStatus;
}

export const EDITING: DraftStatus = { kind: "editing" };

export const DEFAULT_COMPOSER_VIEW_STATE: ComposerViewState = {
  draft: "",
  attachments: [],
  selectionStart: 0,
  selectionEnd: 0,
  focused: false,
};

export const DEFAULT_SESSION_VIEW_STATE: SessionViewState = {
  composer: DEFAULT_COMPOSER_VIEW_STATE,
  scroll: {},
  stepGroups: new Map(),
};

export function composerHasContent(composer: ComposerViewState): boolean {
  return composer.draft.trim() !== "" || composer.attachments.length > 0;
}

export function draftHasContent(draft: BlankViewState): boolean {
  return composerHasContent(draft.composer);
}

export const composerSchema = Type.Object(
  {
    draft: Type.String(),
    selectionStart: Type.Integer({ minimum: 0 }),
    selectionEnd: Type.Integer({ minimum: 0 }),
  },
  strict,
);

export type PersistedComposer = Static<typeof composerSchema>;

export function persistableComposer(composer: ComposerViewState): PersistedComposer {
  return {
    draft: composer.draft,
    selectionStart: composer.selectionStart,
    selectionEnd: composer.selectionEnd,
  };
}

export function contentChanged(left: ComposerViewState, right: ComposerViewState): boolean {
  return left.draft !== right.draft || left.attachments !== right.attachments;
}

function storedChanged(left: ComposerViewState, right: ComposerViewState): boolean {
  return (
    contentChanged(left, right) ||
    left.selectionStart !== right.selectionStart ||
    left.selectionEnd !== right.selectionEnd
  );
}

/** One tab's view of its window's drafts: pane ids name that tab's panes. */
export class SessionViewStateStore {
  readonly #window: WindowDrafts;
  readonly #tabId: string;

  constructor(drafts: WindowDrafts, tabId: string) {
    this.#window = drafts;
    this.#tabId = tabId;
  }

  readonly subscribe = (listener: () => void): (() => void) => this.#window.subscribe(listener);

  readonly listedDrafts = (): readonly ChatDraft[] => this.#window.listedDrafts();

  readSession(sessionId: SessionId): SessionViewState {
    return this.#window.sessions.get(sessionId) ?? DEFAULT_SESSION_VIEW_STATE;
  }

  writeSession(sessionId: SessionId, state: SessionViewState): void {
    const sessions = this.#window.sessions;
    const known = sessions.get(sessionId);
    const previous = known?.composer ?? DEFAULT_COMPOSER_VIEW_STATE;
    sessions.delete(sessionId);
    sessions.set(sessionId, state);

    if (known === undefined) {
      for (const [id, kept] of sessions) {
        if (sessions.size <= KEPT_SESSION_VIEWS) break;

        if (!composerHasContent(kept.composer)) sessions.delete(id);
      }
    }

    if (storedChanged(previous, state.composer)) {
      this.#window.save(
        `session:${sessionId}`,
        previous,
        state.composer,
        persistableComposer(state.composer),
      );
    }
  }

  updateSession(
    sessionId: SessionId,
    update: (current: SessionViewState) => SessionViewState,
  ): SessionViewState {
    const next = update(this.readSession(sessionId));
    this.writeSession(sessionId, next);

    return next;
  }

  readBlank(paneId: PaneId): ChatDraft {
    return this.#window.pane(this.#tabId, paneId).active;
  }

  writeBlank(paneId: PaneId, state: BlankViewState): void {
    const drafts = this.#window.pane(this.#tabId, paneId);
    const current = drafts.active;

    if (current === state) return;

    const changed = contentChanged(current.composer, state.composer);

    const next: ChatDraft = {
      ...state,
      id: current.id,
      updatedAt: changed ? Date.now() : current.updatedAt,
      status: current.status,
    };

    drafts.active = next;

    if (storedChanged(current.composer, next.composer)) this.#window.saveDraft(current, next);
  }

  drafts(): readonly ChatDraft[] {
    return this.#window.drafts();
  }

  /** Shows a new chat in `paneId` that starts in `project`, parking the draft there when it has content. */
  startNewDraft(paneId: PaneId, project?: ProjectId): void {
    const drafts = this.#window.pane(this.#tabId, paneId);
    const current = drafts.active;
    const kept = !draftHasContent(current);

    if (kept && current.project === project) return;

    if (!kept) drafts.parked.set(current.id, current);
    drafts.active = { ...(kept ? current : this.#window.createDraft()), project };
    this.#window.emit();
  }

  activateDraft(paneId: PaneId, draftId: string): boolean {
    const located = this.#window.find(draftId);

    if (located === undefined || !draftHasContent(located.draft)) return false;

    if (located.kind === "active" && located.tabId === this.#tabId && located.paneId === paneId)
      return true;

    const target = this.#window.pane(this.#tabId, paneId);

    if (draftHasContent(target.active)) {
      target.parked.set(target.active.id, target.active);
    }

    const source = this.#window.pane(located.tabId, located.paneId);

    if (located.kind === "active") {
      source.active = this.#window.createDraft();
    } else {
      source.parked.delete(draftId);
    }

    target.active = located.draft;
    this.#window.emit();

    return true;
  }

  removeDraft(draftId: string): boolean {
    const located = this.#window.find(draftId);

    if (located === undefined) return false;
    const drafts = this.#window.pane(located.tabId, located.paneId);

    if (located.kind === "active") {
      drafts.active = this.#window.createDraft();
    } else {
      drafts.parked.delete(draftId);
    }

    this.#window.save(
      `draft:${draftId}`,
      located.draft.composer,
      DEFAULT_COMPOSER_VIEW_STATE,
      undefined,
    );
    this.#window.emit();

    return true;
  }

  readDraft(draftId: string): ChatDraft | undefined {
    return this.#window.find(draftId)?.draft;
  }

  beginSend(paneId: PaneId, composer: ComposerViewState): DraftStatus | undefined {
    const drafts = this.#window.pane(this.#tabId, paneId);
    const current = drafts.active;

    if (current.status.kind === "waiting" || current.status.kind === "starting") return undefined;
    const status: DraftStatus = { kind: "waiting" };

    const next: ChatDraft = {
      ...current,
      composer,
      status,
      updatedAt: current.composer.draft === composer.draft ? current.updatedAt : Date.now(),
    };

    drafts.active = next;
    this.#window.saveDraft(current, next);
    this.#window.emit();

    return status;
  }

  commitSend(draftId: string, waiting: DraftStatus): boolean {
    if (this.#window.find(draftId)?.draft.status !== waiting) return false;
    this.#setStatus(draftId, { kind: "starting" });

    return true;
  }

  cancelSend(draftId: string): void {
    if (this.#window.find(draftId)?.draft.status.kind !== "waiting") return;
    this.#setStatus(draftId, EDITING);
  }

  failSend(draftId: string, failure: DraftFailure): void {
    this.#setStatus(draftId, failure);
  }

  #setStatus(draftId: string, status: DraftStatus): void {
    const located = this.#window.find(draftId);

    if (located === undefined) return;
    const drafts = this.#window.pane(located.tabId, located.paneId);
    const next = { ...located.draft, status };

    if (located.kind === "active") drafts.active = next;
    else drafts.parked.set(draftId, next);
    this.#window.emit();
  }
}

export interface ComposerImageAttachment {
  readonly id: string;
  readonly name: string;
  readonly content: ImageContent;
}
