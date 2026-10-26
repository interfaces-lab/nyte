import { create, props } from "@stylexjs/stylex";
import { useEffect, useRef, useState, useSyncExternalStore } from "react";
import type { ReactElement } from "react";
import { sidebar } from "@nyte-ai/app/theme/schema.stylex.ts";
import { Icon } from "@nyte-ai/ui/icon";
import { role, shadow } from "@nyte-ai/ui/styles/vars.stylex";
import { Toaster, toast } from "@nyte-ai/ui/toast";
import { useMountEffect } from "@nyte-ai/ui/use-mount-effect";
import { styles as shell } from "../projects/page.stylex";
import { useDisplayMode } from "../shell/display-mode";
import type { DisplayMode } from "../shell/display-mode";
import { createItem } from "./delegate.ts";
import { LabControls } from "./lab-controls.tsx";
import type { Pace } from "./lab-controls.tsx";
import type { Request } from "./delegate.ts";
import { Inbox } from "./inbox.tsx";
import { ItemView } from "./item-view.tsx";
import { MODELS, SURFACES, YOU } from "./model.ts";
import type { Answer, Chat, Duty, Item, ModelId, PullRequest, Session, Stack } from "./model.ts";
import { NewStack } from "./new-stack.tsx";
import { StatusGlyph } from "./parts.tsx";
import { PageScheme } from "./shots.tsx";
import { TICK_MS, advance, land, revisionSteps, schedule } from "./script.ts";
import { CHATS, ITEMS, OPEN_PULLS, STACKS } from "./seed.ts";
import { StacksSidebar } from "./sidebar.tsx";
import { StackView } from "./stack-view.tsx";
import { Titlebar } from "./titlebar.tsx";

type Screen =
  | { readonly kind: "inbox" }
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
   * browser panel all change its room: 959px and under stacks the columns, 759px moves inline
   * controls to their own line, 639px is phone-sized and drops hints a touch screen can't use.
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
});

export function StacksPage(): ReactElement {
  const [board, setBoard] = useState(START);
  const [scheme, setScheme] = useState<DisplayMode>("light");

  const drawer = useSyncExternalStore(
    watchDrawer,
    () => window.matchMedia(DRAWER_QUERY).matches,
    () => false,
  );

  const shown = board.sidebar ?? !drawer;

  const seen = useRef(
    new Set(ITEMS.filter((item) => item.status === "needs-you").map((item) => item.id)),
  );

  const screen = board.screen;

  const item =
    screen.kind === "item" ? board.items.find((entry) => entry.id === screen.item) : undefined;

  const stackId = screen.kind === "stack" || screen.kind === "edit" ? screen.stack : item?.stack;
  const stack = board.stacks.find((entry) => entry.id === stackId);

  const go = (next: Screen): void =>
    setBoard((current) => ({
      ...current,
      screen: next,
      fresh: next.kind === "item" ? null : current.fresh,
      sidebar: drawer ? null : current.sidebar,
    }));

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
          request.kind === "fix"
            ? current.pulls
            : current.pulls.filter((pull) => pull.number !== request.pull.number),
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

  const reply = (id: string, session: Session | undefined, text: string): void =>
    update(id, (entry, current) => {
      const home = current.stacks.find((candidate) => candidate.id === entry.stack);
      const who = session === undefined ? (home?.name ?? "Stack") : MODELS[session.model].short;

      const heard = land(
        land(
          entry,
          { wait: 0, event: { who: "You", what: "replied", text, mine: true } },
          current.clock,
        ),
        {
          wait: 0,
          event: { who, what: "picked it up", text: "Working your note into the same branch." },
        },
        current.clock,
      );

      if (home === undefined || entry.kind !== "fix" || entry.script.length > 0) return heard;

      return schedule(
        land(
          heard,
          { wait: 0, status: "working", now: `${who} is revising`, ask: null },
          current.clock,
        ),
        revisionSteps(home, entry.number ?? 495 + current.made, 1),
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

  const crew = (target: string, duty: Duty, model: ModelId): void =>
    setBoard((current) => ({
      ...current,
      stacks: current.stacks.map((entry) =>
        entry.id === target ? { ...entry, crew: { ...entry.crew, [duty]: model } } : entry,
      ),
    }));

  const hand = (chat: Chat, target: string): void => {
    const first = chat.pulls[0];

    setBoard((current) => ({ ...current, handed: { ...current.handed, [chat.id]: target } }));
    send(
      target,
      first === undefined
        ? { kind: "fix", text: "Take over this chat and finish it.", title: chat.title }
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
          },
    );
    go({ kind: "stack", stack: target });
  };

  const title =
    screen.kind === "new"
      ? "New Stack"
      : screen.kind === "inbox"
        ? "Needs You"
        : item === undefined
          ? (stack?.name ?? "Stacks")
          : item.title;

  return (
    <PageScheme value={scheme}>
      <div {...props(shell.shell)}>
        <Titlebar
          tab={{
            id: "stack",
            title,
            tooltip: title,
            glyph:
              item === undefined ? (
                <Icon
                  name={
                    screen.kind === "new"
                      ? "plus"
                      : screen.kind === "inbox"
                        ? "inbox-empty"
                        : (stack?.icon ?? "layers")
                  }
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
        <div {...props(shell.stage)}>
          {board.sidebar && (
            <div {...props(shell.seat)}>
              <StacksSidebar
                stacks={board.stacks.map((entry) => ({
                  id: entry.id,
                  name: entry.name,
                  icon: entry.icon,
                  waiting: board.items.filter(
                    (candidate) => candidate.stack === entry.id && candidate.status === "needs-you",
                  ).length,
                }))}
                selected={
                  screen.kind === "new" || screen.kind === "inbox" ? null : (stack?.id ?? null)
                }
                creating={screen.kind === "new"}
                inbox={screen.kind === "inbox"}
                waiting={board.items.filter((entry) => entry.status === "needs-you").length}
                onInbox={() => go({ kind: "inbox" })}
                chats={CHATS}
                handed={board.handed}
                onOpenStack={(id) => go({ kind: "stack", stack: id })}
                onNewStack={() => go({ kind: "new" })}
                onHand={hand}
              />
            </div>
          )}
          <main {...props(shell.card, (!shown || drawer) && shell.cardSidebarHidden, local.card)}>
            {screen.kind === "inbox" ? (
              <Inbox
                stacks={board.stacks}
                items={board.items}
                clock={board.clock}
                onOpen={(id) => go({ kind: "item", item: id })}
                onAnswer={answer}
              />
            ) : screen.kind === "new" ? (
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
                onSend={(request) => send(stack.id, request)}
                onOpen={(id) => go({ kind: "item", item: id })}
                onAnswer={answer}
                onCrew={(duty, model) => crew(stack.id, duty, model)}
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
                onReply={(session, text) => reply(item.id, session, text)}
                onKeep={(finding) => keep(item.id, finding)}
                onStop={() => stop(item.id)}
              />
            )}
          </main>
        </div>
        <Toaster />
      </div>
    </PageScheme>
  );
}
