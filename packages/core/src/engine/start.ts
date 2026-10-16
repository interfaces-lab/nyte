import { SdkError } from "@nyte-ai/schema";
import type { MessageId, RefUpdate, SessionId } from "@nyte-ai/schema";
import type { FoldInput } from "../contract/fold.ts";
import { CORE_CONTEXT, PARTICIPANT_AUTHORITY } from "../contract/host.ts";
import type { ConnectionContext } from "../contract/host.ts";
import type { Kernel } from "../contract/kernel.ts";
import type { SessionRecord } from "../contract/records.ts";
import { dropScans } from "../extend/resources.ts";
import { commit } from "../fold/commit.ts";
import { withFold } from "../fold/reads.ts";
import { releaseParts } from "../store/parts.ts";
import { inboxRef, sessionRef } from "../store/refs.ts";
import {
  attempt,
  coveredHere,
  MAIN,
  readInbox,
  readSession,
  sessionEvent,
  STALE,
} from "../store/session.ts";
import type { Found, Inbox } from "../store/session.ts";
import { dev } from "../util/dev-log.ts";
import { admitted, chooseSendSchedule, gate, resolve } from "./admission.ts";
import type { MessageRecord, Sending } from "./admission.ts";
import { listSessionWaits } from "./waits.ts";

const STOPPED = "The chat was stopped before its first message was decided.";

/** Decides a started chat's first message through its before_send hooks, then re-admits it with the decided content, configuration and schedule. A refusal, a failing hook or a stop removes the chat and throws; the kernel closing throws and leaves the message deciding for repair. One release runs per chat in this process. */
export function releaseStart(
  kernel: Kernel,
  context: ConnectionContext,
  session: SessionId,
): Promise<void> {
  const { starting } = kernel.executionState;
  const current = starting.get(session);

  if (current !== undefined) return current.done;
  const abort = new AbortController();

  const done = decideStart(kernel, context, session, abort.signal).finally(() =>
    starting.delete(session),
  );

  starting.set(session, { done, abort });

  return done;
}

/** Removes a chat whose first message is still deciding, the way a refusal does; returns that message, or null when nothing on the chat is deciding. */
export async function stopStart(kernel: Kernel, session: SessionId): Promise<MessageId | null> {
  return attempt(`Stopping the start of ${session}`, async () => {
    const found = await readSession(kernel.store, session);

    if (found === null) return null;
    const inbox = await readInbox(kernel.store, session, MAIN);
    const deciding = await findDeciding(kernel, session, inbox);

    if (deciding === null) return null;

    return (await discardSession(kernel, found, inbox)) ? deciding.id : STALE;
  });
}

/** Releases a chat whose first message a closed kernel left deciding, as the principal that started it. The release runs on its own, so a parked hook does not hold repair. */
export async function recoverStarts(kernel: Kernel, session: SessionId): Promise<void> {
  const deciding = await findDeciding(
    kernel,
    session,
    await readInbox(kernel.store, session, MAIN),
  );

  if (deciding?.schedule.kind !== "deciding") return;

  const context: ConnectionContext = {
    ...CORE_CONTEXT,
    principal: deciding.schedule.principal,
    authority: PARTICIPANT_AUTHORITY,
  };

  void releaseStart(kernel, context, session).catch((error: unknown) =>
    dev("start", "recovery failed", {
      session,
      error: error instanceof Error ? error.message : String(error),
    }),
  );
}

