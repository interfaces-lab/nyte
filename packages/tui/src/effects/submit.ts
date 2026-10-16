import type { BlobId, Delivery, SkillInfo, SubmitDraft, UserContent } from "@nyte-ai/sdk";
import { draftContent, pendingUploads } from "../model/draft.ts";
import type { DraftSnapshot } from "../model/draft.ts";
import type { State, Submission } from "../model/state.ts";
import { rowStatus } from "./commands.ts";
import type { PluginsPort } from "./ports.ts";
import { messageOf } from "./runner.ts";
import type { HandlerContext } from "./runner.ts";

export async function submit(
  submission: Submission,
  delivery: Delivery,
  context: HandlerContext,
): Promise<void> {
  const { dispatch, ports, read, scope } = context;

  const refuse = (reason: string): void => {
    dispatch({
      kind: "send-refused",
      submission: submission.id,
      reason,
      snapshot: submission.snapshot,
    });
  };

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
      skills: skillsOf(read()),
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
    refuse(`Message not sent: ${messageOf(error)}. It is back in the composer.`);
    throw error;
  } finally {
    slot.release();
  }
}

export async function beforeSubmit(
  plugins: PluginsPort,
  draft: SubmitDraft,
): Promise<
  | { readonly kind: "accept"; readonly draft: SubmitDraft }
  | { readonly kind: "reject"; readonly reason: string }
> {
  try {
    return await plugins.beforeSubmit(draft);
  } catch (error) {
    return { kind: "reject", reason: messageOf(error) };
  }
}

export interface PrepareDeps {
  readonly skills: ReadonlyMap<string, SkillInfo>;
  readonly upload: (bytes: Uint8Array) => Promise<BlobId>;
}

export async function prepare(snapshot: DraftSnapshot, deps: PrepareDeps): Promise<UserContent> {
  const uploaded = await Promise.all(
    pendingUploads(snapshot).map(
      async (pending) => [pending.marker, await deps.upload(pending.bytes)] as const,
    ),
  );

  return draftContent(snapshot, { uploads: new Map(uploaded), skills: deps.skills });
}

export function skillsOf(state: State): ReadonlyMap<string, SkillInfo> {
  const skills = state.facts.session?.view?.catalog.skills ?? [];

  return new Map(skills.map((skill) => [skill.name, skill]));
}
