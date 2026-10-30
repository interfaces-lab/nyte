import type { Static, TSchema } from "typebox";
import { Type } from "typebox";
import type { PaneId } from "../../panes/pane-layout.ts";
import {
  type ChatDraft,
  type ComposerImageAttachment,
  type ComposerViewState,
  IMAGE_CONTENT,
  type PersistedComposer,
  composerSchema,
  strict,
  DEFAULT_COMPOSER_VIEW_STATE,
  EDITING,
  type SessionViewState,
  composerHasContent,
  contentChanged,
  defaultSessionViewState,
  draftHasContent,
  persistableComposer,
} from "../../panes/session-view-state.ts";
import type { SessionId } from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import { readStored, removeStored, type StorageArea, writeStored } from "../../lib/storage.ts";

const FLUSH_DEBOUNCE_MS = 200;

/** One pasted screenshot can fill the storage quota, so a larger image is kept in memory only. */
const STORED_IMAGE_LIMIT = 256 * 1024;

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
  readonly storage: StorageArea;
  readonly storageKey: string;
}

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

function readOwner<Schema extends TSchema>(
  persistence: Persistence,
  owner: string,
  schema: Schema,
): { readonly record: Static<Schema>; readonly attachments: PersistedAttachments } | undefined {
  const key = `${persistence.storageKey}:${owner}`;
  const record = readStored(persistence.storage, key, schema, undefined);

  if (record === undefined) return undefined;

  return {
    record,
    attachments: readStored(persistence.storage, `${key}:images`, attachmentsSchema, []),
  };
}

/** Drafts are kept by draft and session id, not by tab, so closing or replacing a tab never strands one. */
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
        const stored = next.attachments.filter(
          (image) => image.content.data.length <= STORED_IMAGE_LIMIT,
        );

        this.#pending.set(`${key}:images`, stored.length > 0 ? stored : undefined);
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
    const index = readStored(persistence.storage, persistence.storageKey, indexSchema, undefined);

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

  /** An entry leaves the queue before its write, so a value the storage refuses throws once instead of blocking every later draft. */
  #flush(): void {
    const persistence = this.#persistence;

    if (persistence === undefined) return;

    for (const [key, value] of this.#pending) {
      this.#pending.delete(key);

      if (value === undefined) removeStored(persistence.storage, key);
      else writeStored(persistence.storage, key, value);
    }

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

    const index = { tabs, sessions } satisfies StoredIndex;
    const serialized = JSON.stringify(index);

    if (serialized === this.#savedIndex) return;
    writeStored(persistence.storage, persistence.storageKey, index);
    this.#savedIndex = serialized;
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
