import type { Delivery, HeldMessage, MessageId, ReceiptId, ReviseOutcome } from "@nyte-ai/sdk";
import type { UserMessage } from "@nyte-ai/plugin/client/presentation";
import type { ComposerImageAttachment, ComposerViewState } from "../../panes/session-view-state.ts";
import type { ComposerDocumentState, ComposerSubmission } from "./composer-document.ts";
import {
  errorNotice,
  handedOff,
  leftDraft,
  movedDraft,
  foldEdit,
  lostEdit,
  omissionShown,
  openedEdit,
  restoredDraft,
  shownDraft,
  typedDraft,
  updateShown,
} from "./composer-draft.ts";
import type { ComposerNotice, SessionDraft } from "./composer-draft.ts";
import { NO_INTAKE, nextIntake } from "./composer-files.ts";
import type { Intake, IntakeEvent } from "./composer-files.ts";
import { recallStep } from "./composer-history.ts";
import type { PromptHistory, RecallDirection } from "./composer-history.ts";

export type PendingRowAction =
  | { readonly kind: "cancelling" }
  | { readonly kind: "sending" }
  | { readonly kind: "failed"; readonly message: string };

export type EditSaved =
  | { readonly kind: "empty" }
  | { readonly kind: "kept"; readonly message: string }
  | { readonly kind: "refused"; readonly message: string }
  | ReviseOutcome;

interface EditHold {
  readonly message: MessageId;
  readonly token: number;
  readonly phase: "asking" | "held" | "saving";
}

interface RecallWalk {
  readonly position: number;
  readonly saved: ComposerViewState;
  readonly history: PromptHistory;
  readonly edits: ReadonlyMap<number, ComposerViewState>;
}

export interface ComposerSession {
  readonly open: boolean;
  readonly hold: EditHold | null;
  readonly recall: RecallWalk | null;
  readonly reading: number | null;
  readonly intake: Intake;
  readonly rows: ReadonlyMap<string, PendingRowAction>;
  readonly token: number;
}

export const EDIT_ENDED_NOTICES = {
  sent: "That message was already sent.",
  missing: "That message is no longer queued.",
  lapsed: "Couldn't keep the message on hold.",
} satisfies Record<Awaited<HeldMessage["lost"]>["kind"], string>;

export const FILES_WHILE_SAVING = "Finish editing the message, then attach the image again.";

export const CLOSED_SESSION: ComposerSession = {
  open: false,
  hold: null,
  recall: null,
  reading: null,
  intake: NO_INTAKE,
  rows: new Map(),
  token: 0,
};

type HoldAnswer = { readonly kind: "held" } | { readonly kind: "ended"; readonly notice: string };

export type ComposerSessionEvent =
  | { readonly kind: "shown" }
  | { readonly kind: "closed" }
  | { readonly kind: "draft-changed" }
  | { readonly kind: "edit"; readonly message: UserMessage; readonly asking: boolean }
  | { readonly kind: "edit-cancelled" }
  | { readonly kind: "hold-answered"; readonly token: number; readonly answer: HoldAnswer }
  | { readonly kind: "save"; readonly submission: ComposerSubmission; readonly delivery: Delivery }
  | { readonly kind: "saved"; readonly token: number; readonly saved: EditSaved }
  | {
      readonly kind: "recall";
      readonly direction: RecallDirection;
      readonly loaded: PromptHistory;
    }
  | {
      readonly kind: "prompts-read";
      readonly token: number;
      readonly direction: RecallDirection;
      readonly history: PromptHistory;
    }
  | { readonly kind: "prompts-failed"; readonly token: number; readonly message: string }
  | { readonly kind: "typed"; readonly document: ComposerDocumentState }
  | {
      readonly kind: "sent";
      readonly document: ComposerDocumentState;
      readonly attachments: readonly ComposerImageAttachment[];
      readonly receipt: ReceiptId;
    }
  | {
      readonly kind: "row";
      readonly id: string;
      readonly action: PendingRowAction | null;
      readonly pending: readonly string[];
    }
  | { readonly kind: "intake"; readonly event: IntakeEvent }
  | { readonly kind: "attached"; readonly attachments: readonly ComposerImageAttachment[] }
  | { readonly kind: "detached"; readonly id: string }
  | { readonly kind: "notice"; readonly notice: ComposerNotice | null }
  | { readonly kind: "restored" }
  | { readonly kind: "handed-off"; readonly receipt: ReceiptId }
  | { readonly kind: "moved" }
  | { readonly kind: "submit" }
  | { readonly kind: "files" };

