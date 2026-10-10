import { asId } from "@nyte-ai/schema";
import type { Cursor, Paged, ParentFilter, PrincipalId, SessionInfo } from "@nyte-ai/schema";
import { SdkError } from "./error.ts";
import type { Kernel } from "./kernel.ts";
import { decodeSessionRecord } from "./records.ts";
import type { SessionRecord } from "./records.ts";
import { sessionInfo } from "./session-info.ts";
import { closable, coalesce, latest } from "./watch.ts";

const DEFAULT_LIMIT = 50;

const DIRECTORY_EVENTS: ReadonlySet<string> = new Set([
  "session",
  "run",
  "head",
  "commit",
  "seen",
  "activation",
]);

/** Returns one page of the directory, newest activity first. */
export async function listSessions(
  kernel: Kernel,
  principal: PrincipalId,
  input?: { readonly parents?: ParentFilter; readonly cursor?: Cursor; readonly limit?: number },
): Promise<Paged<SessionInfo>> {
  const rows = await directory(kernel, input?.parents ?? { kind: "all" });
  const limit = Math.max(1, input?.limit ?? DEFAULT_LIMIT);
  const start = input?.cursor === undefined ? 0 : after(rows, input.cursor);
  const page = rows.slice(start, start + limit);
  const infos = await Promise.all(page.map((row) => sessionInfo(kernel, row.id, principal)));
  const last = page.at(-1);

  return {
    items: infos.flatMap((info) => (info === null ? [] : [info])),
    next:
      last !== undefined && start + limit < rows.length
        ? asId<"cursor">(`${last.lastActivityAt}:${last.id}`)
        : null,
  };
}

/** Yields the directory as it changes: the sidebar. `return()` unsubscribes at once. */
export function watchSessions(
  kernel: Kernel,
  principal: PrincipalId,
  input?: { readonly parents?: ParentFilter; readonly limit?: number },
): AsyncIterable<readonly SessionInfo[]> {
  return closable<readonly SessionInfo[]>(() => {
    let changes = 0;
    let shown: string | null = null;

    const ticks = coalesce(
      latest(changes, (push) =>
        kernel.bus.subscribeAll((_session, event) => {
          if (!DIRECTORY_EVENTS.has(event.kind)) return;
          changes += 1;
          push(changes);
        }),
      ),
    )[Symbol.asyncIterator]();

    return {
      async pull() {
        for (;;) {
          const tick = await ticks.next();

          if (tick.done) return tick;

          const page = await listSessions(kernel, principal, {
            parents: input?.parents,
            limit: input?.limit,
          });

          const key = JSON.stringify(page.items);

          if (key === shown) continue;
          shown = key;

          return { done: false, value: page.items };
        }
      },
      close() {
        void ticks.return?.();
      },
    };
  });
}

async function directory(kernel: Kernel, parents: ParentFilter): Promise<readonly SessionRecord[]> {
  const refs = await kernel.store.refs.list("sessions/");

  const records = await Promise.all(
    refs.flatMap((ref) => {
      const target = ref.target;

      if (ref.name.split("/").length !== 2 || target === null) return [];

      return [
        kernel.store.objects.get(target).then((object) => {
          const record = decodeSessionRecord(object);

          if (record === null)
            throw new SdkError("internal", `${ref.name} does not hold a session record`);

          return record;
        }),
      ];
    }),
  );

  return records
    .filter(
      (record) =>
        parents.kind === "all" ||
        (parents.kind === "roots" ? record.parent === null : record.parent === parents.session),
    )
    .sort(
      (left, right) =>
        right.lastActivityAt - left.lastActivityAt ||
        (left.id < right.id ? -1 : left.id > right.id ? 1 : 0),
    );
}

function after(rows: readonly SessionRecord[], cursor: Cursor): number {
  const separator = cursor.indexOf(":");
  const at = Number(cursor.slice(0, separator));
  const id = cursor.slice(separator + 1);

  if (separator < 0 || !Number.isFinite(at))
    throw new SdkError("invalid", `${cursor} is not a directory cursor`);

  const index = rows.findIndex(
    (row) => row.lastActivityAt < at || (row.lastActivityAt === at && row.id > id),
  );

  return index < 0 ? rows.length : index;
}
