import type { Static, TSchema } from "typebox";
import { Type } from "typebox";
import type { PaneId } from "../../panes/layout.ts";
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
  DEFAULT_SESSION_VIEW_STATE,
  draftHasContent,
  draftKept,
  persistableComposer,
} from "../../panes/session-view-state.ts";
import type { SessionId } from "@nyte-ai/sdk";
import { ModelRefType, ThinkingType, asId } from "@nyte-ai/schema";
import { projectId } from "../../data/schemas.ts";
import { readStored, removeStored, type StorageArea, writeStored } from "../../lib/storage.ts";
import { persistedDraft, restorable } from "./composer-draft.ts";
import type { ComposerNotice, SessionDraft } from "./composer-draft.ts";

const FLUSH_DEBOUNCE_MS = 200;

const STORED_IMAGE_LIMIT = 256 * 1024;

/** A chat's stored step groups and thoughts shown live: at most this much JSON, the newest kept. */
const STORED_STEPS_LIMIT = 16 * 1024;

const stepsSchema = Type.Array(Type.Tuple([Type.String({ minLength: 1 }), Type.Boolean()]));

type StoredSteps = Static<typeof stepsSchema>;

/** The newest of `groups` that fit in `STORED_STEPS_LIMIT`, or `undefined` when there are none. */
function storedSteps(groups: ReadonlyMap<string, boolean>): StoredSteps | undefined {
  const entries = [...groups];
  let size = 2;
  let from = entries.length;

  for (; from > 0; from -= 1) {
    size += JSON.stringify(entries[from - 1]).length + 1;

    if (size > STORED_STEPS_LIMIT) break;
  }

  return from === entries.length ? undefined : entries.slice(from);
}

const NO_IMAGES: readonly ComposerImageAttachment[] = [];

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

interface Persistence {
  readonly storage: StorageArea;
  readonly storageKey: string;
}

const storedDraftSchema = Type.Object(
  {
    updatedAt: Type.Number(),
    composer: composerSchema,
    project: Type.Optional(projectId),
    choice: Type.Optional(
      Type.Object({ model: ModelRefType, thinking: Type.Optional(ThinkingType) }, strict),
    ),
  },
  strict,
);

/** A chat's draft with what its Restore Draft notice gives back; a draft stored before it has no `refused`. */
const sessionDraftSchema = Type.Object(
  {
    ...composerSchema.properties,
    refused: Type.Optional(Type.Object({ message: Type.String(), text: Type.String() }, strict)),
  },
  strict,
);

const ownerId = Type.String({ minLength: 1 });

const paneIndexSchema = Type.Object({ active: ownerId, parked: Type.Array(ownerId) }, strict);

const tabPanesSchema = Type.Record(Type.String({ minLength: 1 }), paneIndexSchema);

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

type StoredSession = Static<typeof sessionDraftSchema>;

type StoredValue =
  | PersistedComposer
  | StoredDraft
  | StoredSession
  | readonly ComposerImageAttachment[]
  | StoredSteps;

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
  };
}

