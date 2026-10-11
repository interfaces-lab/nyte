import { asSeq } from "@nyte-ai/schema";
import type { Disposer, Seq, SessionId } from "@nyte-ai/schema";
import type { SessionBus } from "./bus.ts";
import type { Kernel } from "./kernel.ts";
import { headRef } from "./refs.ts";

const LOG_PAGE = 256;

/** Returns one session some feed follows on a bus: how many feeds are open on it, and the seq the first one finished reading the log at. */
interface Followed {
  feeds: number;
  from: Seq | null;
}

const followed = new WeakMap<SessionBus, Map<SessionId, Followed>>();

const published = new WeakMap<Kernel, Map<SessionId, Seq>>();

/** Registers one feed following a session on a bus: `read(through)` records the seq it finished reading the log at (the first feed's is kept), `dispose` drops it; the session stops being followed when its last feed goes. */
export function followSession(
  bus: SessionBus,
  session: SessionId,
): { read(through: Seq): void; readonly dispose: Disposer } {
  const sessions = followed.get(bus) ?? new Map<SessionId, Followed>();
  followed.set(bus, sessions);
  const follow = sessions.get(session) ?? { feeds: 0, from: null };
  follow.feeds += 1;
  sessions.set(session, follow);
  let disposed = false;

  return {
    read(through) {
      follow.from ??= through;
    },
    dispose() {
      if (disposed) return;
      disposed = true;
      follow.feeds -= 1;

      if (follow.feeds === 0 && sessions.get(session) === follow) sessions.delete(session);
    },
  };
}

/** Returns the sessions a fold or a watch follows on a bus, each with the seq its first feed finished reading the log at (null until one has): what `pollStore` re-reads (§42h). */
export function followedSessions(bus: SessionBus): ReadonlyMap<SessionId, Seq | null> {
  return new Map(
    Array.from(followed.get(bus) ?? [], ([session, follow]) => [session, follow.from]),
  );
}

/** Returns the seq a followed session's first feed read the log through, or null when no feed follows it or none has finished reading. */
export function followedFrom(bus: SessionBus, session: SessionId): Seq | null {
  return followed.get(bus)?.get(session)?.from ?? null;
}

/** Returns the kernel's publish marks: the seq through which each session's log was published on its bus, shared by `publishSet` and `followLog` so no event goes out twice. */
export function publishMarks(kernel: Kernel): Map<SessionId, Seq> {
  const marks = published.get(kernel) ?? new Map<SessionId, Seq>();
  published.set(kernel, marks);

  return marks;
}

/** Publishes the events another instance logged for a session since this kernel last published it (§42h): from the session's publish mark, or from `from` when this kernel has published none for it yet, in seq order and each once, so a fold or a watch over the bus sees them as it sees its own. Before a `commit` or `head` event goes out, the head's ref revision is read into `kernel.revisions`, so a watch's revision frame shows the other instance's write. What `pollStore` runs for each followed session. */
export async function followLog(kernel: Kernel, session: SessionId, from: Seq): Promise<void> {
  const marks = publishMarks(kernel);

  if (!marks.has(session)) marks.set(session, from);

  for (;;) {
    const events = await kernel.store.refs.log(session, marks.get(session) ?? from, LOG_PAGE);

    for (const event of events) {
      if (event.seq <= (marks.get(session) ?? 0)) continue;

      if ((event.kind === "commit" || event.kind === "head") && event.head !== null) {
        const name = headRef(session, event.head);
        const ref = await kernel.store.refs.get(name);

        if (ref === null) kernel.revisions.delete(name);
        else kernel.revisions.set(name, ref.revision);
      }

      if (event.seq <= (marks.get(session) ?? 0)) continue;
      marks.set(session, asSeq(event.seq));
      kernel.bus.publish(session, event);
    }

    if (events.length < LOG_PAGE) return;
  }
}