/** Deletes a session and every ref under it in one commit, then releases what this process holds for it. With `inbox`, the commit also expects the main inbox at that revision. Resolves false when a concurrent write wins. */
export async function discardSession(
  kernel: Kernel,
  found: Found<SessionRecord>,
  inbox: Inbox | null,
): Promise<boolean> {
  const session = found.record.id;

  const refs = [
    ...(await kernel.store.refs.list(`${sessionRef(session)}/`)),
    ...(await kernel.store.refs.list(`kv/session:${session}/`)),
    ...(await listSessionWaits(kernel.store, session)),
  ];

  if (
    inbox !== null &&
    refs.find((ref) => ref.name === inboxRef(session, MAIN))?.revision !== inbox.ref?.revision
  )
    return false;

  const outcome = await commit(kernel, [
    ...refs.map((ref): RefUpdate => ({ name: ref.name, target: null, expect: ref.revision })),
    {
      name: sessionRef(session),
      target: null,
      expect: found.ref.revision,
      events: [await sessionEvent(kernel, found.record)],
    },
  ]);

  if (outcome.kind === "stale") return false;
  kernel.executionState.starting.get(session)?.abort.abort();
  kernel.plugins.state.assigned.delete(session);
  dropScans(kernel, (key) => key === session);
  await kernel.plugins.close(session);
  kernel.sessions.forget(session);
  releaseParts(kernel.partTable, session);

  await Promise.allSettled([
    ...kernel.jobs
      .list(found.record.workspace)
      .flatMap((job) =>
        job.view.session === session && job.view.state.kind === "running"
          ? [job.process.stop()]
          : [],
      ),
    kernel.pages.release({ session }),
  ]);

  await kernel.environments.detach(session);

  return true;
}

async function decideStart(
  kernel: Kernel,
  context: ConnectionContext,
  session: SessionId,
  stop: AbortSignal,
): Promise<void> {
  const closing = kernel.executionState.closing.signal;

  try {
    await admitDecided(kernel, context, session, stop);
  } catch (error) {
    if (closing.aborted) throw error;

    if (stop.aborted) throw new SdkError("invalid", STOPPED);
    await attempt(`Discarding ${session}`, async () => {
      const found = await readSession(kernel.store, session);

      return found === null || (await discardSession(kernel, found, null)) ? true : STALE;
    });

    throw error;
  }
}

async function admitDecided(
  kernel: Kernel,
  context: ConnectionContext,
  session: SessionId,
  stop: AbortSignal,
): Promise<void> {
  await kernel.plugins.runtime(session).ready;
  const input = await findDeciding(kernel, session, await readInbox(kernel.store, session, MAIN));

  if (input === null) return;

  const sending: Sending = {
    kernel,
    session,
    head: MAIN,
    context,
    content: input.content,
    options: {},
    stop,
  };

  const submission = await gate(sending, input.id, {
    content: input.content,
    source: input.source,
    delivery: input.delivery,
    configuration: null,
    replace: null,
  });

  const covered = await coveredHere(kernel, session);

  const released = await attempt(`Starting ${session}`, async () => {
    const [inbox, configuration] = await Promise.all([
      readInbox(kernel.store, session, MAIN),
      resolve(sending, submission.configuration),
    ]);

    const position = inbox.messages.findIndex((message) => message === input.id);

    if (position < 0) return null;

    if ((await findDeciding(kernel, session, inbox))?.id !== input.id) return input.id;

    const message: MessageRecord = {
      id: input.id,
      at: Date.now(),
      content: submission.content,
      source: submission.source,
      delivery: submission.delivery,
      schedule: await chooseSendSchedule(submission.delivery, configuration, null),
      covered,
      configuration,
      replaced: null,
      position,
    };

    const outcome = await commit(kernel, [
      await admitted(kernel.store, session, MAIN, inbox, inbox.messages, message),
    ]);

    if (outcome.kind === "stale") return STALE;

    if (covered) kernel.wakes.notify(session, MAIN);
    await kernel.waits.inputAdmitted(session, MAIN, message.id);
    dev("admission", "started", { session, message: message.id, covered });

    return message.id;
  });

  if (released === null) throw new SdkError("invalid", STOPPED);
}

async function findDeciding(
  kernel: Kernel,
  session: SessionId,
  inbox: Inbox,
): Promise<FoldInput | null> {
  if (inbox.messages.length === 0) return null;

  return withFold(
    kernel,
    session,
    (state) =>
      inbox.messages
        .flatMap((id) => state.inputs.get(id) ?? [])
        .find((input) => input.schedule.kind === "deciding") ?? null,
  );
}
