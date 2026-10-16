import type { BlobId, Delivery, SkillInfo, SubmitDraft, UserContent } from "@nyte-ai/sdk";
import { draftContent, pendingUploads } from "../model/draft.ts";
import type { DraftSnapshot } from "../model/draft.ts";
import { indexSkills } from "../model/commands.ts";
import type { BlankChat, Submission } from "../model/state.ts";
import { findModel } from "../lib/catalog.ts";
import { errorMessage } from "../lib/format.ts";
import { rowStatus } from "./commands.ts";
import type { PluginsPort } from "./ports.ts";
import type { HandlerContext } from "./scope.ts";
import { blankWorkspace, follow } from "./session.ts";

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
      if (await starting.done) return submit(submission, delivery, context);
      refuse("The chat didn't start. Your message is back in the composer.");

      return;
    }

    const done = start(chat, submission, delivery, context);
    scope.starting = { id: chat.id, done: done.catch(() => false) };

    try {
      await done;

      return;
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

/** Starts a blank chat with the submission as its first message, then follows it, and resolves whether the chat started. A message recalled while it waited for the host is not sent. A failed start leaves the chat blank, its id kept for the retry. When an earlier start already took the id, the TUI follows that chat and hands this message back to its composer. */
async function start(
  chat: BlankChat,
  submission: Submission,
  delivery: Delivery,
  context: HandlerContext,
): Promise<boolean> {
  const { dispatch, ports, read, scope } = context;
  const refuse = (reason: string): void => refuseSubmission(submission, reason, context);

  if (!read().local.submissions.some((sent) => sent.id === submission.id)) return false;

  try {
    await Promise.allSettled(scope.pastes);
    const workspace = await blankWorkspace(chat, context);
    const port = ports.host.workspace(workspace);

    const content = await prepare(submission.snapshot, {
      skills: indexSkills(read()),
      upload: (bytes) => port.upload(bytes),
    });

    const decision = await beforeSubmit(ports.plugins, { content, delivery, session: null });

    if (decision.kind === "reject") {
      refuse(decision.reason);

      return false;
    }

    const current = read().facts.chat;

    if (current?.kind !== "blank" || current.id !== chat.id) {
      refuse("The chat changed before the message was sent.");

      return false;
    }

    const catalog = read().facts.catalog.catalog ?? (await ports.host.listModels());
    const models = catalog.providers.flatMap((provider) => provider.models);

    if (findModel(models, current.selection.model) === undefined) {
      refuse(`${current.selection.model.id} isn't available. ctrl+p picks another.`);

      return false;
    }

    const started = await ports.host.start({
      id: chat.id,
      workspace,
      selection: current.selection,
      content: decision.draft.content,
    });

    if (started.kind === "taken") {
      await follow(chat.id, false, context);
      refuse("This chat had already started. Your message is back in the composer.");

      return true;
    }

    dispatch({ kind: "sent", submission: submission.id, message: started.message });
  } catch (error) {
    refuse(`Message not sent: ${errorMessage(error)}. It is back in the composer.`);
    throw error;
  }

  await follow(chat.id, false, context);

  return true;
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
