import type { ModelRef, SessionId, Thinking } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import type { Static, TSchema } from "typebox";
import { Type } from "typebox";
import { Value } from "typebox/value";
import type { ComposerImageAttachment } from "../conversation/composer-files.ts";
import type { PaneId, SplitDirection } from "./pane-layout.ts";

const FLUSH_DEBOUNCE_MS = 200;

const KEPT_SESSION_VIEWS = 64;

const IMAGE_CONTENT = Type.Object({
  type: Type.Literal("image"),
  data: Type.String(),
  mimeType: Type.String(),
});

const strict = { additionalProperties: false };

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

interface SplitViewState {
  readonly direction: SplitDirection;
  readonly ratio: number;
}

interface SessionViewState {
  readonly composer: ComposerViewState;
  readonly scroll: Partial<Record<PaneId, ScrollViewState>>;
  readonly stepGroups: ReadonlyMap<string, boolean>;
  readonly focusedPaneId: PaneId;
  readonly split: SplitViewState | undefined;
}

export interface DraftChoice {
  readonly model: ModelRef;
  readonly thinking: Thinking | undefined;
}

export interface BlankViewState {
  readonly composer: ComposerViewState;
  readonly choice: DraftChoice | undefined;
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

const EDITING: DraftStatus = { kind: "editing" };

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
    scroll: {},
    stepGroups: new Map(),
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

interface PaneDraftState {
  active: ChatDraft;
  readonly parked: Map<string, ChatDraft>;
}

type LocatedDraft =
  | { readonly kind: "active"; readonly paneId: PaneId; readonly draft: ChatDraft }
  | { readonly kind: "parked"; readonly paneId: PaneId; readonly draft: ChatDraft };

interface Persistence {
  readonly storage: Pick<Storage, "getItem" | "setItem" | "removeItem">;
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

const storedDraftSchema = Type.Object(
  { updatedAt: Type.Number(), composer: composerSchema },
  strict,
);

const ownerId = Type.String({ minLength: 1 });

const paneIndexSchema = Type.Object({ active: ownerId, parked: Type.Array(ownerId) }, strict);

const indexSchema = Type.Object(
  {
    panes: Type.Object(
      { primary: Type.Optional(paneIndexSchema), secondary: Type.Optional(paneIndexSchema) },
      strict,
    ),
    sessions: Type.Array(ownerId),
  },
  strict,
);

const attachmentsSchema = Type.Array(
  Type.Object(
    { id: Type.String({ minLength: 1 }), name: Type.String(), content: IMAGE_CONTENT },
    strict,
  ),
);

type PersistedComposer = Static<typeof composerSchema>;

type StoredDraft = Static<typeof storedDraftSchema>;

type StoredIndex = Static<typeof indexSchema>;

type PersistedAttachments = Static<typeof attachmentsSchema>;

type StoredValue = PersistedComposer | StoredDraft | readonly ComposerImageAttachment[];

function composerView(
  composer: PersistedComposer,
  attachments: readonly ComposerImageAttachment[],
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

function contentChanged(left: ComposerViewState, right: ComposerViewState): boolean {
  return left.draft !== right.draft || left.attachments !== right.attachments;
}

function storedChanged(left: ComposerViewState, right: ComposerViewState): boolean {
  return (
    contentChanged(left, right) ||
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

function writeStored(persistence: Persistence, key: string, value: string | undefined): void {
  try {
    if (value === undefined) persistence.storage.removeItem(key);
    else persistence.storage.setItem(key, value);
  } catch {}
}

function readOwner<Schema extends TSchema>(
  persistence: Persistence,
  owner: string,
  schema: Schema,
): { readonly record: Static<Schema>; readonly attachments: PersistedAttachments } | undefined {
  const key = `${persistence.storageKey}:${owner}`;
  const record = parseStored(schema, readStored(persistence, key));

  if (record === undefined) return undefined;

  return {
    record,
    attachments: parseStored(attachmentsSchema, readStored(persistence, `${key}:images`)) ?? [],
  };
}

export class SessionViewStateStore {
  readonly #sessions = new Map<SessionId, SessionViewState>();
  readonly #drafts = new Map<PaneId, PaneDraftState>();
  readonly #listeners = new Set<() => void>();
  readonly #persistence: Persistence | undefined;
  readonly #pending = new Map<string, StoredValue | undefined>();
  #flushTimer: ReturnType<typeof setTimeout> | undefined;
  #publishTimer: ReturnType<typeof setTimeout> | undefined;
  #savedIndex = "";
  #listed: readonly ChatDraft[] | undefined;

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

  readonly listedDrafts = (): readonly ChatDraft[] => {
    this.#listed ??= this.drafts();

    return this.#listed;
  };

  readSession(sessionId: SessionId, paneId: PaneId): SessionViewState {
    return this.#sessions.get(sessionId) ?? defaultSessionViewState(paneId);
  }

  writeSession(sessionId: SessionId, state: SessionViewState): void {
    const known = this.#sessions.get(sessionId);
    const previous = known?.composer ?? DEFAULT_COMPOSER_VIEW_STATE;
    this.#sessions.delete(sessionId);
    this.#sessions.set(sessionId, state);

    if (known === undefined) {
      for (const [id, kept] of this.#sessions) {
        if (this.#sessions.size <= KEPT_SESSION_VIEWS) break;

        if (!composerHasContent(kept.composer)) this.#sessions.delete(id);
      }
    }

    if (storedChanged(previous, state.composer)) {
      this.#save(
        `session:${sessionId}`,
        previous,
        state.composer,
        persistableComposer(state.composer),
      );
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

    const changed = contentChanged(current.composer, state.composer);

    const next: ChatDraft = {
      ...state,
      id: current.id,
      updatedAt: changed ? Date.now() : current.updatedAt,
      status: current.status,
    };

    drafts.active = next;

    if (storedChanged(current.composer, next.composer)) this.#saveDraft(current, next);
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

    this.#save(`draft:${draftId}`, located.draft.composer, DEFAULT_COMPOSER_VIEW_STATE, undefined);
    this.#emit();

    return true;
  }

  readDraft(draftId: string): ChatDraft | undefined {
    return this.#findDraft(draftId)?.draft;
  }

  beginSend(paneId: PaneId, composer: ComposerViewState): DraftStatus | undefined {
    const drafts = this.#draftState(paneId);
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
    this.#saveDraft(current, next);
    this.#emit();

    return status;
  }

  commitSend(draftId: string, waiting: DraftStatus): boolean {
    if (this.#findDraft(draftId)?.draft.status !== waiting) return false;
    this.#setStatus(draftId, { kind: "starting" });

    return true;
  }

  cancelSend(draftId: string): void {
    if (this.#findDraft(draftId)?.draft.status.kind !== "waiting") return;
    this.#setStatus(draftId, EDITING);
  }

  failSend(draftId: string, failure: DraftFailure): void {
    this.#setStatus(draftId, failure);
  }

  #setStatus(draftId: string, status: DraftStatus): void {
    const located = this.#findDraft(draftId);

    if (located === undefined) return;
    const drafts = this.#draftState(located.paneId);
    const next = { ...located.draft, status };

    if (located.kind === "active") drafts.active = next;
    else drafts.parked.set(draftId, next);
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

  #createDraft(): ChatDraft {
    return {
      composer: DEFAULT_COMPOSER_VIEW_STATE,
      choice: undefined,
      id: crypto.randomUUID(),
      updatedAt: Date.now(),
      status: EDITING,
    };
  }

  #restore(): void {
    const persistence = this.#persistence;

    if (persistence === undefined) return;
    const index = parseStored(indexSchema, readStored(persistence, persistence.storageKey));

    if (index === undefined) return;

    const readDraft = (id: string): ChatDraft | undefined => {
      const stored = readOwner(persistence, `draft:${id}`, storedDraftSchema);

      return (
        stored && {
          id,
          updatedAt: stored.record.updatedAt,
          composer: composerView(stored.record.composer, stored.attachments),
          choice: undefined,
          status: EDITING,
        }
      );
    };

    for (const paneId of ["primary", "secondary"] as const) {
      const stored = index.panes[paneId];

      if (stored === undefined) continue;
      const parked = new Map<string, ChatDraft>();

      for (const id of stored.parked) {
        const draft = readDraft(id);

        if (draft !== undefined && draftHasContent(draft) && id !== stored.active) {
          parked.set(id, draft);
        }
      }

      this.#drafts.set(paneId, { active: readDraft(stored.active) ?? this.#createDraft(), parked });
    }

    for (const id of index.sessions) {
      const stored = readOwner(persistence, `session:${id}`, composerSchema);

      if (stored === undefined) continue;
      const composer = composerView(stored.record, stored.attachments);

      if (!composerHasContent(composer)) continue;
      this.#sessions.set(asId<"session">(id), { ...defaultSessionViewState("primary"), composer });
    }
  }

  #saveDraft(previous: ChatDraft, next: ChatDraft): void {
    this.#save(`draft:${next.id}`, previous.composer, next.composer, {
      updatedAt: next.updatedAt,
      composer: persistableComposer(next.composer),
    });

    if (!contentChanged(previous.composer, next.composer)) return;
    clearTimeout(this.#publishTimer);
    this.#publishTimer = setTimeout(this.#emit, FLUSH_DEBOUNCE_MS);
  }

  #save(
    owner: string,
    previous: ComposerViewState,
    next: ComposerViewState,
    record: PersistedComposer | StoredDraft | undefined,
  ): void {
    const persistence = this.#persistence;

    if (persistence !== undefined) {
      const key = `${persistence.storageKey}:${owner}`;
      this.#pending.set(key, composerHasContent(next) ? record : undefined);

      if (previous.attachments !== next.attachments) {
        this.#pending.set(
          `${key}:images`,
          next.attachments.length > 0 ? next.attachments : undefined,
        );
      }
    }

    clearTimeout(this.#flushTimer);
    this.#flushTimer = setTimeout(this.#store, FLUSH_DEBOUNCE_MS);

    if (globalThis.window === undefined) return;
    window.addEventListener("pagehide", this.#store);
    document.addEventListener("visibilitychange", this.#store);
  }

  #flush(): void {
    const persistence = this.#persistence;

    if (persistence === undefined) return;

    for (const [key, value] of this.#pending) {
      writeStored(persistence, key, value === undefined ? undefined : JSON.stringify(value));
    }

    this.#pending.clear();
    const panes: StoredIndex["panes"] = {};

    for (const [paneId, state] of this.#drafts) {
      panes[paneId] = { active: state.active.id, parked: [...state.parked.keys()] };
    }

    const sessions = [...this.#sessions]
      .filter(([, state]) => composerHasContent(state.composer))
      .map(([id]) => id)
      .toSorted();

    const index = JSON.stringify({ panes, sessions } satisfies StoredIndex);

    if (index === this.#savedIndex) return;
    this.#savedIndex = index;
    writeStored(persistence, persistence.storageKey, index);
  }

  readonly #store = (): void => {
    clearTimeout(this.#flushTimer);
    this.#flushTimer = undefined;

    if (globalThis.window !== undefined) {
      window.removeEventListener("pagehide", this.#store);
      document.removeEventListener("visibilitychange", this.#store);
    }

    this.#flush();
  };

  readonly #emit = (): void => {
    clearTimeout(this.#publishTimer);
    this.#publishTimer = undefined;
    this.#store();
    this.#listed = undefined;

    for (const listener of this.#listeners) listener();
  };
}
