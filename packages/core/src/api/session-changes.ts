import type { PrincipalId, SessionId, SessionInfo, SessionsChange } from "@nyte-ai/schema";
import type { HostChange, Kernel } from "../contract/kernel.ts";
import { closable, coalesce, latest } from "../util/iterable.ts";
import { readSessions, sessionInfo } from "./session.ts";

export function sessionChanges(
  kernel: Kernel,
  principal: PrincipalId,
): AsyncIterable<SessionsChange> {
  return closable<SessionsChange>(() => {
    const everything = { parents: { kind: "all" }, limit: Number.MAX_SAFE_INTEGER } as const;

    const touched = new Set<SessionId>();
    const ahead = new Set<number>();
    const upsert = new Map<SessionId, SessionInfo>();
    const drop = new Set<SessionId>();
    let known = new Set<SessionId>();
    let external = false;
    let changes = 0;
    let through = 0;
    let sent: number | null = null;

    const ticks = coalesce(
      latest(changes, (push) => {
        const changed = (): void => {
          changes += 1;
          push(changes);
        };

        const dispose = kernel.bus.subscribeAll((session, event) => {
          if (event.kind !== "activation" && event.kind !== "background") return;
          touched.add(session);
          changed();
        });

        const published = (change: HostChange): void => {
          if (change.seq <= through) return;
          ahead.add(change.seq);

          for (const session of change.sessions) touched.add(session);
          changed();
        };

        const committed = (): void => {
          external = true;
          changed();
        };

        kernel.hostChanges.add(published);
        kernel.externalCommits.add(committed);

        return () => {
          dispose();
          kernel.hostChanges.delete(published);
          kernel.externalCommits.delete(committed);
        };
      }),
    )[Symbol.asyncIterator]();

    const note = (id: SessionId, info: SessionInfo | null): void => {
      if (info === null) {
        upsert.delete(id);
        drop.add(id);
        known.delete(id);

        return;
      }

      drop.delete(id);
      upsert.set(id, info);
      known.add(id);
    };

    const reach = (seq: number): void => {
      through = Math.max(through, seq);

      for (const held of ahead) if (held <= through) ahead.delete(held);

      while (ahead.has(through + 1)) {
        through += 1;
        ahead.delete(through);
      }
    };

    const resync = async (): Promise<void> => {
      const read = await readSessions(kernel, principal, {
        ...everything,
        resume: { seq: through },
      });

      const listed = new Set(read.ids);

      for (const id of known) if (!listed.has(id)) note(id, null);

      for (const info of read.rows) note(info.id, info);
      known = listed;
      reach(read.seq);
    };

    return {
      async pull() {
        if (sent === null) {
          await ticks.next();

          const read = await readSessions(kernel, principal, {
            ...everything,
            resume: { seq: Number.MAX_SAFE_INTEGER },
          });

          known = new Set(read.ids);
          reach(read.seq);
          sent = through;

          return { done: false, value: { seq: through, tables: {} } };
        }

        for (;;) {
          const tick = await ticks.next();

          if (tick.done) return tick;
          const sessions = [...touched];
          touched.clear();

          for (const entry of await Promise.all(
            sessions.map(async (id) => ({ id, info: await sessionInfo(kernel, id, principal) })),
          ))
            note(entry.id, entry.info);

          if (external) {
            external = false;
            await resync();
          }

          reach(through);

          if (through <= sent || (upsert.size === 0 && drop.size === 0)) continue;
          sent = through;
          const tables = { sessions: { upsert: [...upsert.values()], drop: [...drop] } };
          upsert.clear();
          drop.clear();

          return { done: false, value: { seq: through, tables } };
        }
      },
      close() {
        void ticks.return?.();
      },
    };
  });
}
