import type { SessionId } from "@nyte-ai/protocol";
import { schemas, sessionId } from "@nyte-ai/protocol";
import type { Rect, VirtualItem } from "@tanstack/react-virtual";
import type { Static } from "typebox";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { DesktopCatalog } from "../../../shared/ipc.ts";
import type { ToolCallDensity } from "../theme/boot.ts";
import type { PaneId, SplitDirection } from "./pane-layout.ts";

const DRAFT_LIST_DEBOUNCE_MS = 200;
const strict = { additionalProperties: false };

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

interface Persistence {
  readonly storage: Pick<Storage, "getItem" | "setItem">;
  readonly storageKey: string;
}

const composerSchema = Type.Object(
  {
    draft: Type.String(),
    selectionStart: Type.Integer({ minimum: 0 }),
    selectionEnd: Type.Integer({ minimum: 0 }),
  },
  strict,
);
const chatDraftSchema = Type.Object(
  {
    id: Type.String({ minLength: 1 }),
    updatedAt: Type.Number(),
    composer: composerSchema,
    configuration: Type.Optional(
      Type.Object(
        {
          model: Type.Object(
            { provider: Type.String({ minLength: 1 }), id: Type.String({ minLength: 1 }) },
            strict,
          ),
          thinkingLevel: schemas.ThinkingLevel,
        },
        strict,
      ),
    ),
    fastSettings: Type.Array(Type.String({ minLength: 1 }), { uniqueItems: true }),
  },
  strict,
);
const paneDraftsSchema = Type.Object(
  { active: chatDraftSchema, parked: Type.Array(chatDraftSchema) },
  strict,
);
const persistedSnapshotSchema = Type.Object(
  {
    version: Type.Literal(1),
    panes: Type.Object(
      {
        primary: Type.Optional(paneDraftsSchema),
        secondary: Type.Optional(paneDraftsSchema),
      },
      strict,
    ),
    sessions: Type.Record(Type.String({ minLength: 1 }), composerSchema),
  },
  strict,
);

type PersistedComposer = Static<typeof composerSchema>;
type PersistedChatDraft = Static<typeof chatDraftSchema>;
type PersistedSnapshot = Static<typeof persistedSnapshotSchema>;

function composerView(composer: PersistedComposer): ComposerViewState {
  const length = composer.draft.length;
  return {
    draft: composer.draft,
    selectionStart: Math.min(composer.selectionStart, length),
    selectionEnd: Math.min(composer.selectionEnd, length),
    focused: false,
  };
}

function persistableComposer(composer: ComposerViewState): PersistedComposer {
  return {
    draft: composer.draft,
    selectionStart: composer.selectionStart,
    selectionEnd: composer.selectionEnd,
  };
}

function persistableDraft(draft: ChatDraft): PersistedChatDraft {
  return {
    id: draft.id,
    updatedAt: draft.updatedAt,
    composer: persistableComposer(draft.composer),
    ...(draft.configuration === undefined
      ? {}
      : {
          configuration: {
            model: {
              provider: draft.configuration.model.provider,
              id: draft.configuration.model.id,
            },
            thinkingLevel: draft.configuration.thinkingLevel,
          },
        }),
    fastSettings: [...draft.fastSettings],
  };
}

function hydrateDraft(draft: PersistedChatDraft): ChatDraft {
  return {
    id: draft.id,
    updatedAt: draft.updatedAt,
    composer: composerView(draft.composer),
    configuration: draft.configuration,
    fastSettings: new Set(draft.fastSettings),
  };
}

function persistablePane(state: PaneDraftState): Static<typeof paneDraftsSchema> {
  const parked: PersistedChatDraft[] = [];
  for (const draft of state.parked.values()) {
    if (draftHasContent(draft)) parked.push(persistableDraft(draft));
  }
  return { active: persistableDraft(state.active), parked };
}

function composerTextChanged(left: ComposerViewState, right: ComposerViewState): boolean {
  return (
    left.draft !== right.draft ||
    left.selectionStart !== right.selectionStart ||
    left.selectionEnd !== right.selectionEnd
  );
}

function parsePersistedSnapshot(value: string | null): PersistedSnapshot | undefined {
  if (value === null) return undefined;
  try {
    const parsed: unknown = JSON.parse(value);
    return Value.Check(persistedSnapshotSchema, parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

export class SessionViewStateStore {
  readonly #sessions = new Map<SessionId, SessionViewState>();
  readonly #drafts = new Map<PaneId, PaneDraftState>();
  readonly #listeners = new Set<() => void>();
  readonly #persistence: Persistence | undefined;
  #publishTimer: ReturnType<typeof setTimeout> | undefined;
  #revision = 0;

  constructor(persistence?: Persistence) {
    this.#persistence = persistence;
    this.#restore();
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
    const previous = this.#sessions.get(sessionId)?.composer ?? DEFAULT_COMPOSER_VIEW_STATE;
    this.#sessions.set(sessionId, state);
    if (composerTextChanged(previous, state.composer)) this.#persist();
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
    if (
      composerTextChanged(current.composer, next.composer) ||
      current.configuration !== next.configuration ||
      current.fastSettings !== next.fastSettings
    ) {
      this.#persist();
    }
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

  #restore(): void {
    const persistence = this.#persistence;
    if (persistence === undefined) return;
    let raw: string | null = null;
    try {
      raw = persistence.storage.getItem(persistence.storageKey);
    } catch {
      return;
    }
    const persisted = parsePersistedSnapshot(raw);
    if (persisted === undefined) return;
    for (const paneId of ["primary", "secondary"] as const) {
      const stored = persisted.panes[paneId];
      if (stored === undefined) continue;
      const parked = new Map<string, ChatDraft>();
      for (const storedDraft of stored.parked) {
        const draft = hydrateDraft(storedDraft);
        if (draftHasContent(draft) && draft.id !== stored.active.id) {
          parked.set(draft.id, draft);
        }
      }
      this.#drafts.set(paneId, { active: hydrateDraft(stored.active), parked });
    }
    for (const [id, composer] of Object.entries(persisted.sessions)) {
      if (composer.draft.trim() === "") continue;
      this.#sessions.set(sessionId(id), {
        ...defaultSessionViewState("primary"),
        composer: composerView(composer),
      });
    }
  }

  #schedulePublish(): void {
    if (this.#publishTimer !== undefined) clearTimeout(this.#publishTimer);
    this.#publishTimer = setTimeout(() => this.#emit(), DRAFT_LIST_DEBOUNCE_MS);
  }

  #persist(): void {
    const persistence = this.#persistence;
    if (persistence === undefined) return;
    const panes: PersistedSnapshot["panes"] = {};
    const primary = this.#drafts.get("primary");
    const secondary = this.#drafts.get("secondary");
    if (primary !== undefined) panes.primary = persistablePane(primary);
    if (secondary !== undefined) panes.secondary = persistablePane(secondary);
    const sessions: PersistedSnapshot["sessions"] = {};
    for (const [id, state] of this.#sessions) {
      if (state.composer.draft.trim() === "") continue;
      sessions[id] = persistableComposer(state.composer);
    }
    try {
      persistence.storage.setItem(
        persistence.storageKey,
        JSON.stringify({ version: 1, panes, sessions } satisfies PersistedSnapshot),
      );
    } catch {
      // A denied or full local store must not drop the in-memory draft.
    }
  }

  #emit(): void {
    if (this.#publishTimer !== undefined) {
      clearTimeout(this.#publishTimer);
      this.#publishTimer = undefined;
    }
    this.#persist();
    this.#revision += 1;
    for (const listener of this.#listeners) listener();
  }
}