/** The images stored for `key`, each small enough to keep, or `undefined` when none is. */
function storedImages(
  attachments: readonly ComposerImageAttachment[],
): readonly ComposerImageAttachment[] | undefined {
  const stored = attachments.filter((image) => image.content.data.length <= STORED_IMAGE_LIMIT);

  return stored.length > 0 ? stored : undefined;
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

export class WindowDrafts {
  readonly sessions = new Map<SessionId, SessionViewState>();
  readonly #panes = new Map<string, Map<PaneId, PaneDraftState>>();
  readonly #listeners = new Set<() => void>();
  readonly #keyed = new Map<string, Set<() => void>>();
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

  /** Calls `listener` on `notify(key)`, so one chat's keystrokes wake only what shows that chat. */
  subscribeKey(key: string, listener: () => void): () => void {
    const listeners = this.#keyed.get(key) ?? new Set<() => void>();
    this.#keyed.set(key, listeners);
    listeners.add(listener);

    return () => {
      listeners.delete(listener);

      if (listeners.size === 0 && this.#keyed.get(key) === listeners) this.#keyed.delete(key);
    };
  }

  notify(key: string): void {
    for (const listener of this.#keyed.get(key) ?? []) listener();
  }

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
    this.save(
      `draft:${next.id}`,
      previous.composer,
      next.composer,
      composerHasContent(next.composer)
        ? {
            updatedAt: next.updatedAt,
            composer: persistableComposer(next.composer),
            project: next.project,
            choice: next.choice,
          }
        : undefined,
    );

    if (!contentChanged(previous.composer, next.composer)) return;
    clearTimeout(this.#publishTimer);
    this.#publishTimer = setTimeout(this.emit, FLUSH_DEBOUNCE_MS);
  }

  /**
   * Stores the chat's draft and, beside it, the text and images its Restore Draft notice gives back,
   * so a reload still offers them; the notice's images are kept as a draft's are.
   */
  saveSession(sessionId: SessionId, previous: SessionDraft, next: SessionDraft): void {
    const after = persistedDraft(next);
    const notice = restorable(next);

    const record: StoredSession | undefined = draftKept(next)
      ? {
          ...persistableComposer(after),
          ...(notice === null || notice.restore === null
            ? {}
            : { refused: { message: notice.message, text: notice.restore.text } }),
        }
      : undefined;

    this.save(`session:${sessionId}`, persistedDraft(previous), after, record);
    const before = restorable(previous)?.restore?.attachments ?? NO_IMAGES;
    const kept = notice?.restore?.attachments ?? NO_IMAGES;
    const persistence = this.#persistence;

    if (persistence === undefined || before === kept) return;
    this.#pending.set(`${persistence.storageKey}:session:${sessionId}:refused`, storedImages(kept));
  }

  /** Stores the chat's step groups and thoughts shown live beside its draft, on the drafts' debounce. */
  saveSteps(sessionId: SessionId, stepGroups: ReadonlyMap<string, boolean>): void {
    const persistence = this.#persistence;

    if (persistence !== undefined)
      this.#pending.set(
        `${persistence.storageKey}:session:${sessionId}:steps`,
        storedSteps(stepGroups),
      );

    this.#schedule();
  }

  save(
    owner: string,
    previous: ComposerViewState,
    next: ComposerViewState,
    record: StoredValue | undefined,
  ): void {
    const persistence = this.#persistence;

    if (persistence !== undefined) {
      const key = `${persistence.storageKey}:${owner}`;
      this.#pending.set(key, record);

      if (previous.attachments !== next.attachments)
        this.#pending.set(`${key}:images`, storedImages(next.attachments));
    }

    this.#schedule();
  }

  #schedule(): void {
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
          choice: stored.record.choice && {
            model: stored.record.choice.model,
            thinking: stored.record.choice.thinking,
          },
          project: stored.record.project,
          status: EDITING,
        }
      );
    };

    for (const [tabId, panes] of Object.entries(index.tabs)) {
      for (const [paneId, stored] of Object.entries(panes)) {
        const parked = new Map<string, ChatDraft>();

        for (const id of stored.parked) {
          const draft = readDraft(id);

          if (draft !== undefined && draftHasContent(draft) && id !== stored.active) {
            parked.set(id, draft);
          }
        }

        const restored = this.#panes.get(tabId) ?? new Map<PaneId, PaneDraftState>();
        restored.set(asId<"pane">(paneId), {
          active: readDraft(stored.active) ?? this.createDraft(),
          parked,
        });
        this.#panes.set(tabId, restored);
      }
    }

    for (const id of index.sessions) {
      const stored = readOwner(persistence, `session:${id}`, sessionDraftSchema);

      const stepGroups = new Map(
        readStored(
          persistence.storage,
          `${persistence.storageKey}:session:${id}:steps`,
          stepsSchema,
          [],
        ),
      );

      if (stored === undefined) {
        if (stepGroups.size > 0)
          this.sessions.set(asId<"session">(id), { ...DEFAULT_SESSION_VIEW_STATE, stepGroups });
        continue;
      }

      const refused = stored.record.refused;

      const notice: ComposerNotice | null =
        refused === undefined
          ? null
          : {
              kind: "error",
              message: refused.message,
              restore: {
                text: refused.text,
                attachments: readStored(
                  persistence.storage,
                  `${persistence.storageKey}:session:${id}:refused`,
                  attachmentsSchema,
                  [],
                ),
              },
            };

      const draft = {
        composer: composerView(stored.record, stored.attachments),
        edit: null,
        notice,
      };

      if (!draftKept(draft) && stepGroups.size === 0) continue;
      this.sessions.set(asId<"session">(id), { ...DEFAULT_SESSION_VIEW_STATE, draft, stepGroups });
    }
  }

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

      if (Object.keys(kept).length > 0) tabs[tabId] = kept;
    }

    const sessions = [...this.sessions]
      .filter(([, state]) => draftKept(state.draft) || state.stepGroups.size > 0)
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
