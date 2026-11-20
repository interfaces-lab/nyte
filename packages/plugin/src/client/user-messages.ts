import type { MessageSource, UserContent } from "@nyte-ai/schema";
import type { UserMessage } from "./presentation.ts";

export type ReportMessage = UserMessage & {
  readonly source: Extract<MessageSource, { readonly kind: "child" | "job" }>;
};

export type AnswerMessage = UserMessage & {
  readonly source: Extract<MessageSource, { readonly kind: "answer" }>;
};

export function showsReport(message: UserMessage): message is ReportMessage {
  return message.source.kind === "child" || message.source.kind === "job";
}

export function showsAnswer(message: UserMessage): message is AnswerMessage {
  return message.source.kind === "answer";
}

export function shownContent(message: UserMessage): UserContent {
  return message.source.kind === "action" || message.source.kind === "answer"
    ? message.source.label
    : message.content;
}
