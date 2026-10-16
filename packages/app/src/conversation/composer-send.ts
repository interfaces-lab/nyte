import type { CommandInfo, Delivery, SessionId, UserContent } from "@nyte-ai/sdk";
import type { ImageContent } from "@nyte-ai/schema/model";
import { errorMessage } from "../errors.ts";
import { COMPACT_COMMAND, workspaceFiles } from "../queries.ts";
import { connected, sessionWatch } from "../sdk.tsx";
import type { UserMessage } from "../view-helpers.ts";
import type { ComposerSubmission } from "./composer-document.ts";
import { messageFiles } from "./message-content.tsx";
import type { MessageFile } from "./message-content.tsx";
import { parsePluginCommand } from "./plugin-command.ts";
import type { ParsedPluginCommand } from "./plugin-command.ts";

export interface ComposerContent {
  readonly text: string;
  readonly images: readonly ImageContent[];
  readonly files: readonly MessageFile[];
}

export function composerMessageContent(
  text: string,
  attachments: readonly { readonly content: ImageContent }[],
  files: readonly MessageFile[] = [],
): ComposerContent {
  return { text, images: attachments.map((attachment) => attachment.content), files };
}

export function composerContentEmpty(content: ComposerContent): boolean {
  return content.text.trim() === "" && content.images.length === 0 && content.files.length === 0;
}

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

export async function sendComposerMessage(
  sessionId: SessionId,
  plan: Extract<ComposerSendPlan, { kind: "message" }>,
): Promise<void> {
  const content = await uploadComposerContent(plan.content);
  await (await connected()).session(sessionId).send(content, { delivery: plan.delivery });
}

const NO_COMMANDS: readonly CommandInfo[] = [];

/** What became of one submit. */
export type DeliveryOutcome =
  | { readonly kind: "empty" }
  /** Not sent: the draft stays as typed, and `message` says why. */
  | { readonly kind: "kept"; readonly message: string }
  /** Sent; `note` is what a command answered, if it answered anything. */
  | { readonly kind: "sent"; readonly note: string | undefined }
  /** It left, and the host refused it: the draft comes back with `message`. */
  | { readonly kind: "refused"; readonly message: string };

export interface ComposerDelivery {
  readonly sessionId: SessionId;
  readonly submission: ComposerSubmission;
  readonly attachments: readonly { readonly content: ImageContent }[];
  readonly delivery: Delivery;
  /** The queued message this submit replaces; a replacement never runs a command. */
  readonly replacing: UserMessage | undefined;
  /**
   * Runs once the submit is known to leave and the host connection is open,
   * before the host answers. The composer clears its draft there: the outbox
   * row already shows the message, and the next thought never waits. Until
   * then the draft stays in the composer, sending.
   */
  readonly onLeave: () => void;
}

/**
 * The chat's commands, `/compact` included, or undefined when its view could
 * not load. A draft that opens with a slash waits for the chat's first view
 * rather than guessing it is plain text; anything else needs no catalog.
 */
async function draftCommands(
  sessionId: SessionId,
  text: string,
): Promise<readonly CommandInfo[] | undefined> {
  if (!/^\/\S/.test(text.trim())) return NO_COMMANDS;
  const store = sessionWatch(sessionId);
  const view = store.value ?? (await store.next().catch(() => undefined));

  return view === undefined ? undefined : [...view.catalog.commands, COMPACT_COMMAND];
}

/**
 * Sends one submit: a plugin command's line runs the command, anything else
 * is a message, and a known command's line never reaches the model just
 * because it cannot run here.
 */
export async function deliverSubmission(input: ComposerDelivery): Promise<DeliveryOutcome> {
  const { sessionId, submission, replacing } = input;
  const commands = await draftCommands(sessionId, submission.text);

  if (commands === undefined)
    return { kind: "kept", message: "Commands couldn't load. Try again." };

  const plan = composerSendPlan({
    submission,
    attachments: input.attachments,
    commands: replacing === undefined ? commands : NO_COMMANDS,
    delivery: input.delivery,
  });

  if (plan.kind === "empty") return { kind: "empty" };

  const blocked =
    plan.kind === "message" ? parsePluginCommand(submission.text, commands) : undefined;

  if (blocked !== undefined)
    return {
      kind: "kept",
      message:
        replacing === undefined
          ? `Send /${blocked.name} by itself.`
          : "Commands can't run from a queued message.",
    };

  await connected();
  input.onLeave();

  if (plan.kind === "message") return deliverMessage(sessionId, plan, replacing);

  try {
    return await runCommand(sessionId, plan.command);
  } catch (cause: unknown) {
    return { kind: "refused", message: errorMessage(cause) };
  }
}

async function deliverMessage(
  sessionId: SessionId,
  plan: Extract<ComposerSendPlan, { readonly kind: "message" }>,
  replacing: UserMessage | undefined,
): Promise<DeliveryOutcome> {
  if (replacing === undefined) {
    try {
      await sendComposerMessage(sessionId, plan);

      return { kind: "sent", note: undefined };
    } catch (cause: unknown) {
      return { kind: "refused", message: `Couldn't send the message: ${errorMessage(cause)}` };
    }
  }

  try {
    const content = await uploadComposerContent({
      ...plan.content,
      files: messageFiles(replacing.content),
    });

    await (
      await connected()
    )
      .session(sessionId)
      .send(content, { replace: replacing.id, delivery: plan.delivery });

    return { kind: "sent", note: undefined };
  } catch (cause: unknown) {
    return { kind: "refused", message: `Couldn't update the message: ${errorMessage(cause)}` };
  }
}

async function runCommand(
  sessionId: SessionId,
  { name, argument }: ParsedPluginCommand,
): Promise<DeliveryOutcome> {
  const session = (await connected()).session(sessionId);

  if (name === COMPACT_COMMAND.name) {
    const outcome = await session.compact(argument === "" ? {} : { instructions: argument });

    switch (outcome.kind) {
      case "started":
        return { kind: "sent", note: undefined };
      case "nothing-to-compact":
        return { kind: "sent", note: "Nothing to compact" };
      case "busy":
        return { kind: "refused", message: "Wait for the current run before compacting." };
      default: {
        const _exhaustive: never = outcome;

        return _exhaustive;
      }
    }
  }

  const outcome = await session.command(name, argument === "" ? undefined : argument);

  switch (outcome.kind) {
    case "ran":
      return { kind: "sent", note: outcome.output ?? undefined };
    case "sent":
      return { kind: "sent", note: undefined };
    case "unknown":
      return { kind: "refused", message: `/${name} isn't available in this chat.` };
    case "invalid":
      return {
        kind: "refused",
        message: outcome.issues[0]?.message ?? `/${name} needs other arguments.`,
      };
    case "failed":
      return { kind: "refused", message: outcome.message };
    default: {
      const _exhaustive: never = outcome;

      return _exhaustive;
    }
  }
}
