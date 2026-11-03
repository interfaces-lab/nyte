import { asId, asSeq } from "@nyte-ai/schema";
import type {
  BackgroundItem,
  CallId,
  HeadName,
  Revision,
  SessionEvent,
  SessionId,
} from "@nyte-ai/schema";
import type { ChildTable, Kernel } from "../contract/kernel.ts";
import { backgroundItems } from "../fold/background.ts";
import { decodeSessionRecord } from "../contract/records.ts";
import type { SessionRecord } from "../contract/records.ts";
import type { StoreConnection } from "../contract/store.ts";
import { liveRun, load, MAIN, SESSION_PAGE } from "../store/session.ts";

interface Child {
  readonly parent: SessionId;
  readonly head: HeadName;
  readonly startedBy: CallId | null;
  title: string;
  /** Null until the main head's run changes in this process or is read from the store. */
  own: BackgroundItem["state"] | null;
  /** The table's count of heard run events when this child's last one arrived. */
  heard: number;
  item: BackgroundItem | null;
}

/**
 * A child also waits when one of its background items waits, so a question deep in a tree reaches
 * every ancestor. Being busy reaches only the parent.
 */
export function createChildTable(
  kernel: Pick<Kernel, "bus" | "jobs" | "pages" | "children">,
): ChildTable {
  const children = new Map<SessionId, Child>();
  let heard = 0;

  const refresh = (session: SessionId, child: Child): void => {
    if (child.own === null) return;
    const blocked = backgroundItems(kernel, session).some(({ item }) => item.state === "waiting");

    const item: BackgroundItem = {
      kind: "child",
      id: session,
      title: child.title,
      state: blocked ? "waiting" : child.own,
      startedBy: child.startedBy,
    };

    const before = child.item;

    if (before !== null && before.state === item.state && before.title === item.title) return;
    child.item = item;
    kernel.bus.publish(child.parent, {
      seq: asSeq(0),
      at: Date.now(),
      head: child.head,
      kind: "background",
      item,
    });
  };

  kernel.bus.subscribeAll((session, event) => {
    const child = children.get(session);

    if (child === undefined) return;

    if (event.kind === "run" && event.head !== MAIN) return;

    if (event.kind === "run") {
      heard += 1;
      child.heard = heard;
      child.own = runState(event);
    } else if (event.kind === "session") child.title = event.info.name ?? CHILD_TITLE;
    else if (event.kind !== "background") return;
    refresh(session, child);
  });

  const follow = (record: SessionRecord): Child | null => {
    if (record.parent === null || record.side === true) return null;

    const child = children.get(record.id) ?? {
      parent: record.parent,
      head: record.origin?.head ?? MAIN,
      startedBy: record.origin?.call ?? null,
      title: record.name ?? CHILD_TITLE,
      own: null,
      heard: 0,
      item: null,
    };

    children.set(record.id, child);

    return child;
  };

  return {
    link(record, own, since) {
      const child = follow(record);

      if (child !== null && child.heard > since) return false;

      if (child !== null && own !== null) {
        child.own = own;
        refresh(record.id, child);
      }

      return true;
    },
    heard: () => heard,
    forget(session) {
      const child = children.get(session);

      if (child === undefined) return;
      children.delete(session);

      if (child.item === null) return;
      kernel.bus.publish(child.parent, {
        seq: asSeq(0),
        at: Date.now(),
        head: child.head,
        kind: "background",
        change: "removed",
        item: child.item,
      });
    },
    background: (session) =>
      [...children.values()].flatMap((child) =>
        child.parent === session && child.item !== null
          ? [{ head: child.head, item: child.item }]
          : [],
      ),
  };
}

const CHILD_TITLE = "Subagent";

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

function runState(event: Extract<SessionEvent, { readonly kind: "run" }>): BackgroundItem["state"] {
  switch (event.change) {
    case "ended":
      return event.end.kind === "failed" ? "failed" : "done";
    case "waiting":
      return event.on.kind === "part" ? "waiting" : "working";
    case "started":
    case "phase":
    case "retrying":
    case "stopping":
      return "working";
    default: {
      const _exhaustive: never = event;

      return _exhaustive;
    }
  }
}
