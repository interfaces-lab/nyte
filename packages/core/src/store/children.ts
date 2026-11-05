import { asId } from "@nyte-ai/schema";
import type { BackgroundItem, Revision, SessionId } from "@nyte-ai/schema";
import type { Kernel } from "../contract/kernel.ts";
import { decodeSessionRecord } from "../contract/records.ts";
import type { SessionRecord } from "../contract/records.ts";
import type { StoreConnection } from "../contract/store.ts";
import { liveRun, load, MAIN, SESSION_PAGE } from "./session.ts";

/** A stored child as its last read found it: its session's version, and its activity time to page past it. */
export interface StoredChild {
  readonly version: Revision;
  readonly at: number;
}

/** Links each stored child of `parent` whose session moved since `seen` recorded it, so its background also lists children whose runs ended before this process started. */
export async function linkStoredChildren(
  kernel: Pick<Kernel, "store" | "children">,
  parent: SessionId,
  seen: Map<SessionId, StoredChild>,
): Promise<void> {
  const since = kernel.children.heard();
  let after: { readonly at: number; readonly id: SessionId } | undefined;

  for (;;) {
    const rows = await kernel.store.sessions.list({
      parents: { kind: "children", session: parent },
      after,
      limit: SESSION_PAGE,
    });

    const page = await Promise.all(
      rows.map(async ({ ref, version }) => {
        const id = asId<"session">(ref.name.slice("sessions/".length));
        const known = seen.get(id);

        if (known?.version === version) return { id, at: known.at };
        const found = await load(kernel.store, ref, decodeSessionRecord);

        if (found === null) return null;
        const own = await readChildState(kernel.store, found.record);
        const at = found.record.lastActivityAt;

        if (kernel.children.link(found.record, own, since)) seen.set(id, { version, at });

        return { id, at };
      }),
    );

    const last = page.findLast((entry) => entry !== null);

    if (rows.length < SESSION_PAGE || last === undefined) return;
    after = last;
  }
}

export async function readChildState(
  store: StoreConnection,
  record: SessionRecord,
): Promise<BackgroundItem["state"] | null> {
  const live = await liveRun(store, record.id, MAIN);

  if (live !== null) return live.record.waiting?.kind === "part" ? "waiting" : "working";
  const end = record.heads.find((head) => head.name === MAIN)?.lastRun?.end;

  if (end === undefined) return null;

  return end.kind === "failed" ? "failed" : "done";
}
