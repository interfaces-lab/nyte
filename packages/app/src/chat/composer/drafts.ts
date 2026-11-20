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
import { journaledReceipts } from "../../data/send-journal.ts";
import { NO_SENDING, persistedDraft, restorable, unsentNotice } from "./composer-draft.ts";
import type { ComposerNotice, Restore, Sending, SessionDraft } from "./composer-draft.ts";

const FLUSH_DEBOUNCE_MS = 200;

const STORED_IMAGE_LIMIT = 256 * 1024;

const STORED_STEPS_LIMIT = 16 * 1024;

const stepsSchema = Type.Array(Type.Tuple([Type.String({ minLength: 1 }), Type.Boolean()]));

type StoredSteps = Static<typeof stepsSchema>;

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

const omittedSchema = Type.Integer({ minimum: 1 });

const storedDraftSchema = Type.Object(
  {
    updatedAt: Type.Number(),
    composer: composerSchema,
    project: Type.Optional(projectId),
    folder: Type.Optional(Type.Union([Type.String(), Type.Null()])),
    choice: Type.Optional(
      Type.Object({ model: ModelRefType, thinking: Type.Optional(ThinkingType) }, strict),
    ),
    omitted: Type.Optional(omittedSchema),
  },
  strict,
);

const sessionDraftSchema = Type.Object(
  {
    ...composerSchema.properties,
    refused: Type.Optional(Type.Object({ message: Type.String(), text: Type.String() }, strict)),
    omitted: Type.Optional(omittedSchema),
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

const sendingSchema = Type.Array(
  Type.Object(
    {
      receipt: Type.String({ minLength: 1 }),
      text: Type.String(),
      attachments: attachmentsSchema,
      omitted: Type.Integer({ minimum: 0 }),
    },
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
  | StoredSteps
  | readonly StoredSending[]
  | number;

interface StoredSending extends Restore {
  readonly receipt: string;
  readonly omitted: number;
}

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

function storedImages(
  attachments: readonly ComposerImageAttachment[],
): readonly ComposerImageAttachment[] {
  return attachments.filter((image) => image.content.data.length <= STORED_IMAGE_LIMIT);
}

function storedSending(sending: readonly Sending[]): readonly StoredSending[] | undefined {
  if (sending.length === 0) return undefined;

  return sending.map((sent) => {
    const attachments = storedImages(sent.attachments);

    return {
      receipt: sent.receipt,
      text: sent.text,
      attachments,
      omitted: sent.attachments.length - attachments.length,
    };
  });
}

function readOmitted(storage: StorageArea, images: string): number {
  return readStored(storage, `${images}:omitted`, omittedSchema, 0);
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
      omitted: 0,
    };
  }

  saveDraft(previous: ChatDraft, next: ChatDraft): void {
    this.save(
      `draft:${next.id}`,
      previous.composer,
      next.composer,
      draftHasContent(next)
        ? {
            updatedAt: next.updatedAt,
            composer: persistableComposer(next.composer),
            project: next.project,
            folder: next.folder,
            choice: next.choice,
            omitted: next.omitted === 0 ? undefined : next.omitted,
          }
        : undefined,
    );

    if (!contentChanged(previous.composer, next.composer)) return;
    clearTimeout(this.#publishTimer);
    this.#publishTimer = setTimeout(this.emit, FLUSH_DEBOUNCE_MS);
  }

  saveSession(sessionId: SessionId, previous: SessionDraft, next: SessionDraft): void {
    const after = persistedDraft(next);
    const notice = restorable(next);

    const record: StoredSession | undefined = draftKept(next)
      ? {
          ...persistableComposer(after),
          ...(notice === null || notice.restore === null
            ? {}
            : { refused: { message: notice.message, text: notice.restore.text } }),
          omitted: next.omitted === 0 ? undefined : next.omitted,
        }
      : undefined;

    this.save(`session:${sessionId}`, persistedDraft(previous), after, record);
    const before = restorable(previous)?.restore?.attachments ?? NO_IMAGES;
    const kept = notice?.restore?.attachments ?? NO_IMAGES;
    const persistence = this.#persistence;

    if (persistence === undefined) return;
    const key = `${persistence.storageKey}:session:${sessionId}`;

    if (before !== kept) this.#saveImages(`${key}:refused`, kept);

    if (previous.sending === next.sending) return;
    this.#pending.set(`${key}:sending`, storedSending(next.sending));
    this.#store();
  }

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
        this.#saveImages(`${key}:images`, next.attachments);
    }

    this.#schedule();
  }

  #saveImages(key: string, attachments: readonly ComposerImageAttachment[]): void {
    const stored = storedImages(attachments);
    const omitted = attachments.length - stored.length;
    this.#pending.set(key, stored.length === 0 ? undefined : stored);
    this.#pending.set(`${key}:omitted`, omitted === 0 ? undefined : omitted);
  }

  #schedule(): void {
    clearTimeout(this.#flushTimer);
    this.#flushTimer = setTimeout(this.#store, FLUSH_DEBOUNCE_MS);

    if (globalThis.window === undefined) return;
    window.addEventListener("pagehide", this.#store);
    document.addEventListener("visibilitychange", this.#store);
  }

  persist(): void {
    this.#store();
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

      if (stored === undefined) return undefined;

      const dropped = readOmitted(
        persistence.storage,
        `${persistence.storageKey}:draft:${id}:images`,
      );

      const draft: ChatDraft = {
        id,
        updatedAt: stored.record.updatedAt,
        composer: composerView(stored.record.composer, stored.attachments),
        choice: stored.record.choice && {
          model: stored.record.choice.model,
          thinking: stored.record.choice.thinking,
        },
        project: stored.record.project,
        folder: stored.record.folder,
        status: EDITING,
        omitted: (stored.record.omitted ?? 0) + dropped,
      };

      if (dropped > 0) this.saveDraft({ ...draft, composer: DEFAULT_COMPOSER_VIEW_STATE }, draft);

      return draft;
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

    const journaled = journaledReceipts();

    for (const id of index.sessions) {
      const key = `${persistence.storageKey}:session:${id}`;
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
                  `${key}:refused`,
                  attachmentsSchema,
                  [],
                ),
              },
            };

      const sending = readStored(persistence.storage, `${key}:sending`, sendingSchema, []);
      const unsent = sending.filter((sent) => !journaled.has(sent.receipt));

      const dropped =
        readOmitted(persistence.storage, `${key}:images`) +
        (refused === undefined ? 0 : readOmitted(persistence.storage, `${key}:refused`)) +
        unsent.reduce((count, sent) => count + sent.omitted, 0);

      const draft: SessionDraft = {
        composer: composerView(stored.record, stored.attachments),
        edit: null,
        notice: unsentNotice(notice, unsent),
        sending: NO_SENDING,
        omitted: (stored.record.omitted ?? 0) + dropped,
      };

      if (dropped > 0 || sending.length > 0) {
        this.saveSession(asId<"session">(id), DEFAULT_SESSION_VIEW_STATE.draft, draft);
        this.#pending.set(`${key}:sending`, undefined);
      }

      if (!draftKept(draft) && stepGroups.size === 0) continue;
      this.sessions.set(asId<"session">(id), { ...DEFAULT_SESSION_VIEW_STATE, draft, stepGroups });
    }

    if (this.#pending.size > 0) this.#schedule();
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
