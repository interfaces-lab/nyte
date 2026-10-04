import type { Nyte } from "@nyte-ai/core";
import type { DispatchOutbox, WakeTarget } from "./outbox.ts";

export function withDispatch({
  sdk,
  wake,
  outbox,
}: {
  sdk: Nyte;
  wake: (target: WakeTarget) => Promise<void>;
  outbox: Pick<DispatchOutbox, "record" | "settle">;
}): Nyte {
  async function dispatched<T>(
    target: WakeTarget,
    admit: () => Promise<T>,
    accepted: (outcome: T) => boolean,
  ): Promise<T> {
    const obligation = await outbox.record(target);
    const outcome = await admit();

    if (accepted(outcome)) await wake(target);
    await outbox.settle(obligation);

    return outcome;
  }

  return {
    ...sdk,
    sessions: {
      ...sdk.sessions,
      configure: (input) =>
        dispatched(
          { sessionId: input.sessionId, head: input.head },
          () => sdk.sessions.configure(input),
          (outcome) => outcome.kind === "queued",
        ),
    },
    messages: {
      ...sdk.messages,
      // Lost dispatch responses can be retried with the same admission key.
      send: (input) =>
        dispatched(
          { sessionId: input.sessionId, head: input.head },
          () => sdk.messages.send(input),
          () => true,
        ),
      redeliver: (input) =>
        dispatched(
          { sessionId: input.sessionId, head: input.head },
          () => sdk.messages.redeliver(input),
          (outcome) => outcome.kind !== "not_found",
        ),
    },
    runs: {
      ...sdk.runs,
      reply: (input) =>
        dispatched(
          { sessionId: input.sessionId, head: input.head },
          () => sdk.runs.reply(input),
          (outcome) => outcome.kind !== "not_found",
        ),
      abort: (input) =>
        dispatched(
          { sessionId: input.sessionId, head: input.head },
          () => sdk.runs.abort(input),
          (outcome) => outcome.kind === "requested",
        ),
    },
  };
}
