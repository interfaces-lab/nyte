import { asId } from "@nyte-ai/schema";
import type { HeadName, MessageId, RunId, SessionId } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import { decodeSessionRecord } from "../contract/records.ts";
import type { SessionRecord } from "../contract/records.ts";
import { liveRuns, load, readInbox, requireSession, SESSION_PAGE } from "../store/session.ts";
import { sessionRef } from "../store/refs.ts";
import { dev } from "../util/dev-log.ts";
import { stopRun } from "./fence.ts";
import { withdraw } from "./receipts.ts";

/** Stops `session`'s live runs and withdraws its queued messages; a start not yet run is the caller's. */
export async function stopRuns(
  kernel: Kernel,
  session: SessionId,
): Promise<{ readonly stopped: readonly RunId[]; readonly withdrawn: readonly MessageId[] }> {
  const found = await requireSession(kernel.store, session);
  const stopped: RunId[] = [];
  const withdrawn: MessageId[] = [];

  for (const run of await liveRuns(kernel.store, session)) {
    const id = run.record.view.id;

    if ((await stopRun(kernel, session, id)).kind === "requested") stopped.push(id);
  }

  const prefix = `${sessionRef(session)}/inbox/`;

  for (const ref of await kernel.store.refs.list(prefix)) {
    const head = asId<"head">(ref.name.slice(prefix.length));
    const inbox = await readInbox(kernel.store, session, head);
    withdrawn.push(...(await withdraw(kernel, session, head, inbox.messages)));
  }

  for (const head of found.record.heads) kernel.wakes.notify(session, head.name);

  return { stopped, withdrawn };
}

/**
 * Stops the children `head` started from `since` on, and everything under them: moving the head
 * back to before `since` cut the calls that started them, so nothing in the chat follows them.
 * It runs beside the move, which has landed; a failure leaves them running and is logged.
 */
export function stopCut(kernel: Kernel, session: SessionId, head: HeadName, since: number): void {
  void stopCutChildren(kernel, session, head, since).catch((error: unknown) =>
    dev("stop", "cut children", { session, head, error: String(error) }),
  );
}

async function stopCutChildren(
  kernel: Kernel,
  session: SessionId,
  head: HeadName,
  since: number,
): Promise<void> {
  const cut = (await listChildren(kernel, session)).filter(
    (child) => child.origin?.head === head && child.createdAt >= since,
  );

  await Promise.all(cut.map((child) => stopTree(kernel, child.id)));
}

async function stopTree(kernel: Kernel, session: SessionId): Promise<void> {
  await stopRuns(kernel, session);
  const children = await listChildren(kernel, session);

  await Promise.all(children.map((child) => stopTree(kernel, child.id)));
}

/** A session's background children; its side chats never run for it. */
async function listChildren(kernel: Kernel, parent: SessionId): Promise<readonly SessionRecord[]> {
  const children: SessionRecord[] = [];
  let after: { readonly at: number; readonly id: SessionId } | undefined;

  for (;;) {
    const rows = await kernel.store.sessions.list({
      parents: { kind: "children", session: parent },
      after,
      limit: SESSION_PAGE,
    });

    const page = await Promise.all(
      rows.map(({ ref }) => load(kernel.store, ref, decodeSessionRecord)),
    );
    const records = page.flatMap((found) => (found === null ? [] : [found.record]));

    children.push(...records.filter((record) => record.side !== true));
    const last = records.at(-1);

    if (rows.length < SESSION_PAGE || last === undefined) return children;
    after = { at: last.lastActivityAt, id: last.id };
  }
}
