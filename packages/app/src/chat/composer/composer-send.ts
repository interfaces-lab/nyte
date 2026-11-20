import { followTrace, traced } from "@nyte-ai/sdk";
import type { Chat, ClientConnection } from "@nyte-ai/sdk/client";
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
import { refusalMessage } from "./composer-draft.ts";
import type { SendEnd } from "./composer-draft.ts";
import type { EditSaved } from "./composer-session.ts";
import { planEdit } from "./composer-plan.ts";
import type {
  ComposerContent,
  ComposerSendPlan,
  DraftCommands,
  SubmissionPlan,
} from "./composer-plan.ts";

type ChatSend = Awaited<ReturnType<Chat["send"]>>;

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

async function journalComposerMessage(
  chat: Chat,
  session: SessionId,
  plan: Extract<ComposerSendPlan, { kind: "message" }>,
  id: ReceiptId,
): Promise<ChatSend> {
  followTrace(session, id);

  return traced("composer.submit", id, { session }, async () => {
    const draft = await admittedDraft(session, plan);

    return chat.send(draft.content, { id, delivery: draft.delivery });
  });
}

async function admittedDraft(
  session: SessionId,
  plan: Extract<ComposerSendPlan, { kind: "message" }>,
) {
  const content = await uploadComposerContent(plan.content);

  return admitDraft({ content, delivery: plan.delivery, session });
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

type Delivered = Extract<SendEnd, { readonly kind: "sent" | "refused" }>;

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

  return (shown === undefined ? store.until(() => true) : Promise.resolve(shown)).then(
    (view): DraftCommands => ({
      kind: "loaded",
      commands: [...view.catalog.commands, ...CLIENT_COMMANDS],
    }),
    (cause: unknown): DraftCommands => ({ kind: "failed", reason: errorMessage(cause) }),
  );
}

export async function deliver(
  connection: ClientConnection,
  session: SessionId,
  plan: Extract<SubmissionPlan, { readonly kind: "command" | "message" }>,
  receipt: ReceiptId,
): Promise<{ readonly journaled: boolean; readonly ended: Promise<SendEnd> }> {
  if (plan.kind === "command") {
    const ran = await runCommand(connection.session(session), plan.command).catch(
      (cause: unknown): SendEnd => ({ kind: "refused", message: errorMessage(cause) }),
    );

    return { journaled: false, ended: Promise.resolve(ran) };
  }

  try {
    const sending = await journalComposerMessage(connection.chat(session), session, plan, receipt);

    return { journaled: true, ended: sending.delivered.then(sendEnd, refusedSend) };
  } catch (cause: unknown) {
    return { journaled: false, ended: Promise.resolve(refusedSend(cause)) };
  }
}

function sendEnd(delivered: Awaited<ChatSend["delivered"]>): SendEnd {
  return delivered.kind === "sent" ? { kind: "sent", note: undefined } : delivered;
}

function refusedSend(cause: unknown): SendEnd {
  return { kind: "refused", message: refusalMessage(cause) };
}

export async function deliverEdit(input: ComposerEdit): Promise<EditSaved> {
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

export async function compactSession(session: Session, instructions: string): Promise<Delivered> {
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
