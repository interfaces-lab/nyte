import {
  DndContext,
  DragOverlay,
  KeyboardSensor,
  PointerSensor,
  pointerWithin,
  useSensor,
  useSensors,
} from "@dnd-kit/core";
import type { DragEndEvent } from "@dnd-kit/core";
import { create, props } from "@stylexjs/stylex";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { sidebar } from "@nyte-ai/app/theme/schema.stylex.ts";
import { Icon } from "@nyte-ai/ui/icon";
import { radius, space } from "@nyte-ai/ui/styles/schema.stylex";
import { text } from "@nyte-ai/ui/styles/text.stylex";
import { role, shadow } from "@nyte-ai/ui/styles/vars.stylex";
import { Toaster, toast } from "@nyte-ai/ui/toast";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { styles as shell } from "../projects/page.stylex";
import { useDisplayMode } from "../shell/display-mode";
import type { DisplayMode } from "../shell/display-mode";
import { createItem } from "./delegate.ts";
import type { Request } from "./delegate.ts";
import { CHAT, droppedOn } from "./dnd.tsx";
import { ItemView } from "./item-view.tsx";
import { LabControls } from "./lab-controls.tsx";
import type { Pace } from "./lab-controls.tsx";
import { SURFACES, YOU } from "./model.ts";
import type { Answer, Chat, Item, PullRequest, Stack } from "./model.ts";
import { NewStack } from "./new-stack.tsx";
import { StatusGlyph } from "./parts.tsx";
import { TICK_MS, advance, land, revisionSteps, schedule } from "./script.ts";
import { CHATS, ITEMS, OPEN_PULLS, STACKS } from "./seed.ts";
import { PageScheme } from "./shots.tsx";
import { StacksSidebar } from "./sidebar.tsx";
import { StackView } from "./stack-view.tsx";
import { hands, propose } from "./staffing.ts";
import { Titlebar } from "./titlebar.tsx";

/** Three places, one way through: a stack, an item in it, or the form that sets a stack up. */
type Screen =
  | { readonly kind: "stack"; readonly stack: string }
  | { readonly kind: "item"; readonly item: string }
  | { readonly kind: "new" }
  | { readonly kind: "edit"; readonly stack: string };

interface Board {
  readonly stacks: readonly Stack[];
  readonly items: readonly Item[];
  readonly pulls: readonly PullRequest[];
  readonly handed: Readonly<Record<string, string>>;
  readonly screen: Screen;
  readonly fresh: string | null;
  /** Null follows the window: docked when there is room, closed when it would cover the card. */
  readonly sidebar: boolean | null;
  readonly clock: number;
  readonly made: number;
  readonly pace: Pace;
}

const START: Board = {
  stacks: STACKS,
  items: ITEMS,
  pulls: OPEN_PULLS,
  handed: {},
  screen: { kind: "stack", stack: "polish" },
  fresh: null,
  sidebar: null,
  clock: 0,
  made: 0,
  pace: 1,
};

/** Each tick lands whatever is due and bills its stack a few cents for it. */
function tick(board: Board): Board {
  const clock = board.clock + 1;
  const items = board.items.map((item) => advance(item, clock));
  const moved = items.filter((item, index) => item !== board.items[index]);

  return {
    ...board,
    clock,
    items,
    stacks: board.stacks.map((stack) => ({
      ...stack,
      spent: stack.spent + moved.filter((item) => item.stack === stack.id).length * 0.04,
    })),
  };
}

/** Below this the sidebar stops sharing the row and slides over the card instead. */
const DRAWER_QUERY = "(max-width: 760px)";

function watchDrawer(onChange: () => void): () => void {
  const query = window.matchMedia(DRAWER_QUERY);

  query.addEventListener("change", onChange);

  return () => query.removeEventListener("change", onChange);
}

