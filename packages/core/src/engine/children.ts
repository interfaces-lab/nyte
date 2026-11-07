import { asSeq } from "@nyte-ai/schema";
import type { BackgroundItem, CallId, HeadName, SessionEvent, SessionId } from "@nyte-ai/schema";
import type { ChildTable, Kernel } from "../contract/kernel.ts";
import { backgroundItems } from "../fold/background.ts";
import type { SessionRecord } from "../contract/records.ts";
import { MAIN } from "../store/session.ts";

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
