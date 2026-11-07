import type { MessageSource, UserContent } from "@nyte-ai/schema";
import type { UserMessage } from "./presentation.ts";

export type ReportMessage = UserMessage & {
  readonly source: Extract<MessageSource, { readonly kind: "child" | "job" }>;
};

/**
 * A user message that carries a late answer to a part's request, sent after the call that asked
 * stopped waiting. The part shows the answer; the message only marks where it reached the agent.
 *
 * @category presentation
 */
export type AnswerMessage = UserMessage & {
  readonly source: Extract<MessageSource, { readonly kind: "answer" }>;
};

export function showsReport(message: UserMessage): message is ReportMessage {
  return message.source.kind === "child" || message.source.kind === "job";
}

/**
 * Narrows to a late answer to a part's request, which clients mark instead of drawing as a prompt.
 *
 * @category presentation
 */
export function showsAnswer(message: UserMessage): message is AnswerMessage {
  return message.source.kind === "answer";
}

/**
 * What a user message shows: an action's or answer's label in place of the prompt it sent.
 *
 * @category presentation
 */
export function shownContent(message: UserMessage): UserContent {
  return message.source.kind === "action" || message.source.kind === "answer"
    ? message.source.label
    : message.content;
}
