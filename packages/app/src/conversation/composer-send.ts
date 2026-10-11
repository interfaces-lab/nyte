/**
 * From an editor read to the message the head admits. Text stays text, file
 * chips stay as their `@` spelling, and images are uploaded as blobs to the
 * selected workspace at send time.
 */
import type { CommandInfo, Delivery, SessionId, UserContent } from "@nyte-ai/sdk";
import type { ImageContent } from "@nyte-ai/schema/model";
import { workspaceFiles } from "../queries.ts";
import { connection } from "../sdk.tsx";
import type { ComposerSubmission } from "./composer-document.ts";
import type { MessageFile } from "./message-content.tsx";
import { parsePluginCommand } from "./plugin-command.ts";
import type { ParsedPluginCommand } from "./plugin-command.ts";

/** A message before its images are uploaded: its text, images read in the composer, and files the host already holds. */
export interface ComposerContent {
  readonly text: string;
  readonly images: readonly ImageContent[];
  readonly files: readonly MessageFile[];
}

/** A draft's text, its images read in the composer, and the files the message already carries. */
export function composerMessageContent(
  text: string,
  attachments: readonly { readonly content: ImageContent }[],
  files: readonly MessageFile[] = [],
): ComposerContent {
  return { text, images: attachments.map((attachment) => attachment.content), files };
}

/** Whether a draft carries nothing to send. */
export function composerContentEmpty(content: ComposerContent): boolean {
  return content.text.trim() === "" && content.images.length === 0 && content.files.length === 0;
}

/** Uploads a draft's images to the selected workspace and returns the content the head admits. */
export async function uploadComposerContent(content: ComposerContent): Promise<UserContent> {
  if (content.images.length === 0 && content.files.length === 0) return content.text;
  const text = content.text === "" ? [] : [{ kind: "text" as const, text: content.text }];

  if (content.images.length === 0) return [...text, ...content.files];
  const files = await workspaceFiles();

  const uploaded = await Promise.all(
    content.images.map(async (image, index): Promise<MessageFile> => {
      const bytes = Uint8Array.fromBase64(image.data);
      const blob = await files.upload(
        (async function* () {
          yield bytes;
        })(),
      );

      return { kind: "file", blob, mime: image.mimeType, name: `Image ${String(index + 1)}` };
    }),
  );

  return [...text, ...content.files, ...uploaded];
}

type ComposerSendPlan =
  | { readonly kind: "empty" }
  | { readonly kind: "command"; readonly command: ParsedPluginCommand; readonly delivery: Delivery }
  | { readonly kind: "message"; readonly content: ComposerContent; readonly delivery: Delivery };

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

  if (text === "" && input.attachments.length === 0) return { kind: "empty" };

  const command =
    references.every((reference) => reference.kind === "file") && input.attachments.length === 0
      ? parsePluginCommand(text, input.commands)
      : undefined;

  if (command !== undefined) return { kind: "command", command, delivery: input.delivery };

  return {
    kind: "message",
    content: composerMessageContent(text, input.attachments),
    delivery: input.delivery,
  };
}

/** Sends a planned message: images uploaded, then admitted with the delivery Enter chose. */
export async function sendComposerMessage(
  sessionId: SessionId,
  plan: Extract<ComposerSendPlan, { kind: "message" }>,
): Promise<void> {
  const content = await uploadComposerContent(plan.content);
  await connection().session(sessionId).send(content, { delivery: plan.delivery });
}
