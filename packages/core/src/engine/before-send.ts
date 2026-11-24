import { asId, SdkError } from "@nyte-ai/schema";
import type { Decision, HeadName, MessageId, SessionId, Submission } from "@nyte-ai/schema";
import type { ConnectionContext } from "../contract/host.ts";
import type { Kernel } from "../contract/kernel.ts";
import { callRef } from "../store/refs.ts";
import { readCall } from "../store/session.ts";
import { commit } from "../watch/commit.ts";
import { dev } from "../util/dev-log.ts";
import { callPhase } from "./call-phase.ts";
import { freezeMentions } from "./mentions.ts";

interface Sender {
  readonly kernel: Kernel;
  readonly session: SessionId;
  readonly head: HeadName;
  readonly context: ConnectionContext;
  readonly stop: AbortSignal | null;
}

export async function gateSubmission(
  sending: Sender,
  message: MessageId,
  submission: Submission,
): Promise<Submission> {
  const decision = await decideBeforeSend(sending, message, submission);

  if (decision.action === "reject") {
    dev("admission", "refused", { session: sending.session, message });

    throw new SdkError("invalid", decision.reason);
  }

  if (decision.action === "error") throw new SdkError("internal", decision.message);
  const admitted = decision.action === "modify" ? decision.value : submission;

  return {
    ...admitted,
    content: await freezeMentions(sending.kernel, sending.session, admitted.content),
  };
}

async function decideBeforeSend(
  sending: Sender,
  message: MessageId,
  submission: Submission,
): Promise<Decision<Submission>> {
  const { kernel, session } = sending;
  const call = asId<"call">(`hook:before_send:${message}`);

  if (submission.replace === message) {
    const found = await readCall(kernel.store, session, call);

    if (found !== null && callPhase(found.record).kind === "settled") {
      await commit(kernel, [
        { name: callRef(session, call), target: null, expect: found.ref.revision },
      ]);
    }
  }

  const closing = kernel.executionState.closing.signal;
  const signal = sending.stop === null ? closing : AbortSignal.any([closing, sending.stop]);
  let woken = Promise.withResolvers<void>();
  const dispose = kernel.waits.onWoken(session, call, () => woken.resolve());
  const abort = (): void => woken.resolve();
  signal.addEventListener("abort", abort, { once: true });

  try {
    for (;;) {
      woken = Promise.withResolvers<void>();

      const outcome = await kernel.plugins
        .runtime(session)
        .hooks.decide(
          "before_send",
          submission,
          {
            session,
            head: sending.head,
            run: sending.context.origin?.run ?? null,
            principal: sending.context.principal,
          },
          { call, run: null, head: null, part: null, signal },
        )
        .catch((error: unknown) => {
          throw signal.aborted ? undecided(closing) : error;
        });

      if (outcome.kind === "done") return outcome.value;

      if (!signal.aborted) {
        if (outcome.kind === "interrupted") return { action: "continue" };
        await woken.promise;
      }

      if (signal.aborted) throw undecided(closing);
    }
  } finally {
    signal.removeEventListener("abort", abort);
    dispose();
  }
}

function undecided(closing: AbortSignal): SdkError {
  return closing.aborted
    ? new SdkError("unavailable", "The kernel closed before before_send decided.")
    : new SdkError("invalid", "The send was stopped before before_send decided.");
}
