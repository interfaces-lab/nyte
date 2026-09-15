import type { SessionId } from "@nyte-ai/core";
import type { Rect, VirtualItem } from "@tanstack/react-virtual";
import type { ToolCallDensity } from "../theme/boot.ts";
import type { DesktopCatalog } from "../../../shared/ipc.ts";
import type { PaneId, SplitDirection } from "./pane-layout.ts";

const DRAFT_LIST_DEBOUNCE_MS = 200;

export interface ComposerViewState {
  readonly draft: string;
  readonly selectionStart: number;
  readonly selectionEnd: number;
  readonly focused: boolean;
}

interface ScrollViewState {
  readonly top: number;
  readonly bottomPinned: boolean;
}

interface SplitViewState {
  readonly direction: SplitDirection;
  readonly ratio: number;
}

/**
 * What the transcript virtualizer knew when the session was last shown:
 * measured row heights by row key and the scrollport's size. A return visit
 * starts from these instead of estimates, so the first render already holds
 * the rows the reader left and nothing shifts once they measure.
 */
interface TranscriptViewState {
  readonly measurements: readonly VirtualItem[];
  readonly viewport: Rect | undefined;
  /** The density these heights were measured under; a switch discards them. */
  readonly density: ToolCallDensity | undefined;
}

interface SessionViewState {
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

type ClaimedChatDraft = Omit<ChatDraft, "id">;

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
    transcript: { measurements: [], viewport: undefined, density: undefined },
    focusedPaneId: paneId,
    split: undefined,
  };
}

function draftHasContent(draft: BlankViewState): boolean {
  return draft.composer.draft.trim() !== "";
}

/** A draft lives in exactly one slot: active or parked under one pane. */
interface PaneDraftState {
  active: ChatDraft;
  readonly parked: Map<string, ChatDraft>;
}

type LocatedDraft =
  | { readonly kind: "active"; readonly paneId: PaneId; readonly draft: ChatDraft }
  | { readonly kind: "parked"; readonly paneId: PaneId; readonly draft: ChatDraft };

export class SessionViewStateStore {
  readonly #sessions = new Map<SessionId, SessionViewState>();
  readonly #drafts = new Map<PaneId, PaneDraftState>();
  readonly #listeners = new Set<() => void>();
  #publishTimer: ReturnType<typeof setTimeout> | undefined;
  #revision = 0;

  constructor() {
    this.#draftState("primary");
    this.#draftState("secondary");
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
    return this.#draftState(paneId).active;
  }

  writeBlank(paneId: PaneId, state: BlankViewState): void {
    const drafts = this.#draftState(paneId);
    const current = drafts.active;
    if (current === state) return;
    const contentChanged = current.composer.draft !== state.composer.draft;
    const next: ChatDraft = {
      ...state,
      id: current.id,
      updatedAt: contentChanged ? Date.now() : current.updatedAt,
    };
    drafts.active = next;
    if (contentChanged) this.#schedulePublish();
  }

  drafts(): readonly ChatDraft[] {
    const drafts: ChatDraft[] = [];
    for (const state of this.#drafts.values()) {
      if (draftHasContent(state.active)) drafts.push(state.active);
      for (const parked of state.parked.values()) {
        if (draftHasContent(parked)) drafts.push(parked);
      }
    }
    return drafts.toSorted(
      (left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
    );
  }

  startNewDraft(paneId: PaneId): void {
    const drafts = this.#draftState(paneId);
    const current = drafts.active;
    if (!draftHasContent(current)) return;
    drafts.parked.set(current.id, current);
    drafts.active = this.#createDraft();
    this.#emit();
  }

  activateDraft(paneId: PaneId, draftId: string): boolean {
    const located = this.#findDraft(draftId);
    if (located === undefined || !draftHasContent(located.draft)) return false;
    if (located.kind === "active" && located.paneId === paneId) return true;

    const target = this.#draftState(paneId);
    if (draftHasContent(target.active)) {
      target.parked.set(target.active.id, target.active);
    }
    if (located.kind === "active") {
      this.#draftState(located.paneId).active = this.#createDraft();
    } else {
      this.#draftState(located.paneId).parked.delete(draftId);
    }
    target.active = located.draft;
    this.#emit();
    return true;
  }

  removeDraft(draftId: string): boolean {
    const located = this.#findDraft(draftId);
    if (located === undefined) return false;
    const drafts = this.#draftState(located.paneId);
    if (located.kind === "active") {
      drafts.active = this.#createDraft();
    } else {
      drafts.parked.delete(draftId);
    }
    this.#emit();
    return true;
  }

  takeBlank(paneId: PaneId, composer: ComposerViewState): ClaimedChatDraft {
    const drafts = this.#draftState(paneId);
    const current = drafts.active;
    const submitted: ClaimedChatDraft = {
      composer,
      configuration: current.configuration,
      fastSettings: current.fastSettings,
      updatedAt: current.composer.draft === composer.draft ? current.updatedAt : Date.now(),
    };
    // Sending is not a reason to drop the model the reader chose: the pane's
    // next chat keeps it, and the catalog default applies only before a pick.
    drafts.active = {
      ...this.#createDraft(current.id),
      configuration: current.configuration,
      fastSettings: current.fastSettings,
    };
    this.#emit();
    return submitted;
  }

  restoreBlank(paneId: PaneId, submitted: ClaimedChatDraft): void {
    const drafts = this.#draftState(paneId);
    if (!draftHasContent(drafts.active)) {
      drafts.active = { ...submitted, id: drafts.active.id, updatedAt: Date.now() };
    } else if (draftHasContent(submitted)) {
      const parked = { ...submitted, id: crypto.randomUUID(), updatedAt: Date.now() };
      drafts.parked.set(parked.id, parked);
    }
    this.#emit();
  }

  #draftState(paneId: PaneId): PaneDraftState {
    const current = this.#drafts.get(paneId);
    if (current !== undefined) return current;
    const created = { active: this.#createDraft(), parked: new Map<string, ChatDraft>() };
    this.#drafts.set(paneId, created);
    return created;
  }

  #findDraft(draftId: string): LocatedDraft | undefined {
    for (const [paneId, state] of this.#drafts) {
      if (state.active.id === draftId) {
        return { kind: "active", paneId, draft: state.active };
      }
      const parked = state.parked.get(draftId);
      if (parked !== undefined) return { kind: "parked", paneId, draft: parked };
    }
    return undefined;
  }

  #createDraft(id: string = crypto.randomUUID()): ChatDraft {
    return {
      composer: DEFAULT_COMPOSER_VIEW_STATE,
      configuration: undefined,
      fastSettings: new Set<string>(),
      id,
      updatedAt: Date.now(),
    };
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
