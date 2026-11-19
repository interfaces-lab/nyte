import type { UserMessage } from "@nyte-ai/plugin/client/presentation";
import type { RefusedSend } from "@nyte-ai/sdk/client";
import { errorMessage } from "../../contract/errors.ts";
import type { ComposerImageAttachment, ComposerViewState } from "../../panes/session-view-state.ts";
import { contentDraftText } from "../../references/message-references.ts";
import type { ComposerDocumentState } from "./composer-document.ts";

export interface Restore {
  readonly text: string;
  readonly attachments: readonly ComposerImageAttachment[];
}

export interface ComposerNotice {
  readonly kind: "status" | "command" | "error";
  readonly message: string;
  readonly restore: Restore | null;
}

export function errorNotice(message: string): ComposerNotice {
  return { kind: "error", message, restore: null };
}

export type SendEnd =
  | { readonly kind: "sent"; readonly note: string | undefined }
  | { readonly kind: "unsent" }
  | { readonly kind: "removed" }
  | { readonly kind: "refused"; readonly message: string };

interface QueuedEdit {
  readonly message: UserMessage;
  readonly view: ComposerViewState;
}

export interface SessionDraft {
  readonly composer: ComposerViewState;
  readonly edit: QueuedEdit | null;
  readonly notice: ComposerNotice | null;
  readonly sending: Restore | null;
}

export const UNSENT_NOTICE = "Nyte closed before this message was sent.";

export function restorable(draft: SessionDraft): ComposerNotice | null {
  const notice = draft.notice;
  const restore = notice?.restore ?? null;
  const sending = draft.sending;

  if (sending === null) return notice === null || restore === null ? null : notice;

  if (notice === null || restore === null)
    return { kind: "error", message: UNSENT_NOTICE, restore: sending };

  return {
    ...notice,
    restore: {
      text: `${restore.text}\n${sending.text}`,
      attachments: [...restore.attachments, ...sending.attachments],
    },
  };
}

export function movedDraft(draft: SessionDraft): SessionDraft {
  if (draft.edit !== null) return draft;

  return {
    ...draft,
    composer: { ...draft.composer, draft: "", attachments: [], selectionStart: 0, selectionEnd: 0 },
  };
}

export function handedOff(draft: SessionDraft): SessionDraft {
  return draft.sending === null ? draft : { ...draft, sending: null };
}

export function shownDraft(draft: SessionDraft): ComposerViewState {
  return draft.edit?.view ?? draft.composer;
}

export function persistedDraft(draft: SessionDraft): ComposerViewState {
  const edit = draft.edit;

  if (
    edit === null ||
    (edit.view.draft === contentDraftText(edit.message.content) &&
      edit.view.attachments.length === 0)
  )
    return draft.composer;

  return draftWith(draft.composer, { text: edit.view.draft, attachments: edit.view.attachments });
}

export function updateShown(
  draft: SessionDraft,
  update: (view: ComposerViewState) => ComposerViewState,
): SessionDraft {
  if (draft.edit === null) return { ...draft, composer: update(draft.composer) };

  return { ...draft, edit: { ...draft.edit, view: update(draft.edit.view) } };
}

export function typedDraft(draft: SessionDraft, document: ComposerDocumentState): SessionDraft {
  const typed = updateShown(draft, (view) => ({
    ...view,
    draft: document.text,
    selectionStart: document.selectionStart,
    selectionEnd: document.selectionEnd,
  }));

  if (document.text === shownDraft(draft).draft || draft.notice?.kind === "error") return typed;

  return { ...typed, notice: null };
}

export function openedEdit(draft: SessionDraft, message: UserMessage): SessionDraft {
  const text = contentDraftText(message.content);

  return {
    ...draft,
    edit: {
      message,
      view: {
        draft: text,
        attachments: [],
        selectionStart: text.length,
        selectionEnd: text.length,
      },
    },
    notice: null,
  };
}

export function lostEdit(draft: SessionDraft): SessionDraft {
  if (draft.edit === null) return draft;

  return { ...draft, composer: persistedDraft(draft), edit: null };
}

export function foldEdit(draft: SessionDraft, edit: "folded" | "kept"): SessionDraft {
  if (draft.edit === null && draft.notice === null) return draft;
  const notice = draft.notice?.restore === null ? null : draft.notice;

  if (edit === "kept") return notice === draft.notice ? draft : { ...draft, notice };

  return { ...draft, composer: persistedDraft(draft), edit: null, notice };
}

export function leftDraft(
  draft: SessionDraft,
  sent: ComposerDocumentState,
  attachments: readonly ComposerImageAttachment[],
): SessionDraft {
  const composer = draft.composer;
  const kept = composer.attachments.filter((attachment) => !attachments.includes(attachment));

  return {
    ...draft,
    composer:
      composer.draft === sent.text
        ? { ...composer, draft: "", attachments: kept, selectionStart: 0, selectionEnd: 0 }
        : { ...composer, attachments: kept },
    sending: { text: sent.text, attachments },
  };
}

export function refusedDraft(draft: SessionDraft, message: string, sent: Restore): SessionDraft {
  if (draft.composer.draft !== "")
    return { ...draft, notice: { kind: "error", message, restore: sent }, sending: null };

  return {
    ...draft,
    composer: draftWith(draft.composer, sent),
    notice: errorNotice(message),
    sending: null,
  };
}

export function attachRefused(
  draft: SessionDraft,
  images: readonly ComposerImageAttachment[],
): SessionDraft {
  const restore = draft.notice?.restore;

  if (draft.notice !== null && restore !== null && restore !== undefined)
    return {
      ...draft,
      notice: {
        ...draft.notice,
        restore: { ...restore, attachments: [...restore.attachments, ...images] },
      },
    };

  return {
    ...draft,
    composer: { ...draft.composer, attachments: [...draft.composer.attachments, ...images] },
  };
}

export function endedDraft(draft: SessionDraft, end: SendEnd, sent: Restore): SessionDraft {
  return end.kind === "refused" ? refusedDraft(draft, end.message, sent) : draft;
}

export function replayedDraft(draft: SessionDraft, refused: RefusedSend): SessionDraft {
  return refusedDraft(draft, refusalMessage(refused.error), {
    text: contentDraftText(refused.content),
    attachments: [],
  });
}

export function refusalMessage(cause: unknown): string {
  return `Couldn't send the message: ${errorMessage(cause)}`;
}

export function restoredDraft(draft: SessionDraft): SessionDraft {
  const notice = draft.notice;

  if (notice === null || notice.restore === null) return draft;

  return {
    ...draft,
    composer: draftWith(draft.composer, notice.restore),
    notice: { ...notice, restore: null },
  };
}

function draftWith(view: ComposerViewState, front: Restore): ComposerViewState {
  const joined = view.draft === "" ? front.text : `${front.text}\n${view.draft}`;

  return {
    ...view,
    draft: joined,
    attachments: [...front.attachments, ...view.attachments],
    selectionStart: joined.length,
    selectionEnd: joined.length,
  };
}
