import type { HeadName, HoldLease, MessageId, SessionId } from "@nyte-ai/schema";
import { HOLD_MS } from "../contract/session.ts";
import type { Kernel } from "../contract/kernel.ts";
import { commit } from "../fold/commit.ts";
import { inboxRef } from "../store/refs.ts";
import {
  attempt,
  inboxWithout,
  put,
  readInbox,
  readRefExpectation,
  STALE,
} from "../store/session.ts";
import { readDeparture } from "./admission.ts";

export async function leaseHold(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  message: MessageId,
): Promise<HoldLease> {
  const held = await attempt<HoldLease | null>(`Holding ${message}`, async () => {
    const inbox = await readInbox(kernel.store, session, head);

    if (!inbox.messages.includes(message)) return null;

    const outcome = await commit(kernel, [
      {
        name: inboxRef(session, head),
        target: await put(kernel.store, "inbox", {
          ...inboxWithout(inbox, []),
          hold: { message, until: Date.now() + HOLD_MS },
        }),
        expect: readRefExpectation(inbox.ref),
      },
    ]);

    return outcome.kind === "set" ? { kind: "held" } : STALE;
  });

  return held ?? readDeparture(kernel, session, message);
}

export async function releaseHold(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  message: MessageId,
): Promise<void> {
  const released = await attempt(`Releasing ${message}`, async () => {
    const inbox = await readInbox(kernel.store, session, head);

    if (inbox.hold?.message !== message) return false;

    const outcome = await commit(kernel, [
      {
        name: inboxRef(session, head),
        target: await put(kernel.store, "inbox", {
          messages: inbox.messages,
          pendingInput: inbox.pendingInput,
        }),
        expect: readRefExpectation(inbox.ref),
      },
    ]);

    return outcome.kind === "set" ? true : STALE;
  });

  if (released) kernel.wakes.notify(session, head);
}
