/**
 * Root starts the host answered while no screen was waiting: replayed after a
 * reload or a reconnect. Each answer is acted on once, then leaves the record:
 * an accepted chat is announced with a way to open it, and a refused one
 * gives its message back as a draft before its record goes. Unanswered
 * starts are the new-chat screen's to show and retry.
 */
import type { SessionId } from "@nyte-ai/protocol";
import type { RecordedStart, RootStarts } from "./bridge.ts";
import { messageImages, userMessageText } from "./conversation/message-content.tsx";
import type { ComposerViewState } from "./layout/session-view-state.ts";
import { DEFAULT_COMPOSER_VIEW_STATE } from "./layout/session-view-state.ts";

type MessageContent = RecordedStart["message"]["content"];

export type StartNotice =
  | {
      readonly kind: "accepted";
      readonly requestId: string;
      readonly sessionId: SessionId;
      readonly preview: string;
    }
  | {
      readonly kind: "refused";
      readonly requestId: string;
      readonly message: string;
      readonly preview: string;
    };

/** The composer the message was sent from: its text, and its images as attachments. */
export function draftOf(content: MessageContent): ComposerViewState {
  const draft = userMessageText(content);

  return {
    ...DEFAULT_COMPOSER_VIEW_STATE,
    draft,
    selectionStart: draft.length,
    selectionEnd: draft.length,
    attachments: messageImages(content).map((image, index) => ({
      id: crypto.randomUUID(),
      name: `Image ${String(index + 1)}`,
      content: image,
    })),
  };
}

/** The message's first line, short enough for a notice. */
export function previewOf(content: MessageContent): string {
  const line = userMessageText(content).trim().split("\n", 1)[0] ?? "";

  if (line === "") return messageImages(content).length > 0 ? "An image" : "";

  return line.length > 80 ? `${line.slice(0, 79)}…` : line;
}

/**
 * Act on every answered start on record. A refusal is restored as a draft
 * before its record is dismissed, so its message survives a reload at any
 * point. The notices say what happened to each.
 */
export async function reviewRecordedStarts(input: {
  readonly starts: Pick<RootStarts, "list" | "dismiss">;
  readonly restore: (draft: ComposerViewState) => void;
}): Promise<readonly StartNotice[]> {
  const notices: StartNotice[] = [];

  for (const { requestId, message, outcome } of await input.starts.list()) {
    const preview = previewOf(message.content);

    switch (outcome.kind) {
      case "accepted":
        await input.starts.dismiss(requestId);
        notices.push({ kind: "accepted", requestId, sessionId: outcome.sessionId, preview });
        break;
      case "refused":
        input.restore(draftOf(message.content));
        await input.starts.dismiss(requestId);
        notices.push({ kind: "refused", requestId, message: outcome.message, preview });
        break;
      case "unanswered":
        break;
      default: {
        const _exhaustive: never = outcome;

        return _exhaustive;
      }
    }
  }

  return notices;
}