export type ComposerSessionEffect =
  | { readonly kind: "hold"; readonly message: MessageId; readonly token: number }
  | { readonly kind: "release"; readonly token: number }
  | {
      readonly kind: "save";
      readonly message: UserMessage;
      readonly token: number;
      readonly held: number | null;
      readonly submission: ComposerSubmission;
      readonly delivery: Delivery;
    }
  | {
      readonly kind: "read-prompts";
      readonly token: number;
      readonly direction: RecallDirection;
      readonly history: PromptHistory;
      readonly count: number;
    }
  | { readonly kind: "focus"; readonly preventScroll: boolean }
  | { readonly kind: "revised" };

export interface SessionStep {
  readonly state: ComposerSession;
  readonly draft: SessionDraft;
  readonly effects: readonly ComposerSessionEffect[];
  readonly handled: boolean;
}

export function stepSession(
  state: ComposerSession,
  draft: SessionDraft,
  event: ComposerSessionEvent,
): SessionStep {
  const next = releaseLeftHold(transition(state, draft, event));

  if (next.state.reading === null || shownDraft(next.draft).draft === shownDraft(draft).draft) {
    return next;
  }

  return { ...next, state: { ...next.state, reading: null } };
}

function transition(
  state: ComposerSession,
  draft: SessionDraft,
  event: ComposerSessionEvent,
): SessionStep {
  switch (event.kind) {
    case "shown":
      return draft.edit === null || state.hold !== null
        ? step({ ...state, open: true }, draft)
        : askHold({ ...state, open: true }, draft, draft.edit.message.id);
    case "closed":
      return saving(state)
        ? step({ ...state, open: false, reading: null }, omissionShown(foldEdit(draft, "kept")))
        : step(
            { ...state, open: false, hold: null, reading: null },
            omissionShown(foldEdit(draft, "folded")),
            releasing(state.hold),
          );
    case "draft-changed":
      return step(state, draft);
    case "edit":
      return beginEdit(state, draft, event.message, event.asking);
    case "edit-cancelled":
      return step(
        { ...state, hold: null, intake: nextIntake(state.intake, { kind: "cleared" }) },
        { ...draft, edit: null },
        releasing(state.hold),
      );
    case "hold-answered":
      return holdAnswered(state, draft, event.token, event.answer);
    case "save":
      return save(state, draft, event.submission, event.delivery);
    case "saved":
      return saved(state, draft, event.token, event.saved);
    case "recall":
      return recall(state, draft, event.direction, event.loaded);
    case "prompts-read":
      return event.token === state.reading
        ? walk({ ...state, reading: null }, draft, event.history, event.direction)
        : step(state, draft);
    case "prompts-failed":
      return event.token === state.reading
        ? noticed({ ...state, reading: null }, draft, errorNotice(event.message))
        : step(state, draft);
    case "typed":
      return step(state, typedDraft(draft, event.document));
    case "sent":
      return noticed(
        {
          ...state,
          recall: null,
          reading: null,
          intake: nextIntake(state.intake, { kind: "cleared" }),
        },
        leftDraft(draft, event.document, event.attachments, event.receipt),
        draft.notice?.restore === null ? null : draft.notice,
      );
    case "row":
      return step(
        { ...state, rows: nextRows(state.rows, event.id, event.action, event.pending) },
        draft,
      );
    case "intake":
      return step({ ...state, intake: nextIntake(state.intake, event.event) }, draft);
    case "attached":
      return step(
        state,
        updateShown(draft, (view) => ({
          ...view,
          attachments: [...view.attachments, ...event.attachments],
        })),
      );
    case "detached":
      return step(
        { ...state, intake: nextIntake(state.intake, { kind: "cleared" }) },
        updateShown(draft, (view) => ({
          ...view,
          attachments: view.attachments.filter((attachment) => attachment.id !== event.id),
        })),
      );
    case "notice":
      return noticed(state, draft, event.notice);
    case "restored":
      return step(state, restoredDraft(draft));
    case "handed-off":
      return step(state, handedOff(draft, event.receipt));
    case "moved":
      return step(
        { ...state, recall: null, intake: nextIntake(state.intake, { kind: "cleared" }) },
        movedDraft(draft),
      );
    case "submit":
      return step(state, draft, [], state.intake.reads === 0);
    case "files":
      return step(state, draft, [], !saving(state));
    default: {
      const _exhaustive: never = event;

      return _exhaustive;
    }
  }
}

