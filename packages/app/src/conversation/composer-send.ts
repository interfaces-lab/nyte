import { followTrace, traced } from "@nyte-ai/sdk";
import type {
  CommandInfo,
  ConfigurationPatch,
  Connection,
  Delivery,
  MessageId,
  ReceiptId,
  Session,
  SessionId,
  UserContent,
  WorkspaceId,
} from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
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

export type ComposerSendPlan =
  | { readonly kind: "empty" }
  | { readonly kind: "command"; readonly command: ParsedPluginCommand; readonly delivery: Delivery }
  | { readonly kind: "message"; readonly content: ComposerContent; readonly delivery: Delivery };

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

/**
 * Sends `content` in place of a message while it waits in the queue. `expect` is the history the
 * queue was read from, so once the message has started, the host settles the send `stale` instead
 * of editing the sent message and stopping its run.
 */
export async function reviseQueued(
  session: Session,
  message: MessageId,
  content: UserContent,
  options: { readonly id?: ReceiptId; readonly delivery: Delivery },
): Promise<"revised" | "left"> {
  const view = sessionWatch(session.id).value;
  const waiting = view?.messages.find((shown) => shown.id === message);

  if (
    view === undefined ||
    view.revision === null ||
    waiting?.kind !== "user" ||
    waiting.status.kind === "landed"
  )
    return "left";

  const receipt = await session.send(content, {
    ...options,
    replace: message,
    expect: view.revision,
    running: "refuse",
  });

  const status = await receipt.status().catch(() => undefined);

  if (status?.kind !== "settled") return "revised";

  switch (status.outcome.kind) {
    case "stale":
    case "busy":
    case "pending-input":
    case "missing-target":
    case "summary-failed":
    case "withdrawn":
      return "left";
    case "completed":
    case "stopped":
    case "failed":
      return "revised";
    default: {
      const _exhaustive: never = status.outcome;

      return _exhaustive;
    }
  }
}

export async function sendComposerMessage(
  session: Session,
  plan: Extract<ComposerSendPlan, { kind: "message" }>,
  replacing?: UserMessage,
): Promise<"sent" | "left"> {
  const id = asId<"receipt">(crypto.randomUUID());
  followTrace(session.id, id);

  return traced("composer.submit", id, { session: session.id }, async () => {
    const content = await uploadComposerContent(
      replacing === undefined
        ? plan.content
        : { ...plan.content, files: messageFiles(replacing.content) },
    );

    const draft = await admitDraft({ content, delivery: plan.delivery, session: session.id });

    if (replacing === undefined) {
      await session.send(draft.content, { id, delivery: draft.delivery });

      return "sent";
    }

    const revised = await reviseQueued(session, replacing.id, draft.content, {
      id,
      delivery: draft.delivery,
    });

    return revised === "revised" ? "sent" : "left";
  });
}

interface ComposerChat {
  readonly id: SessionId;
  readonly workspace?: WorkspaceId;
  readonly configuration?: ConfigurationPatch;
}

export async function startComposerChat(
  connection: Connection,
  chat: ComposerChat,
  plan: Extract<ComposerSendPlan, { kind: "message" }>,
): Promise<void> {
  followTrace(chat.id, chat.id);

  await traced("composer.submit", chat.id, { session: chat.id }, async () => {
    const content = await uploadComposerContent(plan.content);
    const draft = await admitDraft({ content, delivery: plan.delivery, session: null });

    await connection.sessions.start({ ...chat, content: draft.content });
  });
}

const NO_COMMANDS: readonly CommandInfo[] = [];

type DeliveryOutcome =
  | { readonly kind: "empty" }
  | { readonly kind: "kept"; readonly message: string }
  | { readonly kind: "sent"; readonly note: string | undefined }
  | { readonly kind: "refused"; readonly message: string }
  | { readonly kind: "left"; readonly message: string };

interface ComposerDelivery {
  readonly sessionId: SessionId;
  readonly submission: ComposerSubmission;
  readonly attachments: readonly { readonly content: ImageContent }[];
  readonly delivery: Delivery;
  readonly replacing: UserMessage | undefined;
  readonly onLeave: () => void;
}

async function draftCommands(
  sessionId: SessionId,
  text: string,
): Promise<readonly CommandInfo[] | undefined> {
  if (!/^\/\S/.test(text.trim())) return NO_COMMANDS;
  const store = sessionWatch(sessionId);
  const view = store.value ?? (await store.next().catch(() => undefined));

  return view === undefined ? undefined : [...view.catalog.commands, COMPACT_COMMAND];
}

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
    return (await sendComposerMessage(session, plan, replacing)) === "sent"
      ? { kind: "sent", note: undefined }
      : {
          kind: "left",
          message: "That message was already sent. Your edit is back in the composer.",
        };
  } catch (cause: unknown) {
    const failed =
      replacing === undefined ? "Couldn't send the message" : "Couldn't update the message";

    return { kind: "refused", message: `${failed}: ${errorMessage(cause)}` };
  }
}

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

  const outcome = await session.command(name, argument);

  switch (outcome.kind) {
    case "ran":
      return { kind: "sent", note: outcome.output ?? undefined };
    case "sent":
      return { kind: "sent", note: undefined };
    case "unknown":
      return { kind: "refused", message: `/${name} isn't available in this chat.` };
    case "failed":
      return { kind: "refused", message: outcome.message };
    default: {
      const _exhaustive: never = outcome;

      return _exhaustive;
    }
  }
}
