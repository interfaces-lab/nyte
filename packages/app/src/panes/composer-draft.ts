import type { UserMessage } from "@nyte-ai/plugin/client/presentation";
import type { ReceiptId } from "@nyte-ai/sdk";
import type { RefusedSend } from "@nyte-ai/sdk/client";
import { errorMessage } from "../contract/errors.ts";
import type { ComposerImageAttachment, ComposerViewState } from "./session-view-state.ts";
import { contentDraftText } from "../references/message-references.ts";
import type { ComposerDocumentState } from "./composer-document.ts";

export interface Restore {
  readonly text: string;
  readonly attachments: readonly ComposerImageAttachment[];
}

export interface Sending extends Restore {
  readonly receipt: ReceiptId;
}

export const NO_SENDING: readonly Sending[] = [];

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
  readonly sending: readonly Sending[];
  readonly omitted: number;
}

const UNSENT_NOTICE = "Nyte closed before this message was sent.";

export function restorable(draft: SessionDraft): ComposerNotice | null {
  const notice = draft.notice;

  return notice === null || notice.restore === null ? null : notice;
}

export function unsentNotice(
  notice: ComposerNotice | null,
  unsent: readonly Restore[],
): ComposerNotice | null {
  if (unsent.length === 0) return notice;
  const restore = notice?.restore ?? null;
  const restored = joinedRestore(restore === null ? unsent : [restore, ...unsent]);

  if (notice === null || restore === null) {
    return { kind: "error", message: UNSENT_NOTICE, restore: restored };
  }

  return { ...notice, restore: restored };
}

function joinedRestore(restores: readonly Restore[]): Restore {
  return {
    text: restores.map((restore) => restore.text).join("\n"),
    attachments: restores.flatMap((restore) => restore.attachments),
  };
}

export function omittedMessage(count: number): string {
  return count === 1
    ? "An image was too large to keep with the draft. Attach it again."
    : `${String(count)} images were too large to keep with the draft. Attach them again.`;
}

export function shownNotice(draft: SessionDraft): ComposerNotice | null {
  const notice = draft.notice;

  if (draft.omitted === 0) return notice;
  const omission = omittedMessage(draft.omitted);

  if (notice === null) return { kind: "status", message: omission, restore: null };

  return { ...notice, message: `${notice.message} ${omission}` };
}

export function omissionShown(draft: SessionDraft): SessionDraft {
  return draft.omitted === 0 ? draft : { ...draft, omitted: 0 };
}

export function movedDraft(draft: SessionDraft): SessionDraft {
  if (draft.edit !== null) return draft;

  return {
    ...draft,
    composer: { ...draft.composer, draft: "", attachments: [], selectionStart: 0, selectionEnd: 0 },
  };
}

export function handedOff(draft: SessionDraft, receipt: ReceiptId): SessionDraft {
  const sending = draft.sending.filter((sent) => sent.receipt !== receipt);

  return sending.length === draft.sending.length ? draft : { ...draft, sending };
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
  ) {
    return draft.composer;
  }

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
  receipt: ReceiptId,
): SessionDraft {
  const composer = draft.composer;
  const kept = composer.attachments.filter((attachment) => !attachments.includes(attachment));

  return {
    ...draft,
    composer:
      composer.draft === sent.text
        ? { ...composer, draft: "", attachments: kept, selectionStart: 0, selectionEnd: 0 }
        : { ...composer, attachments: kept },
    sending: [...draft.sending, { receipt, text: sent.text, attachments }],
  };
}

export function keptSending(draft: SessionDraft, sent: Sending): SessionDraft {
  if (draft.sending.some((kept) => kept.receipt === sent.receipt)) return draft;

  return { ...draft, sending: [...draft.sending, sent] };
}

export function refusedDraft(draft: SessionDraft, message: string, sent: Restore): SessionDraft {
  const offered = draft.notice?.restore ?? null;

  if (draft.composer.draft !== "") {
    return {
      ...draft,
      notice: {
        kind: "error",
        message,
        restore: offered === null ? sent : joinedRestore([offered, sent]),
      },
    };
  }

  return {
    ...draft,
    composer: draftWith(draft.composer, sent),
    notice: { kind: "error", message, restore: offered },
  };
}

export function endedDraft(draft: SessionDraft, end: SendEnd, sent: Restore): SessionDraft {
  return end.kind === "refused" ? refusedDraft(draft, end.message, sent) : draft;
}

export function replayedDraft(
  draft: SessionDraft,
  refused: RefusedSend,
  images: readonly ComposerImageAttachment[],
  lost: readonly string[],
): SessionDraft {
  const message = refusalMessage(refused.error);

  return refusedDraft(
    draft,
    lost.length === 0
      ? message
      : `${message} Couldn't restore ${new Intl.ListFormat("en").format(lost)}.`,
    { text: contentDraftText(refused.content), attachments: images },
  );
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