export function editBlock(draft: SessionDraft, asking: boolean): "asking" | "editing" | null {
  if (asking) return "asking";

  return draft.edit === null ? null : "editing";
}

export function saving(state: ComposerSession): boolean {
  return state.hold?.phase === "saving";
}

function step(
  state: ComposerSession,
  draft: SessionDraft,
  effects: readonly ComposerSessionEffect[] = [],
  handled = true,
): SessionStep {
  return { state, draft, effects, handled };
}

function noticed(
  state: ComposerSession,
  draft: SessionDraft,
  notice: ComposerNotice | null,
  effects: readonly ComposerSessionEffect[] = [],
): SessionStep {
  return step(state, state.open ? { ...draft, notice, omitted: 0 } : draft, effects);
}

function releaseLeftHold(next: SessionStep): SessionStep {
  const hold = next.state.hold;

  if (hold === null || hold.phase === "saving" || next.draft.edit?.message.id === hold.message) {
    return next;
  }

  return {
    ...next,
    state: { ...next.state, hold: null },
    effects: [...next.effects, ...releasing(hold)],
  };
}

function releasing(hold: EditHold | null): readonly ComposerSessionEffect[] {
  return hold === null ? [] : [{ kind: "release", token: hold.token }];
}

function askHold(state: ComposerSession, draft: SessionDraft, message: MessageId): SessionStep {
  const token = state.token + 1;

  return step({ ...state, token, hold: { message, token, phase: "asking" } }, draft, [
    ...releasing(state.hold),
    { kind: "hold", message, token },
  ]);
}

function beginEdit(
  state: ComposerSession,
  draft: SessionDraft,
  message: UserMessage,
  asking: boolean,
): SessionStep {
  if (editBlock(draft, asking) !== null || message.source.kind === "action") {
    return step(state, draft);
  }

  const held = askHold(
    { ...state, recall: null, intake: nextIntake(state.intake, { kind: "cleared" }) },
    openedEdit(draft, message),
    message.id,
  );

  return { ...held, effects: [...held.effects, { kind: "focus", preventScroll: false }] };
}

function holdAnswered(
  state: ComposerSession,
  draft: SessionDraft,
  token: number,
  answer: HoldAnswer,
): SessionStep {
  const hold = state.hold;
  const current = hold?.token === token ? hold : null;

  if (answer.kind === "held") {
    if (current === null) return step(state, draft, [{ kind: "release", token }]);

    return step({ ...state, hold: { ...current, phase: "held" } }, draft);
  }

  return current === null ? step(state, draft) : leaveEdit(state, draft, answer.notice);
}

function leaveEdit(
  state: ComposerSession,
  draft: SessionDraft,
  notice: string,
  effects: readonly ComposerSessionEffect[] = [],
): SessionStep {
  return noticed(
    { ...state, hold: null, intake: nextIntake(state.intake, { kind: "cleared" }) },
    lostEdit(draft),
    errorNotice(notice),
    effects,
  );
}

