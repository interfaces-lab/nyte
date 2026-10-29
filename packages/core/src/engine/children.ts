import { asSeq } from "@nyte-ai/schema";
import type { BackgroundItem, CallId, HeadName, SessionEvent, SessionId } from "@nyte-ai/schema";
import type { ChildTable, Kernel } from "../contract/kernel.ts";
import { backgroundItems } from "../fold/background.ts";
import { MAIN } from "../store/session.ts";

interface Child {
  readonly parent: SessionId;
  readonly head: HeadName;
  readonly startedBy: CallId | null;
  title: string;
  /** How the child's own run stands, unknown until one of its runs changes in this process. */
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

    if (event.kind === "run") child.own = runState(event);
    else if (event.kind === "session") child.title = event.info.name ?? CHILD_TITLE;
    else if (event.kind !== "background") return;
    refresh(session, child);
  });

  return {
    link(record) {
      if (record.parent === null || children.has(record.id)) return;
      children.set(record.id, {
        parent: record.parent,
        head: record.origin?.head ?? MAIN,
        startedBy: record.origin?.call ?? null,
        title: record.name ?? CHILD_TITLE,
        own: null,
        item: null,
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
