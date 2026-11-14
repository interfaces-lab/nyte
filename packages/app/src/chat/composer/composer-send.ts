import { followTrace, traced } from "@nyte-ai/sdk";
import type {
  CommandInfo,
  ConfigurationPatch,
  Connection,
  Delivery,
  ReceiptId,
  ReviseOptions,
  ReviseOutcome,
  Session,
  SessionId,
  UserContent,
  WorkspaceId,
} from "@nyte-ai/sdk";
import { asId } from "@nyte-ai/schema";
import type { ProjectId } from "@nyte-ai/schema";
import type { ImageContent } from "@nyte-ai/schema/model";
import type { UserMessage } from "@nyte-ai/plugin/client/presentation";
import { admitDraft } from "../../canvas/client-plugins.tsx";
import { errorMessage } from "../../contract/errors.ts";
import { CLIENT_COMMANDS, COMPACT_COMMAND, SIDECHAT_COMMAND } from "../../data/plugins.ts";
import { filesFor } from "../../data/files.ts";
import { selectedWorkspaceId } from "../../data/workspaces.ts";
import { connected } from "../../data/connection.ts";
import { chatStore } from "../../data/chat-store.ts";
import type { ComposerSubmission } from "./composer-document.ts";
import { messageFiles } from "../transcript/message-content.tsx";
import type { MessageFile } from "../transcript/message-content.tsx";
import { openSideChat } from "../side-chat/side-chats.ts";
import type { ParsedPluginCommand } from "./plugin-command.ts";
import { planEdit } from "./composer-plan.ts";
import type {
  ComposerContent,
  ComposerSendPlan,
  DraftCommands,
  SubmissionPlan,
} from "./composer-plan.ts";

export { composerContentEmpty, composerMessageContent } from "./composer-plan.ts";

export async function uploadComposerContent(content: ComposerContent): Promise<UserContent> {
  const [only, ...rest] = content.parts;
  const attached = content.images.length > 0 || content.files.length > 0;

  if (!attached && only === undefined) return "";

  if (!attached && only?.kind === "text" && rest.length === 0) return only.text;

  if (content.images.length === 0) return [...content.parts, ...content.files];
  const files = await filesFor(selectedWorkspaceId());

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

export async function sendComposerMessage(
  session: Session,
  plan: Extract<ComposerSendPlan, { kind: "message" }>,
  id: ReceiptId = asId<"receipt">(crypto.randomUUID()),
): Promise<void> {
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
  readonly project?: ProjectId;
  readonly name?: string;
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

type Delivered = Extract<DeliveryOutcome, { readonly kind: "sent" | "refused" }>;

type EditOutcome =
  | Extract<DeliveryOutcome, { readonly kind: "empty" | "kept" | "refused" }>
  | ReviseOutcome;

interface ComposerEdit {
  readonly sessionId: SessionId;
  readonly submission: ComposerSubmission;
  readonly attachments: readonly { readonly content: ImageContent }[];
  readonly delivery: Delivery;
  readonly message: UserMessage;
  readonly revise: (content: UserContent, options: ReviseOptions) => Promise<ReviseOutcome>;
}

export async function draftCommands(sessionId: SessionId, text: string): Promise<DraftCommands> {
  if (!/^\/\S/.test(text.trim())) return { kind: "loaded", commands: NO_COMMANDS };
  const store = chatStore(sessionId);
  const shown = store.value;

  return (shown === undefined ? store.next() : Promise.resolve(shown)).then(
    (view): DraftCommands => ({
      kind: "loaded",
      commands: [...view.catalog.commands, ...CLIENT_COMMANDS],
    }),
    (cause: unknown): DraftCommands => ({ kind: "failed", reason: errorMessage(cause) }),
  );
}

/** Sends a planned draft; `receipt` is also the id of the message's unsent row. */
export async function deliver(
  session: Session,
  plan: Extract<SubmissionPlan, { readonly kind: "command" | "message" }>,
  receipt: ReceiptId,
): Promise<Delivered> {
  if (plan.kind === "command") {
    try {
      return await runCommand(session, plan.command);
    } catch (cause: unknown) {
      return { kind: "refused", message: errorMessage(cause) };
    }
  }

  try {
    await sendComposerMessage(session, plan, receipt);

    return { kind: "sent", note: undefined };
  } catch (cause: unknown) {
    return { kind: "refused", message: `Couldn't send the message: ${errorMessage(cause)}` };
  }
}

export async function deliverEdit(input: ComposerEdit): Promise<EditOutcome> {
  const plan = planEdit({
    submission: input.submission,
    attachments: input.attachments,
    commands: await draftCommands(input.sessionId, input.submission.text),
    delivery: input.delivery,
    files: messageFiles(input.message.content),
  });

  if (plan.kind !== "message") return plan;

  try {
    const draft = await admitDraft({
      content: await uploadComposerContent(plan.content),
      delivery: plan.delivery,
      session: input.sessionId,
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

async function openSideChatFrom(parent: SessionId, question: string): Promise<Delivered> {
  const info = await (await connected()).session(parent).info();

  if (info.side === true) return { kind: "refused", message: "Side chats can't start side chats." };

  void openSideChat(parent, question);

  return { kind: "sent", note: undefined };
}

async function runCommand(
  session: Session,
  { name, argument }: ParsedPluginCommand,
): Promise<Delivered> {
  if (name === COMPACT_COMMAND.name) return compactSession(session, argument);

  if (name === SIDECHAT_COMMAND.name) return openSideChatFrom(session.id, argument);

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
