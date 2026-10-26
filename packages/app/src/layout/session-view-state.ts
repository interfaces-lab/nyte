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

export type LocatedDraft =
  | {
      readonly kind: "active";
      readonly tabId: string;
      readonly paneId: PaneId;
      readonly draft: ChatDraft;
    }
  | {
      readonly kind: "parked";
      readonly tabId: string;
      readonly paneId: PaneId;
      readonly draft: ChatDraft;
    };

const PANE_IDS = ["primary", "secondary"] as const;

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

const tabPanesSchema = Type.Object(
  { primary: Type.Optional(paneIndexSchema), secondary: Type.Optional(paneIndexSchema) },
  strict,
);

const indexSchema = Type.Object(
  { tabs: Type.Record(Type.String(), tabPanesSchema), sessions: Type.Array(ownerId) },
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

/**
 * A window's composer drafts and chat view state, kept by draft and session id so closing or
 * replacing a tab never strands a draft. Each tab's panes only point at the drafts they show.
 */
export class WindowDrafts {
  readonly sessions = new Map<SessionId, SessionViewState>();
  readonly #panes = new Map<string, Map<PaneId, PaneDraftState>>();
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
  }

  readonly subscribe = (listener: () => void): (() => void) => {
    this.#listeners.add(listener);

    return () => this.#listeners.delete(listener);
  };

  readonly listedDrafts = (): readonly ChatDraft[] => {
    this.#listed ??= this.drafts();

    return this.#listed;
  };

  /** Every draft with content in the window, newest first. */
  drafts(): readonly ChatDraft[] {
    return [...this.#panes.values()]
      .flatMap((panes) => [...panes.values()])
      .flatMap((state) => [state.active, ...state.parked.values()])
      .filter(draftHasContent)
      .toSorted(
        (left, right) => right.updatedAt - left.updatedAt || left.id.localeCompare(right.id),
      );
  }

  pane(tabId: string, paneId: PaneId): PaneDraftState {
    const panes = this.#panes.get(tabId) ?? new Map<PaneId, PaneDraftState>();
    this.#panes.set(tabId, panes);
    const current = panes.get(paneId);

    if (current !== undefined) return current;
    const created = { active: this.createDraft(), parked: new Map<string, ChatDraft>() };
    panes.set(paneId, created);

    return created;
  }

  find(draftId: string): LocatedDraft | undefined {
    for (const [tabId, panes] of this.#panes) {
      for (const [paneId, state] of panes) {
        if (state.active.id === draftId)
          return { kind: "active", tabId, paneId, draft: state.active };

        const parked = state.parked.get(draftId);

        if (parked !== undefined) return { kind: "parked", tabId, paneId, draft: parked };
      }
    }

    return undefined;
  }

  createDraft(): ChatDraft {
    return {
      composer: DEFAULT_COMPOSER_VIEW_STATE,
      choice: undefined,
      id: crypto.randomUUID(),
      updatedAt: Date.now(),
      status: EDITING,
    };
  }

  saveDraft(previous: ChatDraft, next: ChatDraft): void {
    this.save(`draft:${next.id}`, previous.composer, next.composer, {
      updatedAt: next.updatedAt,
      composer: persistableComposer(next.composer),
    });

    if (!contentChanged(previous.composer, next.composer)) return;
    clearTimeout(this.#publishTimer);
    this.#publishTimer = setTimeout(this.emit, FLUSH_DEBOUNCE_MS);
  }

  save(
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

  readonly emit = (): void => {
    clearTimeout(this.#publishTimer);
    this.#publishTimer = undefined;
    this.#store();
    this.#listed = undefined;

    for (const listener of this.#listeners) listener();
  };

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

    for (const [tabId, panes] of Object.entries(index.tabs)) {
      for (const paneId of PANE_IDS) {
        const stored = panes[paneId];

        if (stored === undefined) continue;
        const parked = new Map<string, ChatDraft>();

        for (const id of stored.parked) {
          const draft = readDraft(id);

          if (draft !== undefined && draftHasContent(draft) && id !== stored.active) {
            parked.set(id, draft);
          }
        }

        const restored = this.#panes.get(tabId) ?? new Map<PaneId, PaneDraftState>();
        restored.set(paneId, { active: readDraft(stored.active) ?? this.createDraft(), parked });
        this.#panes.set(tabId, restored);
      }
    }

    for (const id of index.sessions) {
      const stored = readOwner(persistence, `session:${id}`, composerSchema);

      if (stored === undefined) continue;
      const composer = composerView(stored.record, stored.attachments);

      if (!composerHasContent(composer)) continue;
      this.sessions.set(asId<"session">(id), { ...defaultSessionViewState("primary"), composer });
    }
  }

  #flush(): void {
    const persistence = this.#persistence;

    if (persistence === undefined) return;

    for (const [key, value] of this.#pending) {
      writeStored(persistence, key, value === undefined ? undefined : JSON.stringify(value));
    }

    this.#pending.clear();
    const tabs: StoredIndex["tabs"] = {};

    for (const [tabId, panes] of this.#panes) {
      const kept: StoredIndex["tabs"][string] = {};

      for (const [paneId, state] of panes) {
        if (draftHasContent(state.active) || state.parked.size > 0)
          kept[paneId] = { active: state.active.id, parked: [...state.parked.keys()] };
      }

      if (kept.primary !== undefined || kept.secondary !== undefined) tabs[tabId] = kept;
    }

    const sessions = [...this.sessions]
      .filter(([, state]) => composerHasContent(state.composer))
      .map(([id]) => id)
      .toSorted();

    const index = JSON.stringify({ tabs, sessions } satisfies StoredIndex);

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

  readSession(sessionId: SessionId, paneId: PaneId): SessionViewState {
    return this.#window.sessions.get(sessionId) ?? defaultSessionViewState(paneId);
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
    paneId: PaneId,
    update: (current: SessionViewState) => SessionViewState,
  ): SessionViewState {
    const next = update(this.readSession(sessionId, paneId));
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

  startNewDraft(paneId: PaneId): void {
    const drafts = this.#window.pane(this.#tabId, paneId);
    const current = drafts.active;

    if (!draftHasContent(current)) return;
    drafts.parked.set(current.id, current);
    drafts.active = this.#window.createDraft();
    this.#window.emit();
  }

  /** Moves a draft into this tab's pane, from wherever in the window it was. */
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
