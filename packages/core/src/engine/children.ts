import { asSeq } from "@nyte-ai/schema";
import type { BackgroundItem, CallId, HeadName, SessionEvent, SessionId } from "@nyte-ai/schema";
import type { ChildTable, Kernel } from "../contract/kernel.ts";
import { backgroundItems } from "../fold/background.ts";
import type { SessionRecord } from "../contract/records.ts";
import type { StoreConnection } from "../contract/store.ts";
import { listSessionRecords, liveRun, MAIN } from "../store/session.ts";

interface Child {
  readonly parent: SessionId;
  readonly head: HeadName;
  readonly startedBy: CallId | null;
  title: string;
  /** How the run on the child's main head stands, unknown until it changes in this process or is read from the store. */
  own: BackgroundItem["state"] | null;
  item: BackgroundItem | null;
}

/**
 * The child sessions this process drives, as background items of the parent head that started
 * them. A child waits when its own run waits on the user or one of its own background items
 * waits, so a question deep in a tree reaches every ancestor; being busy reaches only the parent.
 */
export function createChildTable(
  kernel: Pick<Kernel, "bus" | "jobs" | "pages" | "children">,
): ChildTable {
  const children = new Map<SessionId, Child>();

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

    if (event.kind === "run") child.own = runState(event);
    else if (event.kind === "session") child.title = event.info.name ?? CHILD_TITLE;
    else if (event.kind !== "background") return;
    refresh(session, child);
  });

  const follow = (record: SessionRecord): Child | null => {
    if (record.parent === null) return null;

    const child = children.get(record.id) ?? {
      parent: record.parent,
      head: record.origin?.head ?? MAIN,
      startedBy: record.origin?.call ?? null,
      title: record.name ?? CHILD_TITLE,
      own: null,
      item: null,
    };

    children.set(record.id, child);

    return child;
  };

  return {
    link(record, own) {
      const child = follow(record);

      if (child === null || child.own !== null || own === null) return;
      child.own = own;
      refresh(record.id, child);
    },
    reconcile(record, own) {
      const child = follow(record);

      if (child === null || own === null) return;
      child.own = own;
      refresh(record.id, child);
    },
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

/** Links every stored child of `parent`, so its background also lists children whose runs ended before this process started; `reconcile` also takes the stored state over what this process knew. */
export async function linkStoredChildren(
  kernel: Pick<Kernel, "store" | "children">,
  parent: SessionId,
  link: "link" | "reconcile" = "link",
): Promise<void> {
  const records = await listSessionRecords(kernel.store, { kind: "children", session: parent });

  for (const record of records)
    kernel.children[link](record, await readChildState(kernel.store, record));
}

/** How a child's own run stands in the store: its main head's live run, else how its last run ended; null for a child that never ran. */
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
