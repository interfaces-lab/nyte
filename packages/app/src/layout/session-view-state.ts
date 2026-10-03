import type { SessionId } from "@nyte-ai/protocol";
import { schemas, sessionId } from "@nyte-ai/protocol";
import type { Rect, VirtualItem } from "@tanstack/react-virtual";
import type { Static, TSchema } from "typebox";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { ComposerImageAttachment } from "../conversation/composer-files.ts";
import type { ToolCallDensity } from "../theme/boot.ts";
import type { PaneId, SplitDirection } from "./pane-layout.ts";

const DRAFT_LIST_DEBOUNCE_MS = 200;

/** Sessions whose measured row heights survive a visit; matches the snapshot cache's entry budget. */
const MEASURED_SESSIONS = 12;

const strict = { additionalProperties: false };

export interface ComposerViewState {
  readonly draft: string;
  readonly attachments: readonly ComposerImageAttachment[];
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
  readonly workGroups: ReadonlyMap<string, boolean>;
  readonly focusedPaneId: PaneId;
  readonly split: SplitViewState | undefined;
}

export interface BlankViewState {
  readonly composer: ComposerViewState;
}

export interface ChatDraft extends BlankViewState {
  readonly id: string;
  readonly updatedAt: number;
}

type ClaimedChatDraft = Omit<ChatDraft, "id">;

export const DEFAULT_COMPOSER_VIEW_STATE: ComposerViewState = {
  draft: "",
  attachments: [],
  selectionStart: 0,
  selectionEnd: 0,
  focused: false,
};

function defaultSessionViewState(paneId: PaneId): SessionViewState {
  return {
    composer: DEFAULT_COMPOSER_VIEW_STATE,
    scroll: { top: 0, bottomPinned: true },
    transcript: { measurements: [], viewport: undefined, density: undefined },
    workGroups: new Map(),
    focusedPaneId: paneId,
    split: undefined,
  };
}

function composerHasContent(composer: ComposerViewState): boolean {
  return composer.draft.trim() !== "" || composer.attachments.length > 0;
}

