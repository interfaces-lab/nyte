import { followTrace, traced } from "@nyte-ai/sdk";
import type {
  CommandInfo,
  ConfigurationPatch,
  Connection,
  Delivery,
  ReviseOptions,
  ReviseOutcome,
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

export async function sendComposerMessage(
  session: Session,
  plan: Extract<ComposerSendPlan, { kind: "message" }>,
): Promise<void> {
  const id = asId<"receipt">(crypto.randomUUID());
  followTrace(session.id, id);

  await traced("composer.submit", id, { session: session.id }, async () => {
    const content = await uploadComposerContent(plan.content);
    const draft = await admitDraft({ content, delivery: plan.delivery, session: session.id });

    await session.send(draft.content, { id, delivery: draft.delivery });
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
  | { readonly kind: "refused"; readonly message: string };

type EditOutcome =
  | Extract<DeliveryOutcome, { readonly kind: "empty" | "kept" | "refused" }>
  | ReviseOutcome;

type DraftCommands =
  | { readonly kind: "loaded"; readonly commands: readonly CommandInfo[] }
  | Extract<DeliveryOutcome, { readonly kind: "kept" }>;

interface ComposerDelivery {
  readonly sessionId: SessionId;
  readonly submission: ComposerSubmission;
  readonly attachments: readonly { readonly content: ImageContent }[];
  readonly delivery: Delivery;
  readonly onLeave: () => void;
}

interface ComposerEdit {
  readonly sessionId: SessionId;
  readonly submission: ComposerSubmission;
  readonly attachments: readonly { readonly content: ImageContent }[];
  readonly delivery: Delivery;
  readonly message: UserMessage;
  readonly revise: (content: UserContent, options: ReviseOptions) => Promise<ReviseOutcome>;
}

async function draftCommands(sessionId: SessionId, text: string): Promise<DraftCommands> {
  if (!/^\/\S/.test(text.trim())) return { kind: "loaded", commands: NO_COMMANDS };
  const store = sessionWatch(sessionId);
  const shown = store.value;

  return (shown === undefined ? store.next() : Promise.resolve(shown)).then(
    (view): DraftCommands => ({
      kind: "loaded",
      commands: [...view.catalog.commands, COMPACT_COMMAND],
    }),
    (cause: unknown): DraftCommands => ({
      kind: "kept",
      message: `Commands couldn't load: ${errorMessage(cause)}`,
    }),
  );
}

export async function deliverSubmission(input: ComposerDelivery): Promise<DeliveryOutcome> {
  const { sessionId, submission } = input;
  const loaded = await draftCommands(sessionId, submission.text);

  if (loaded.kind === "kept") return loaded;

  const plan = composerSendPlan({
    submission,
    attachments: input.attachments,
    commands: loaded.commands,
    delivery: input.delivery,
  });

  if (plan.kind === "empty") return { kind: "empty" };

  const blocked =
    plan.kind === "message" ? parsePluginCommand(submission.text, loaded.commands) : undefined;

  if (blocked !== undefined) return { kind: "kept", message: `Send /${blocked.name} by itself.` };

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
    await sendComposerMessage(session, plan);

    return { kind: "sent", note: undefined };
  } catch (cause: unknown) {
    return { kind: "refused", message: `Couldn't send the message: ${errorMessage(cause)}` };
  }
}

export async function deliverEdit(input: ComposerEdit): Promise<EditOutcome> {
  const { sessionId, submission } = input;
  const loaded = await draftCommands(sessionId, submission.text);

  if (loaded.kind === "kept") return loaded;

  if (parsePluginCommand(submission.text, loaded.commands) !== undefined)
    return { kind: "kept", message: "Commands can't run from a queued message." };

  if (submission.parts.length === 0 && input.attachments.length === 0) return { kind: "empty" };

  const content = composerMessageContent(
    submission.parts,
    input.attachments,
    messageFiles(input.message.content),
  );

  try {
    const draft = await admitDraft({
      content: await uploadComposerContent(content),
      delivery: input.delivery,
      session: sessionId,
    });

    return await input.revise(draft.content, { delivery: draft.delivery });
  } catch (cause: unknown) {
    return { kind: "refused", message: `Couldn't update the message: ${errorMessage(cause)}` };
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
