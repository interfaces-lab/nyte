/**
 * From an editor read to the provider message. The contract stays text and
 * images: mode and skill chips become the instruction sentences at the head of
 * the text, file chips stay as their `@file://` spelling in the body, and the
 * conversation mention is context the host already has.
 */
import type { CommandInfo, Delivery, SendInput, SessionId } from "@nyte-ai/protocol";
import type { ImageContent, TextContent, UserMessage } from "@nyte-ai/schema";
import type { ComposerSubmission } from "./composer-document.ts";
import { referenceInstruction, sameReference } from "./message-references.ts";
import type { MessageReference } from "./message-references.ts";
import { parsePluginCommand } from "./plugin-command.ts";
import type { ParsedPluginCommand } from "./plugin-command.ts";

export function composerPromptText(text: string, references: readonly MessageReference[]): string {
  const instructions: string[] = [];
  const seen: MessageReference[] = [];
  for (const reference of references) {
    if (seen.some((candidate) => sameReference(candidate, reference))) continue;
    seen.push(reference);
    const instruction = referenceInstruction(reference);
    if (instruction !== undefined) instructions.push(instruction);
  }
  return [...instructions, text].filter((part) => part !== "").join("\n\n");
}

export function composerMessageContent(
  text: string,
  attachments: readonly { readonly content: ImageContent }[],
  references: readonly MessageReference[],
): UserMessage["content"] {
  const prompt = composerPromptText(text, references);
  if (attachments.length === 0) return prompt;
  const parts: (TextContent | ImageContent)[] = [];
  if (prompt !== "") parts.push({ type: "text", text: prompt });
  for (const attachment of attachments) parts.push(attachment.content);
  return parts;
}

type ComposerSendPlan =
  | { readonly kind: "empty" }
  | { readonly kind: "command"; readonly command: ParsedPluginCommand; readonly delivery: Delivery }
  | {
      readonly kind: "message";
      readonly content: UserMessage["content"];
      readonly delivery: Delivery;
    };

/**
 * What one submit does. A draft that is only a plugin command's line runs the
 * command; anything else is a message for the delivery Enter chose.
 */
export function composerSendPlan(input: {
  readonly submission: ComposerSubmission;
  readonly attachments: readonly { readonly content: ImageContent }[];
  readonly commands: readonly CommandInfo[];
  readonly delivery: Delivery;
}): ComposerSendPlan {
  const text = input.submission.text.trim();
  const references = input.submission.references;
  const prompt = composerPromptText(text, references);
  if (prompt === "" && input.attachments.length === 0) return { kind: "empty" };
  const command =
    references.every((reference) => reference.kind === "file") && input.attachments.length === 0
      ? parsePluginCommand(text, input.commands)
      : undefined;
  if (command !== undefined) return { kind: "command", command, delivery: input.delivery };
  return {
    kind: "message",
    content: composerMessageContent(text, input.attachments, references),
    delivery: input.delivery,
  };
}

/** The outbox submission for a planned message: the delivery rides with the content to the receipt. */
export function composerSendInput(
  sessionId: SessionId,
  plan: Extract<ComposerSendPlan, { kind: "message" }>,
): Omit<SendInput, "key"> {
  return { sessionId, content: plan.content, delivery: plan.delivery };
}