function draftHasContent(draft: BlankViewState): boolean {
  return composerHasContent(draft.composer);
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

const attachmentsSchema = Type.Array(
  Type.Object(
    { id: Type.String({ minLength: 1 }), name: Type.String(), content: schemas.ImageContent },
    strict,
  ),
);

/**
 * Images live under their own key, by draft and session id. Typing rewrites
 * only the text snapshot, and a store too full for an image keeps the text.
 */
const persistedImagesSchema = Type.Object(
  {
    drafts: Type.Record(Type.String({ minLength: 1 }), attachmentsSchema),
    sessions: Type.Record(Type.String({ minLength: 1 }), attachmentsSchema),
  },
  strict,
);

type PersistedComposer = Static<typeof composerSchema>;

type PersistedChatDraft = Static<typeof chatDraftSchema>;

type PersistedSnapshot = Static<typeof persistedSnapshotSchema>;

type PersistedAttachments = Static<typeof attachmentsSchema>;

type PersistedImages = Static<typeof persistedImagesSchema>;

function composerView(
  composer: PersistedComposer,
  attachments: PersistedAttachments = [],
): ComposerViewState {
  const length = composer.draft.length;

  return {
    draft: composer.draft,
    attachments,
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
  };
}

function hydrateDraft(draft: PersistedChatDraft, images: PersistedImages | undefined): ChatDraft {
  return {
    id: draft.id,
    updatedAt: draft.updatedAt,
    composer: composerView(draft.composer, images?.drafts[draft.id]),
  };
}

function persistablePane(state: PaneDraftState): Static<typeof paneDraftsSchema> {
  const parked: PersistedChatDraft[] = [];

  for (const draft of state.parked.values()) {
    if (draftHasContent(draft)) parked.push(persistableDraft(draft));
  }

  return { active: persistableDraft(state.active), parked };
}

function composerChanged(left: ComposerViewState, right: ComposerViewState): boolean {
  return (
    left.draft !== right.draft ||
    left.attachments !== right.attachments ||
    left.selectionStart !== right.selectionStart ||
    left.selectionEnd !== right.selectionEnd
  );
}

function parseStored<Schema extends TSchema>(
  schema: Schema,
  value: string | null,
): Static<Schema> | undefined {
  if (value === null) return undefined;

  try {
    const parsed: unknown = JSON.parse(value);

    return Value.Check(schema, parsed) ? parsed : undefined;
  } catch {
    return undefined;
  }
}

function readStored(persistence: Persistence, key: string): string | null {
  try {
    return persistence.storage.getItem(key);
  } catch {
    return null;
  }
}

function writeStored(persistence: Persistence, key: string, value: string): void {
  try {
    persistence.storage.setItem(key, value);
  } catch {
    // A denied or full local store must not drop the in-memory draft.
  }
}

function imagesKey(persistence: Persistence): string {
  return `${persistence.storageKey}:images`;
}

export class SessionViewStateStore {
  readonly #sessions = new Map<SessionId, SessionViewState>();
  readonly #drafts = new Map<PaneId, PaneDraftState>();
  readonly #listeners = new Set<() => void>();
  readonly #persistence: Persistence | undefined;
  #publishTimer: ReturnType<typeof setTimeout> | undefined;
  #savedImages = "";
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
    const previous = this.#sessions.get(sessionId);

    const measured =
      state.transcript.measurements.length > 0 &&
      previous?.transcript.measurements !== state.transcript.measurements;

    if (measured) this.#sessions.delete(sessionId);
    this.#sessions.set(sessionId, state);

    if (measured) this.#trimMeasurements();

    if (composerChanged(previous?.composer ?? DEFAULT_COMPOSER_VIEW_STATE, state.composer)) {
      this.#persist();
    }
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

    const contentChanged =
      current.composer.draft !== state.composer.draft ||
      current.composer.attachments !== state.composer.attachments;

    const next: ChatDraft = {
      ...state,
      id: current.id,
      updatedAt: contentChanged ? Date.now() : current.updatedAt,
    };

    drafts.active = next;

    if (contentChanged) this.#schedulePublish();

    if (composerChanged(current.composer, next.composer)) this.#persist();
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
      updatedAt: current.composer.draft === composer.draft ? current.updatedAt : Date.now(),
    };

    drafts.active = this.#createDraft(current.id);
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
      id,
      updatedAt: Date.now(),
    };
  }

  /**
   * Row heights are the bulk of a session's view state and only speed up the
   * next visit. Sessions past the recent-measurement budget keep
   * their draft, scroll, and viewport and start the next visit from estimates.
   */
  #trimMeasurements(): void {
    let measured = 0;

    for (const [id, state] of [...this.#sessions].toReversed()) {
      if (state.transcript.measurements.length === 0) continue;
      measured += 1;

      if (measured <= MEASURED_SESSIONS) continue;
      this.#sessions.set(id, {
        ...state,
        transcript: { ...state.transcript, measurements: [] },
      });
    }
  }

  #restore(): void {
    const persistence = this.#persistence;

    if (persistence === undefined) return;

    const persisted = parseStored(
      persistedSnapshotSchema,
      readStored(persistence, persistence.storageKey),
    );

    if (persisted === undefined) return;

    const images = parseStored(
      persistedImagesSchema,
      readStored(persistence, imagesKey(persistence)),
    );

    for (const paneId of ["primary", "secondary"] as const) {
      const stored = persisted.panes[paneId];

      if (stored === undefined) continue;
      const parked = new Map<string, ChatDraft>();

      for (const storedDraft of stored.parked) {
        const draft = hydrateDraft(storedDraft, images);

        if (draftHasContent(draft) && draft.id !== stored.active.id) {
          parked.set(draft.id, draft);
        }
      }

      this.#drafts.set(paneId, { active: hydrateDraft(stored.active, images), parked });
    }

    for (const [id, stored] of Object.entries(persisted.sessions)) {
      const composer = composerView(stored, images?.sessions[id]);

      if (!composerHasContent(composer)) continue;
      this.#sessions.set(sessionId(id), { ...defaultSessionViewState("primary"), composer });
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
      if (!composerHasContent(state.composer)) continue;
      sessions[id] = persistableComposer(state.composer);
    }

    writeStored(
      persistence,
      persistence.storageKey,
      JSON.stringify({ version: 1, panes, sessions } satisfies PersistedSnapshot),
    );
    this.#persistImages(persistence);
  }

  /** Attachment ids stand for the image set; while it holds, its megabytes stay unwritten. */
  #persistImages(persistence: Persistence): void {
    const images: PersistedImages = { drafts: {}, sessions: {} };

    for (const state of this.#drafts.values()) {
      for (const draft of [state.active, ...state.parked.values()]) {
        if (draft.composer.attachments.length === 0) continue;
        images.drafts[draft.id] = [...draft.composer.attachments];
      }
    }

    for (const [id, state] of this.#sessions) {
      if (state.composer.attachments.length === 0) continue;
      images.sessions[id] = [...state.composer.attachments];
    }

    const signature = JSON.stringify(
      [images.drafts, images.sessions].map((owners) =>
        Object.entries(owners).map(([owner, attachments]) => [
          owner,
          attachments.map(({ id }) => id),
        ]),
      ),
    );

    if (signature === this.#savedImages) return;
    this.#savedImages = signature;
    writeStored(persistence, imagesKey(persistence), JSON.stringify(images));
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
