import { SdkError } from "@nyte-ai/schema";
import type { HeadName, MessageId, ReorderOutcome, ReorderPlace, SessionId } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import { commit } from "../watch/commit.ts";
import { withFold } from "../watch/reads.ts";
import { inboxRef } from "../store/refs.ts";
import {
  attempt,
  inboxWithout,
  put,
  readInbox,
  coveredHere,
  readRefExpectation,
  STALE,
} from "../store/session.ts";
import { dev } from "../util/dev-log.ts";
import { readDeparture, refuseDeciding } from "./admission.ts";

/** Moves a queued message in one inbox write. Landing takes steers and attaches wherever they sit and a run's prompt from the front, so no order is out of bounds. */
export async function reorderQueued(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly message: MessageId;
    readonly place: ReorderPlace;
  },
): Promise<ReorderOutcome> {
  const { session, head, message } = input;
  const after = input.place.after;

  if (after === message) {
    throw new SdkError("invalid", `Message ${message} can't move after itself.`);
  }
  await refuseDeciding(kernel, session, message);

  const moved = await attempt(`Reordering ${message}`, async () => {
    const inbox = await readInbox(kernel.store, session, head);

    if (!inbox.messages.includes(message)) return null;
    const rest = inbox.messages.filter((id) => id !== message);
    const position = after === null ? 0 : rest.indexOf(after) + 1;

    if (after !== null && position === 0) return { kind: "stale" } as const;

    if (inbox.messages[position] === message) return { kind: "moved" } as const;

    const schedule = await withFold(
      kernel,
      session,
      (state) => state.inputs.get(message)?.schedule,
    );

    if (schedule === undefined) {
      throw new SdkError("internal", `Message ${message} is in the inbox but was never admitted.`);
    }

    const outcome = await commit(kernel, [
      {
        name: inboxRef(session, head),
        target: await put(kernel.store, "inbox", {
          ...inboxWithout(inbox, []),
          messages: [...rest.slice(0, position), message, ...rest.slice(position)],
        }),
        expect: readRefExpectation(inbox.ref),
        events: [{ head, kind: "input", message, change: "scheduled", schedule, position }],
      },
    ]);

    if (outcome.kind === "stale") return STALE;

    if (await coveredHere(kernel, session)) kernel.wakes.notify(session, head);
    dev("admission", "reordered", { session, head, message, position });

    return { kind: "moved" } as const;
  });

  return moved ?? readDeparture(kernel, session, message);
}