function save(
  state: ComposerSession,
  draft: SessionDraft,
  submission: ComposerSubmission,
  delivery: Delivery,
): SessionStep {
  const edit = draft.edit;

  if (edit === null || saving(state) || state.intake.reads !== 0) return step(state, draft);
  const token = state.token + 1;
  const hold = state.hold;

  return step(
    { ...state, token, hold: { message: edit.message.id, token, phase: "saving" } },
    draft,
    [
      {
        kind: "save",
        message: edit.message,
        token,
        held: hold?.phase === "held" ? hold.token : null,
        submission,
        delivery,
      },
    ],
  );
}

function saved(
  state: ComposerSession,
  draft: SessionDraft,
  token: number,
  outcome: EditSaved,
): SessionStep {
  const hold = state.hold;

  if (hold === null || hold.token !== token || hold.phase !== "saving") return step(state, draft);
  const focus: readonly ComposerSessionEffect[] = state.open
    ? [{ kind: "focus", preventScroll: true }]
    : [];

  switch (outcome.kind) {
    case "empty":
    case "kept":
    case "refused": {
      if (!state.open) return step({ ...state, hold: null }, foldEdit(draft, "folded"));
      const again = askHold({ ...state, hold: null }, draft, hold.message);

      return outcome.kind === "empty"
        ? { ...again, effects: [...again.effects, ...focus] }
        : noticed(again.state, again.draft, errorNotice(outcome.message), [
            ...again.effects,
            ...focus,
          ]);
    }

    case "revised":
      return step(
        { ...state, hold: null, intake: nextIntake(state.intake, { kind: "cleared" }) },
        draft.edit?.message.id === hold.message ? { ...draft, edit: null } : draft,
        [...focus, { kind: "revised" }],
      );
    case "sent":
    case "missing":
      return leaveEdit(state, draft, EDIT_ENDED_NOTICES[outcome.kind], focus);
    default: {
      const _exhaustive: never = outcome;

      return _exhaustive;
    }
  }
}

function recall(
  state: ComposerSession,
  draft: SessionDraft,
  direction: RecallDirection,
  loaded: PromptHistory,
): SessionStep {
  const walking = state.recall;
  const history = walking?.history ?? loaded;
  const older = walking === null ? 0 : walking.position + 1;

  if (direction === "newer" || older < history.prompts.length || history.before === null) {
    return walk(state, draft, history, direction);
  }

  if (state.reading !== null) return step(state, draft);
  const token = state.token + 1;

  return step({ ...state, token, reading: token }, draft, [
    { kind: "read-prompts", token, direction, history, count: older + 1 },
  ]);
}

function walk(
  state: ComposerSession,
  draft: SessionDraft,
  history: PromptHistory,
  direction: RecallDirection,
): SessionStep {
  const walking = state.recall;
  const from = walking?.position;
  const position = recallStep(history.prompts.length, from, direction);
  const settled = { ...state, reading: null };

  if (position === from) return step(settled, draft, [], false);
  const shown = shownDraft(draft);
  const saved = walking?.saved ?? shown;
  const edits = new Map(walking?.edits);

  if (from !== undefined && shown.draft !== history.prompts[from]) edits.set(from, shown);
  const prompt = position === undefined ? undefined : history.prompts[position];

  const view =
    position === undefined
      ? saved
      : (edits.get(position) ?? (prompt === undefined ? saved : at(prompt)));

  return step(
    { ...settled, recall: position === undefined ? null : { position, saved, history, edits } },
    updateShown(draft, (current) => ({
      ...current,
      draft: view.draft,
      selectionStart: view.selectionStart,
      selectionEnd: view.selectionEnd,
    })),
  );
}

function at(text: string): ComposerViewState {
  return { draft: text, attachments: [], selectionStart: text.length, selectionEnd: text.length };
}

function nextRows(
  rows: ReadonlyMap<string, PendingRowAction>,
  id: string,
  action: PendingRowAction | null,
  pending: readonly string[],
): ReadonlyMap<string, PendingRowAction> {
  const next = new Map([...rows].filter(([shown]) => pending.includes(shown) && shown !== id));

  if (action !== null) next.set(id, action);

  return next;
}
