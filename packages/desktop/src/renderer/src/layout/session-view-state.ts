import type { SessionId } from "@nyte-ai/core";
import type { Rect, VirtualItem } from "@tanstack/react-virtual";
import type { DesktopCatalog } from "../../../shared/ipc.ts";
import type { PaneId, SplitDirection } from "./pane-layout.ts";

const DRAFT_LIST_DEBOUNCE_MS = 200;

export interface ComposerViewState {
  readonly draft: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly focused: boolean;
}

export interface ScrollViewState {
  readonly top: number;
  readonly bottomPinned: boolean;
}

export interface SplitViewState {
  readonly direction: SplitDirection;
  readonly ratio: number;
}

/**
 * What the transcript virtualizer knew when the session was last shown:
 * measured row heights by row key and the scrollport's size. A return visit
 * starts from these instead of estimates, so the first render already holds
 * the rows the reader left and nothing shifts once they measure.
 */
export interface TranscriptViewState {
  readonly measurements: readonly VirtualItem[];
  readonly viewport: Rect | undefined;
}

export interface SessionViewState {
  readonly composer: ComposerViewState;
  readonly scroll: ScrollViewState;
  readonly transcript: TranscriptViewState;
  readonly focusedPaneId: PaneId;
  readonly split: SplitViewState | undefined;
}

export interface BlankViewState {
  readonly composer: ComposerViewState;
  readonly configuration: DesktopCatalog["defaults"] | undefined;
  readonly fastSettings: ReadonlySet<string>;
}

export interface ChatDraft extends BlankViewState {
  readonly id: string;
  readonly updatedAt: number;
}

export const DEFAULT_COMPOSER_VIEW_STATE: ComposerViewState = {
  draft: "",
  selectionStart: 0,
  selectionEnd: 0,
  focused: false,
};

function defaultSessionViewState(paneId: PaneId): SessionViewState {
  return {
    composer: DEFAULT_COMPOSER_VIEW_STATE,
    scroll: { top: 0, bottomPinned: true },
    transcript: { measurements: [], viewport: undefined },
    focusedPaneId: paneId,
    split: undefined,
  };
}

function draftHasContent(draft: BlankViewState): boolean {
  return draft.composer.draft.trim() !== "";
}

export class SessionViewStateStore {
  readonly #sessions = new Map<SessionId, SessionViewState>();
  readonly #activeDrafts = new Map<PaneId, ChatDraft>();
  readonly #drafts = new Map<string, ChatDraft>();
  readonly #listeners = new Set<() => void>();
  #publishTimer: ReturnType<typeof setTimeout> | undefined;
  #revision = 0;

  constructor() {
    this.#replaceDraft("primary");
    this.#replaceDraft("secondary");
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  };

  readonly getSnapshot = (): number => this.#revision;

  readSession(sessionId: SessionId, paneId: PaneId): SessionViewState {
    return this.#sessions.get(sessionId) ?? defaultSessionViewState(paneId);
  }

  writeSession(sessionId: SessionId, state: SessionViewState): void {
    this.#sessions.set(sessionId, state);
  }

  updateSession(
    sessionId: SessionId,
    paneId: PaneId,
    update: (current: SessionViewState) => SessionViewState,
  ): SessionViewState {
    const next = update(this.readSession(sessionId, paneId));
    this.writeSession(sessionId, next);
    return next;
  }

  readBlank(paneId: PaneId): ChatDraft {
    return this.#activeDrafts.get(paneId) ?? this.#replaceDraft(paneId);
  }

  writeBlank(paneId: PaneId, state: BlankViewState): void {
    const current = this.readBlank(paneId);
    if (current === state) return;
    const contentChanged = current.composer.draft !== state.composer.draft;
    const next: ChatDraft = {
      ...state,
      id: current.id,
      updatedAt: contentChanged ? Date.now() : current.updatedAt,
    };
    this.#activeDrafts.set(paneId, next);
    if (draftHasContent(next)) this.#drafts.set(next.id, next);
    else this.#drafts.delete(next.id);
    if (contentChanged) this.#schedulePublish();
  }

  drafts(): readonly ChatDraft[] {
    return [...this.#drafts.values()].toSorted(
      (left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
    );
  }

  startNewDraft(paneId: PaneId): void {
    const current = this.readBlank(paneId);
    if (!draftHasContent(current)) return;
    this.#replaceDraft(paneId);
    this.#emit();
  }

  activateDraft(paneId: PaneId, draftId: string): boolean {
    const draft = this.#drafts.get(draftId);
    if (draft === undefined) return false;
    if (this.readBlank(paneId).id === draftId) return true;
    for (const [otherPaneId, otherDraft] of this.#activeDrafts) {
      if (otherPaneId !== paneId && otherDraft.id === draftId) this.#replaceDraft(otherPaneId);
    }
    this.#activeDrafts.set(paneId, draft);
    this.#emit();
    return true;
  }

  removeDraft(draftId: string): boolean {
    if (!this.#drafts.delete(draftId)) return false;
    for (const [paneId, draft] of this.#activeDrafts) {
      if (draft.id === draftId) this.#replaceDraft(paneId);
    }
    this.#emit();
    return true;
  }

  #replaceDraft(paneId: PaneId): ChatDraft {
    const draft: ChatDraft = {
      composer: DEFAULT_COMPOSER_VIEW_STATE,
      configuration: undefined,
      fastSettings: new Set<string>(),
      id: crypto.randomUUID(),
      updatedAt: Date.now(),
    };
    this.#activeDrafts.set(paneId, draft);
    return draft;
  }

  #schedulePublish(): void {
    if (this.#publishTimer !== undefined) clearTimeout(this.#publishTimer);
    this.#publishTimer = setTimeout(() => this.#emit(), DRAFT_LIST_DEBOUNCE_MS);
  }

  #emit(): void {
    if (this.#publishTimer !== undefined) {
      clearTimeout(this.#publishTimer);
      this.#publishTimer = undefined;
    }
    this.#revision += 1;
    for (const listener of this.#listeners) listener();
  }
}
