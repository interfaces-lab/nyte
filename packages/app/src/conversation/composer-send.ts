import type { CommandInfo, Delivery, Session, SessionId, UserContent } from "@nyte-ai/sdk";
import type { ImageContent } from "@nyte-ai/schema/model";
import type { UserMessage } from "@nyte-ai/plugin/client/presentation";
import { admitDraft } from "../client-plugins.tsx";
import { errorMessage } from "../errors.ts";
import { COMPACT_COMMAND, workspaceFiles } from "../queries.ts";
import { connected, sessionWatch } from "../sdk.tsx";
import type { ComposerSubmission } from "./composer-document.ts";
import type { ContentPart } from "./message-references.ts";
import { messageFiles } from "./message-content.tsx";
import type { MessageFile } from "./message-content.tsx";
import { parsePluginCommand } from "./plugin-command.ts";
import type { ParsedPluginCommand } from "./plugin-command.ts";

interface ComposerContent {
  readonly parts: readonly ContentPart[];
  readonly images: readonly ImageContent[];
  readonly files: readonly MessageFile[];
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

export async function uploadComposerContent(content: ComposerContent): Promise<UserContent> {
  const [only, ...rest] = content.parts;
  const attached = content.images.length > 0 || content.files.length > 0;

  if (!attached && only === undefined) return "";

  if (!attached && only?.kind === "text" && rest.length === 0) return only.text;

  if (content.images.length === 0) return [...content.parts, ...content.files];
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

  return [...content.parts, ...content.files, ...uploaded];
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

/** Uploads a message's images and sends it as the client plugins admit it, in place of `replacing` when it edits a queued one. */
export async function sendComposerMessage(
  session: Session,
  plan: Extract<ComposerSendPlan, { kind: "message" }>,
  replacing?: UserMessage,
): Promise<void> {
  const content = await uploadComposerContent(
    replacing === undefined
      ? plan.content
      : { ...plan.content, files: messageFiles(replacing.content) },
  );

  const draft = await admitDraft({ content, delivery: plan.delivery, session: session.id });

  await session.send(draft.content, {
    delivery: draft.delivery,
    ...(replacing !== undefined && { replace: replacing.id }),
  });
}

const NO_COMMANDS: readonly CommandInfo[] = [];

/** What became of one submit. */
type DeliveryOutcome =
  | { readonly kind: "empty" }
  /** Not sent: the draft stays as typed, and `message` says why. */
  | { readonly kind: "kept"; readonly message: string }
  /** Sent; `note` is what a command answered, if it answered anything. */
  | { readonly kind: "sent"; readonly note: string | undefined }
  /** It left, and the host refused it: the draft comes back with `message`. */
  | { readonly kind: "refused"; readonly message: string };

interface ComposerDelivery {
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

  const session = (await connected()).session(sessionId);
  input.onLeave();

  if (plan.kind === "command") {
    try {
      return await runCommand(session, plan.command);
    } catch (cause: unknown) {
      return { kind: "refused", message: errorMessage(cause) };
    }
  }

  try {
    await sendComposerMessage(session, plan, replacing);

    return { kind: "sent", note: undefined };
  } catch (cause: unknown) {
    const failed =
      replacing === undefined ? "Couldn't send the message" : "Couldn't update the message";

    return { kind: "refused", message: `${failed}: ${errorMessage(cause)}` };
  }
}

/** Compacts the chat as `/compact` does; non-empty `instructions` steer the summary. */
export async function compactSession(
  session: Session,
  instructions: string,
): Promise<Extract<DeliveryOutcome, { readonly kind: "sent" | "refused" }>> {
  const outcome = await session.compact(instructions === "" ? {} : { instructions });

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

async function runCommand(
  session: Session,
  { name, argument }: ParsedPluginCommand,
): Promise<DeliveryOutcome> {
  if (name === COMPACT_COMMAND.name) return compactSession(session, argument);

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
