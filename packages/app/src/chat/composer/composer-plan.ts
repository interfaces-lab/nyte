import type { CommandInfo, Delivery } from "@nyte-ai/sdk";
import type { ImageContent } from "@nyte-ai/schema/model";
import type { ComposerSubmission } from "./composer-document.ts";
import type { ContentPart } from "../../references/message-references.ts";
import type { MessageFile } from "../transcript/message-content.tsx";
import { parsePluginCommand } from "./plugin-command.ts";
import type { ParsedPluginCommand } from "./plugin-command.ts";

export interface ComposerContent {
  readonly parts: readonly ContentPart[];
  readonly images: readonly ImageContent[];
  readonly files: readonly MessageFile[];
}

export type DraftCommands =
  | { readonly kind: "loaded"; readonly commands: readonly CommandInfo[] }
  | { readonly kind: "failed"; readonly reason: string };

export type ComposerSendPlan =
  | { readonly kind: "empty" }
  | { readonly kind: "command"; readonly command: ParsedPluginCommand; readonly delivery: Delivery }
  | { readonly kind: "message"; readonly content: ComposerContent; readonly delivery: Delivery };

export type SubmissionPlan = ComposerSendPlan | { readonly kind: "kept"; readonly message: string };

interface PlanInput {
  readonly submission: ComposerSubmission;
  readonly attachments: readonly { readonly content: ImageContent }[];
  readonly commands: DraftCommands;
  readonly delivery: Delivery;
}

export function composerMessageContent(
  parts: readonly ContentPart[],
  attachments: readonly { readonly content: ImageContent }[],
  files: readonly MessageFile[] = [],
): ComposerContent {
  return { parts, images: attachments.map((attachment) => attachment.content), files };
}

export function composerContentEmpty(content: ComposerContent): boolean {
  return content.parts.length === 0 && content.images.length === 0 && content.files.length === 0;
}

export function composerSendPlan(input: {
  readonly submission: ComposerSubmission;
  readonly attachments: readonly { readonly content: ImageContent }[];
  readonly commands: readonly CommandInfo[];
  readonly delivery: Delivery;
}): ComposerSendPlan {
  const text = input.submission.text.trim();
  const { references, parts } = input.submission;

  if (parts.length === 0 && input.attachments.length === 0) return { kind: "empty" };

  const command =
    references.every((reference) => reference.kind === "file") && input.attachments.length === 0
      ? parsePluginCommand(text, input.commands)
      : undefined;

  if (command !== undefined) return { kind: "command", command, delivery: input.delivery };

  return {
    kind: "message",
    content: composerMessageContent(parts, input.attachments),
    delivery: input.delivery,
  };
}

export function planSubmission(input: PlanInput): SubmissionPlan {
  if (input.commands.kind === "failed") return commandsFailed(input.commands);
  const commands = input.commands.commands;

  const plan = composerSendPlan({
    submission: input.submission,
    attachments: input.attachments,
    commands,
    delivery: input.delivery,
  });

  if (plan.kind !== "message") return plan;
  const blocked = parsePluginCommand(input.submission.text, commands);

  if (blocked === undefined) return plan;

  return { kind: "kept", message: `Send /${blocked.name} by itself.` };
}

export function planEdit(
  input: PlanInput & { readonly files: readonly MessageFile[] },
): Exclude<SubmissionPlan, { readonly kind: "command" }> {
  if (input.commands.kind === "failed") return commandsFailed(input.commands);

  if (parsePluginCommand(input.submission.text, input.commands.commands) !== undefined)
    return { kind: "kept", message: "Commands can't run from a queued message." };

  if (input.submission.parts.length === 0 && input.attachments.length === 0)
    return { kind: "empty" };

  return {
    kind: "message",
    content: composerMessageContent(input.submission.parts, input.attachments, input.files),
    delivery: input.delivery,
  };
}

function commandsFailed(
  commands: Extract<DraftCommands, { readonly kind: "failed" }>,
): Extract<SubmissionPlan, { readonly kind: "kept" }> {
  return { kind: "kept", message: `Commands couldn't load: ${commands.reason}` };
}
