import type { UserContent } from "@nyte-ai/sdk";
import type { ComposerDocumentState } from "../composer/composer-document.ts";
import { composerContentEmpty } from "../composer/composer-plan.ts";
import type { ComposerContent } from "../composer/composer-plan.ts";
import type { ModelPickerChange } from "../composer/model-picker.tsx";
import type { ComposerImageAttachment } from "../../panes/session-view-state.ts";
import { contentDraftText } from "../../references/message-references.ts";
import { messageFiles } from "./message-content.tsx";
import type { MessageFile } from "./message-content.tsx";
import type { BranchModelChoice, BranchModelPicker } from "./turn-view.tsx";

const EMPTY_MESSAGE = "A message cannot be empty.";

export interface UserEditState extends BranchModelChoice {
  readonly document: ComposerDocumentState;
  readonly attachments: readonly ComposerImageAttachment[];
  readonly kept: readonly MessageFile[];
  readonly attachmentReads: number;
  readonly attachmentError: string | undefined;
  readonly saving: boolean;
  readonly error: string | undefined;
}

export type UserEditEvent =
  | { readonly kind: "document"; readonly document: ComposerDocumentState }
  | { readonly kind: "reading"; readonly delta: 1 | -1 }
  | {
      readonly kind: "attached";
      readonly attachments: readonly ComposerImageAttachment[];
      readonly error: string | undefined;
    }
  | { readonly kind: "model"; readonly change: ModelPickerChange }
  | { readonly kind: "failed"; readonly error: string }
  | { readonly kind: "removed-kept"; readonly file: MessageFile }
  | { readonly kind: "removed-attachment"; readonly id: string };

export type SaveDecision =
  | { readonly kind: "busy" }
  | { readonly kind: "empty"; readonly edit: UserEditState }
  | { readonly kind: "send"; readonly edit: UserEditState; readonly choice: BranchModelChoice };

export function beginEdit(
  content: UserContent,
  branch: BranchModelPicker | undefined,
): UserEditState {
  const text = contentDraftText(content);

  return {
    document: { text, selectionStart: text.length, selectionEnd: text.length },
    attachments: [],
    kept: messageFiles(content),
    attachmentReads: 0,
    attachmentError: undefined,
    saving: false,
    error: undefined,
    model: branch?.model,
    thinkingLevel: branch?.thinkingLevel,
    modes: branch?.modes ?? [],
  };
}

export function dismissible(
  edit: UserEditState,
  content: UserContent,
  branch: BranchModelPicker | undefined,
): boolean {
  return (
    !edit.saving &&
    edit.attachmentReads === 0 &&
    edit.document.text === contentDraftText(content) &&
    edit.attachments.length === 0 &&
    edit.kept.length === messageFiles(content).length &&
    edit.model?.key === branch?.model?.key &&
    edit.thinkingLevel === branch?.thinkingLevel &&
    edit.modes.length === (branch?.modes.length ?? 0) &&
    edit.modes.every((mode) => branch?.modes.includes(mode) === true)
  );
}

export function nextEdit(edit: UserEditState, event: UserEditEvent): UserEditState {
  switch (event.kind) {
    case "document":
      return { ...edit, document: event.document, error: undefined };
    case "reading":
      return { ...edit, attachmentReads: edit.attachmentReads + event.delta };
    case "attached":
      return {
        ...edit,
        attachments: [...edit.attachments, ...event.attachments],
        attachmentError: event.error,
      };
    case "model":
      return {
        ...edit,
        model: event.change.option,
        thinkingLevel: event.change.thinkingLevel,
        modes: event.change.modes,
      };
    case "failed":
      return { ...edit, saving: false, error: event.error };
    case "removed-kept":
      return { ...edit, kept: edit.kept.filter((kept) => kept !== event.file) };
    case "removed-attachment":
      return {
        ...edit,
        attachments: edit.attachments.filter((attachment) => attachment.id !== event.id),
        attachmentError: undefined,
      };
    default: {
      const _exhaustive: never = event;

      return _exhaustive;
    }
  }
}

export function decideSave(edit: UserEditState, draft: ComposerContent): SaveDecision {
  if (edit.saving) return { kind: "busy" };

  if (composerContentEmpty(draft)) {
    return { kind: "empty", edit: { ...edit, error: EMPTY_MESSAGE } };
  }

  return {
    kind: "send",
    edit: { ...edit, saving: true, error: undefined },
    choice: { model: edit.model, thinkingLevel: edit.thinkingLevel, modes: edit.modes },
  };
}