const local = create({
  stage: { position: "relative" },
  /**
   * Every view lays out against this card, not the window, because the sidebar, a split or the
   * browser panel all change its room: 959px and under stacks the columns, 639px is phone-sized
   * and drops hints a touch screen can't use.
   */
  card: { containerType: "inline-size", containerName: "stacks" },
  drawer: {
    position: "absolute",
    insetBlock: 0,
    insetInlineStart: 0,
    zIndex: 21,
    width: `min(${sidebar.width}, calc(100% - 48px))`,
    backgroundColor: role.bgChrome,
    boxShadow: shadow.shadowXl,
  },
  scrim: {
    position: "absolute",
    inset: 0,
    zIndex: 20,
    borderWidth: 0,
    backgroundColor: role.bgScrimTranslucent,
    cursor: "pointer",
  },
  carried: {
    display: "flex",
    alignItems: "center",
    gap: space.s2,
    width: "max-content",
    maxWidth: 280,
    paddingBlock: space.s1_5,
    paddingInline: space.s3,
    borderRadius: radius.control,
    backgroundColor: role.bgElevated,
    boxShadow: shadow.shadowMdOutline,
    color: role.contentPrimary,
    cursor: "grabbing",
  },
  carriedLabel: { overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" },
});

/**
 * The lab's whole Stacks product on fake data. A reply always goes to the lead, which passes it
 * on. A chat dropped on a stack joins it: its pull requests get watched, or the lead finishes it.
 */
export function StacksPage(): ReactElement {
  const [board, setBoard] = useState(START);
  const [scheme, setScheme] = useState<DisplayMode>("light");
  const [carrying, setCarrying] = useState<string | null>(null);

  const drawer = useSyncExternalStore(
    watchDrawer,
    () => window.matchMedia(DRAWER_QUERY).matches,
    () => false,
  );

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 8 } }),
    useSensor(KeyboardSensor),
  );

  const seen = useRef(
    new Set(ITEMS.filter((item) => item.status === "needs-you").map((item) => item.id)),
  );

  const shown = board.sidebar ?? !drawer;
  const screen = board.screen;

  const item =
    screen.kind === "item" ? board.items.find((entry) => entry.id === screen.item) : undefined;

  const stackId = screen.kind === "stack" || screen.kind === "edit" ? screen.stack : item?.stack;
  const stack = board.stacks.find((entry) => entry.id === stackId);
  const carried = CHATS.find((chat) => chat.id === carrying);

  useDisplayMode(scheme);

  useMountEffect(() => {
    const timer = window.setInterval(
      () =>
        setBoard((current) =>
          Array.from({ length: current.pace }).reduce<Board>((next) => tick(next), current),
        ),
      TICK_MS,
    );

    return () => window.clearInterval(timer);
  });

  // oxlint-disable-next-line nyte-code/no-direct-effect -- announces items that start needing you while you look elsewhere
  useEffect(() => {
    const waiting = board.items.filter((entry) => entry.status === "needs-you");

    waiting
      .filter((entry) => !seen.current.has(entry.id) && entry.id !== item?.id)
      .forEach((entry) =>
        toast.add({
          title: `${entry.number === null ? "" : `#${String(entry.number)} `}${entry.title}`,
          description: entry.now,
          timeout: 6000,
          actionProps: {
            children: "Open",
            onClick: () =>
              setBoard((current) => ({
                ...current,
                screen: { kind: "item", item: entry.id },
                fresh: null,
              })),
          },
        }),
      );
    seen.current = new Set(waiting.map((entry) => entry.id));
  }, [board.items, item?.id]);

  const go = (next: Screen): void =>
    setBoard((current) => ({
      ...current,
      screen: next,
      fresh: next.kind === "item" ? null : current.fresh,
      sidebar: drawer ? null : current.sidebar,
    }));

  const send = (target: string, request: Request): void =>
    setBoard((current) => {
      const home = current.stacks.find((entry) => entry.id === target);

      if (home === undefined) return current;

      const made = createItem(
        request,
        home,
        `new-${String(current.made)}`,
        495 + current.made,
        current.clock,
      );

      return {
        ...current,
        items: [made, ...current.items],
        pulls:
          request.pull === null
            ? current.pulls
            : current.pulls.filter((pull) => pull.number !== request.pull?.number),
        fresh: made.id,
        made: current.made + 1,
      };
    });

  const update = (id: string, change: (entry: Item, board: Board) => Item): void =>
    setBoard((current) => ({
      ...current,
      items: current.items.map((entry) => (entry.id === id ? change(entry, current) : entry)),
    }));

  const answer = (id: string, chosen: Answer): void =>
    update(id, (entry, current) =>
      schedule(
        land(
          entry,
          {
            wait: 0,
            status: chosen.status,
            now: chosen.now,
            checks: chosen.checks,
            ask: null,
            event: chosen.event,
          },
          current.clock,
        ),
        chosen.after ?? [],
        current.clock,
      ),
    );

  const reply = (id: string, note: string): void =>
    update(id, (entry, current) => {
      const home = current.stacks.find((candidate) => candidate.id === entry.stack);
      const lead = home?.name ?? "The lead";

      const heard = land(
        land(
          entry,
          { wait: 0, event: { who: "You", what: "replied", text: note, mine: true } },
          current.clock,
        ),
        {
          wait: 0,
          event: {
            who: lead,
            what: "passed it on",
            text: "Working your note into the same branch.",
          },
        },
        current.clock,
      );

      if (home === undefined || entry.kind !== "fix" || entry.script.length > 0) return heard;
      const staff = hands(home, propose(home, "fix"));

      return schedule(
        land(
          heard,
          { wait: 0, status: "working", now: `${staff[0]?.name ?? lead} is revising`, ask: null },
          current.clock,
        ),
        revisionSteps(home, entry.number ?? 495 + current.made, staff, 1),
        current.clock,
      );
    });

  const stop = (id: string): void =>
    update(id, (entry, current) => ({
      ...land(
        entry,
        {
          wait: 0,
          status: "done",
          now: "Stopped",
          ask: null,
          event: {
            who: "You",
            what: "stopped it",
            text: "Stopped. The branch and worktree are kept.",
            mine: true,
          },
        },
        current.clock,
      ),
      script: [],
    }));

  const keep = (id: string, finding: string): void =>
    update(id, (entry) => ({
      ...entry,
      findings: entry.findings.map((candidate) =>
        candidate.id === finding ? { ...candidate, kept: !candidate.kept } : candidate,
      ),
    }));

  const hand = (chat: Chat, target: string): void => {
    const home = board.stacks.find((entry) => entry.id === target);
    const first = chat.pulls[0];

    if (home === undefined) return;
    setBoard((current) => ({ ...current, handed: { ...current.handed, [chat.id]: target } }));
    send(
      target,
      first === undefined
        ? {
            kind: "fix",
            text: "Take over this chat and finish it.",
            title: chat.title,
            pull: null,
            staff: propose(home, "fix"),
          }
        : {
            kind: "babysit",
            text: `Babysit ${chat.pulls.map((pull) => `#${String(pull)}`).join(", ")} from “${chat.title}”.`,
            pull: {
              number: first,
              title: chat.title,
              author: YOU,
              opened: "earlier",
              branch: `chat/${chat.id}`,
              surface: SURFACES.conversation,
            },
            staff: propose(home, "babysit"),
          },
    );
    go({ kind: "stack", stack: target });
  };

  const drop = (event: DragEndEvent): void => {
    setCarrying(null);
    const target = droppedOn(event.over?.id);
    const chat = CHATS.find((entry) => `${CHAT}${entry.id}` === String(event.active.id));

    if (target !== null && chat !== undefined) hand(chat, target);
  };

  const title =
    screen.kind === "new"
      ? "New Stack"
      : item === undefined
        ? (stack?.name ?? "Stacks")
        : item.title;

  return (
    <PageScheme value={scheme}>
      <DndContext
        sensors={sensors}
        collisionDetection={pointerWithin}
        autoScroll={false}
        onDragStart={(event) => setCarrying(String(event.active.id).slice(CHAT.length))}
        onDragCancel={() => setCarrying(null)}
        onDragEnd={drop}
      >
        <div {...props(shell.shell)}>
          <Titlebar
            tab={{
              id: "stack",
              title,
              tooltip: title,
              glyph:
                item === undefined ? (
                  <Icon
                    name={screen.kind === "new" ? "plus" : (stack?.icon ?? "layers")}
                    size={14}
                  />
                ) : (
                  <StatusGlyph status={item.status} />
                ),
              unread: false,
              split: undefined,
            }}
            docked={shown && !drawer}
            open={shown}
            onSidebar={() =>
              setBoard((current) => ({ ...current, sidebar: !(current.sidebar ?? !drawer) }))
            }
            onClose={() => go({ kind: "stack", stack: stack?.id ?? "polish" })}
            trailing={
              <LabControls
                scheme={scheme}
                pace={board.pace}
                onScheme={setScheme}
                onPace={(pace) => setBoard((current) => ({ ...current, pace }))}
                onReset={() => {
                  seen.current = new Set(
                    ITEMS.filter((entry) => entry.status === "needs-you").map((entry) => entry.id),
                  );
                  setBoard(START);
                }}
              />
            }
          />
          <div {...props(shell.stage, local.stage)}>
            {shown && drawer && carrying === null && (
              <button
                type="button"
                aria-label="Close sidebar"
                onClick={() => setBoard((current) => ({ ...current, sidebar: null }))}
                {...props(local.scrim)}
              />
            )}
            {shown && (
              <div {...props(shell.seat, drawer && local.drawer)}>
                <StacksSidebar
                  stacks={board.stacks.map((entry) => ({
                    id: entry.id,
                    name: entry.name,
                    icon: entry.icon,
                    waiting: board.items.filter(
                      (candidate) =>
                        candidate.stack === entry.id && candidate.status === "needs-you",
                    ).length,
                  }))}
                  selected={screen.kind === "new" ? null : (stack?.id ?? null)}
                  chats={CHATS}
                  handed={board.handed}
                  onOpenStack={(id) => go({ kind: "stack", stack: id })}
                  onNewStack={() => go({ kind: "new" })}
                />
              </div>
            )}
            <main {...props(shell.card, (!shown || drawer) && shell.cardSidebarHidden, local.card)}>
              {screen.kind === "new" ? (
                <NewStack
                  count={board.stacks.length}
                  onCreate={(made) =>
                    setBoard((current) => ({
                      ...current,
                      stacks: [...current.stacks, made],
                      screen: { kind: "stack", stack: made.id },
                    }))
                  }
                  onCancel={() => go({ kind: "stack", stack: "polish" })}
                />
              ) : stack === undefined ? null : screen.kind === "edit" ? (
                <NewStack
                  key={`edit-${stack.id}`}
                  count={board.stacks.length}
                  initial={stack}
                  onCreate={(edited) =>
                    setBoard((current) => ({
                      ...current,
                      stacks: current.stacks.map((entry) =>
                        entry.id === edited.id ? edited : entry,
                      ),
                      screen: { kind: "stack", stack: edited.id },
                    }))
                  }
                  onCancel={() => go({ kind: "stack", stack: stack.id })}
                />
              ) : item === undefined ? (
                <StackView
                  key={stack.id}
                  stack={stack}
                  items={board.items.filter((entry) => entry.stack === stack.id)}
                  pulls={board.pulls}
                  fresh={board.fresh}
                  clock={board.clock}
                  chats={board.handed}
                  onSend={(request) => send(stack.id, request)}
                  onOpen={(id) => go({ kind: "item", item: id })}
                  onEdit={() => go({ kind: "edit", stack: stack.id })}
                />
              ) : (
                <ItemView
                  key={item.id}
                  stack={stack}
                  item={item}
                  clock={board.clock}
                  onBack={() => go({ kind: "stack", stack: stack.id })}
                  onAnswer={(chosen) => answer(item.id, chosen)}
                  onReply={(note) => reply(item.id, note)}
                  onKeep={(finding) => keep(item.id, finding)}
                  onStop={() => stop(item.id)}
                />
              )}
            </main>
          </div>
          <Toaster />
        </div>
        <DragOverlay dropAnimation={null}>
          {carried === undefined ? null : (
            <div {...props(text.base, local.carried)}>
              <Icon name="new-chat" size={14} />
              <span {...props(local.carriedLabel)}>{carried.title}</span>
            </div>
          )}
        </DragOverlay>
      </DndContext>
    </PageScheme>
  );
}
