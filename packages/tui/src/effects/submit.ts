import type { BlobId, Delivery, SkillInfo, SubmitDraft, UserContent } from "@nyte-ai/sdk";
import { draftContent, pendingUploads } from "../model/draft.ts";
import type { DraftSnapshot } from "../model/draft.ts";
import { indexSkills } from "../model/commands.ts";
import type { BlankChat, Submission } from "../model/state.ts";
import { errorMessage } from "../lib/format.ts";
import { rowStatus } from "./commands.ts";
import type { PluginsPort } from "./ports.ts";
import type { HandlerContext } from "./scope.ts";
import { follow } from "./session.ts";

export async function submit(
  submission: Submission,
  delivery: Delivery,
  context: HandlerContext,
): Promise<void> {
  const { dispatch, ports, read, scope } = context;
  const refuse = (reason: string): void => refuseSubmission(submission, reason, context);
  const { chat } = read().facts;

  if (chat?.kind === "blank" && chat.id === submission.session) {
    const starting = scope.starting;

    if (starting?.id === chat.id) {
      await starting.done;

      return submit(submission, delivery, context);
    }

    const done = start(chat, submission, delivery, context);
    scope.starting = { id: chat.id, done: done.catch(() => undefined) };

    try {
      return await done;
    } finally {
      if (scope.starting?.id === chat.id) scope.starting = null;
    }
  }

  const followed = scope.followed;

  if (followed === null || followed.id !== submission.session) {
    refuse("The chat changed before the message was sent.");

    return;
  }

  const slot = followed.configurator.reserveSubmission();

  try {
    await Promise.allSettled(scope.pastes);

    if (scope.followed !== followed) {
      refuse("The chat changed before the message was sent.");

      return;
    }

    const port = ports.host.session(submission.session);

    const content = await prepare(submission.snapshot, {
      skills: indexSkills(read()),
      upload: (bytes) => port.upload(bytes),
    });

    const configured = await slot.configured;

    if (configured !== undefined && configured.kind !== "acknowledged") {
      const reason = configured.kind === "failed" ? configured.message : "configuration changed";
      refuse(`Message not sent: ${reason}. It is back in the composer.`);

      return;
    }

    const decision = await beforeSubmit(ports.plugins, {
      content,
      delivery,
      session: submission.session,
    });

    if (decision.kind === "reject") {
      refuse(decision.reason);

      return;
    }

    if (
      submission.replace !== null &&
      rowStatus(read(), submission.session, submission.replace) !== "pending"
    ) {
      refuse("That message was already sent. Your edit is back in the composer.");

      return;
    }

    const { message } = await port.send(decision.draft.content, {
      delivery: decision.draft.delivery,
      ...(submission.replace === null
        ? {}
        : { replace: submission.replace, running: "refuse" as const }),
    });

    dispatch({ kind: "sent", submission: submission.id, message });
  } catch (error) {
    refuse(`Message not sent: ${errorMessage(error)}. It is back in the composer.`);
    throw error;
  } finally {
    slot.release();
  }
}

/** Starts a blank chat with the submission as its first message, then follows it; a failed start leaves the chat blank, its id kept for the retry. */
async function start(
  chat: BlankChat,
  submission: Submission,
  delivery: Delivery,
  context: HandlerContext,
): Promise<void> {
  const { dispatch, ports, read, scope } = context;
  const refuse = (reason: string): void => refuseSubmission(submission, reason, context);

  try {
    await Promise.allSettled(scope.pastes);
    const workspace = ports.host.workspace(chat.workspace);

    const content = await prepare(submission.snapshot, {
      skills: indexSkills(read()),
      upload: (bytes) => workspace.upload(bytes),
    });

    const decision = await beforeSubmit(ports.plugins, { content, delivery, session: null });

    if (decision.kind === "reject") {
      refuse(decision.reason);

      return;
    }

    const current = read().facts.chat;

    if (current?.kind !== "blank" || current.id !== chat.id) {
      refuse("The chat changed before the message was sent.");

      return;
    }

    const { message } = await ports.host.start({
      id: chat.id,
      workspace: current.workspace,
      selection: current.selection,
      content: decision.draft.content,
    });

    dispatch({ kind: "sent", submission: submission.id, message });
  } catch (error) {
    refuse(`Message not sent: ${errorMessage(error)}. It is back in the composer.`);
    throw error;
  }

  await follow(chat.id, false, context);
}

function refuseSubmission(submission: Submission, reason: string, context: HandlerContext): void {
  context.dispatch({
    kind: "send-refused",
    submission: submission.id,
    reason,
    snapshot: submission.snapshot,
  });
}

async function beforeSubmit(
  plugins: PluginsPort,
  draft: SubmitDraft,
): Promise<
  | { readonly kind: "accept"; readonly draft: SubmitDraft }
  | { readonly kind: "reject"; readonly reason: string }
> {
  try {
    return await plugins.beforeSubmit(draft);
  } catch (error) {
    return { kind: "reject", reason: errorMessage(error) };
  }
}

interface PrepareDeps {
  readonly skills: ReadonlyMap<string, SkillInfo>;
  readonly upload: (bytes: Uint8Array) => Promise<BlobId>;
}

async function prepare(snapshot: DraftSnapshot, deps: PrepareDeps): Promise<UserContent> {
  const uploaded = await Promise.all(
    pendingUploads(snapshot).map(
      async (pending) => [pending.marker, await deps.upload(pending.bytes)] as const,
    ),
  );

  return draftContent(snapshot, { uploads: new Map(uploaded), skills: deps.skills });
}
