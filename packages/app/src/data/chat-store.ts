import { asId } from "@nyte-ai/schema";
import type { PartId, PartView } from "@nyte-ai/schema";
import { tracePaints } from "@nyte-ai/sdk";
import type { MessageId, SessionId } from "@nyte-ai/sdk";
import type { Chat, ChatSnapshot, Freshness, HeadView, PartSnapshot } from "@nyte-ai/sdk/client";
import { useSyncExternalStore } from "react";
import { countWork } from "../lib/work-counts.ts";
import { heldSessions, nextExpiry, nextHolds, NO_HOLDS } from "./chat-holds.ts";
import type { HoldEvent } from "./chat-holds.ts";
import { connection, onInstall } from "./connection.ts";
import { reconcile } from "./keep.ts";
import { createTextPacer } from "./paced-text.ts";
import { sessionActivityProjector } from "./session-activity.ts";
import type { SessionActivity } from "./session-activity.ts";
import { liveValues, watchFamily } from "./watch-store.ts";
import type { LiveView, Shown } from "./watch-store.ts";

export interface ChatView extends HeadView {
  readonly seq: number;
  readonly freshness: Freshness;
  readonly activity: SessionActivity;
  /** The unsent messages the journal no longer sends on its own, the same array until it changes. */
  readonly expired: readonly MessageId[];
  readonly stopping: ChatSnapshot["stopping"];
}

type LaidView = Omit<ChatView, "activity">;

const OPENING_TAIL = 40;

const REOPENING_TAIL = 240;

const NO_TRANSCRIPTS: ReadonlySet<SessionId> = new Set();

let shownTranscripts: () => ReadonlySet<SessionId> = () => NO_TRANSCRIPTS;

export function paceTranscripts(shown: () => ReadonlySet<SessionId>): void {
  shownTranscripts = shown;
}

/** The chat each session's store draws, while it is open: its stop and its older pages belong to that one. */
const chats = new Map<SessionId, Chat>();

/** Hear when a session's open chat is set or dropped. */
const chatsChanged = new Set<() => void>();

function changeChats(change: () => void): void {
  change();

  for (const listener of chatsChanged) listener();
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

export const chatStore = watchFamily((opened, session: SessionId): AsyncIterable<ChatView> => ({
  [Symbol.asyncIterator]() {
    const known = chatStore(session).value?.messages.length ?? 0;
    const tail = Math.min(Math.max(OPENING_TAIL, known), REOPENING_TAIL);
    const chat = opened.chat(session, { tail });
    const iterator = tracePaints(laidViews(chat), session, nextFrame)[Symbol.asyncIterator]();
    const activity = sessionActivityProjector();

    const pacer = createTextPacer<ChatView>(
      () => shownTranscripts().has(session),
      (view) => chatStore(session).revise(view),
    );

    changeChats(() => chats.set(session, chat));

    return {
      async next() {
        const next = await iterator.next();

        if (next.done === true) return next;
        countWork(`publish:view:${session}`);

        return {
          done: false,
          value: pacer.receive({ ...next.value, activity: activity(next.value) }),
        };
      },
      async return() {
        pacer.dispose();

        if (chats.get(session) === chat) changeChats(() => chats.delete(session));
        await iterator.return?.();

        return { done: true, value: undefined };
      },
    };
  },
}));

function laidViews(chat: Chat) {
  return liveValues<LaidView>((changed) => {
    let shown: { readonly snapshot: ChatSnapshot; readonly view: LaidView } | null = null;

    return {
      read() {
        const snapshot = chat.snapshot();
        const freshness = snapshot.freshness;

        if (snapshot.view === null) {
          if (freshness.kind === "stale" && freshness.error !== null) throw freshness.error;

          return null;
        }

        if (shown?.snapshot !== snapshot)
          shown = {
            snapshot,
            view: {
              ...snapshot.view,
              seq: snapshot.seq,
              freshness,
              expired: snapshot.expired,
              stopping: snapshot.stopping,
            },
          };

        return shown.view;
      },
      close: chat.subscribe(changed),
    };
  });
}

export type ShownPart = { readonly part: PartView | null; readonly staleSince: number | null };

const partStores = watchFamily((opened, key: string): LiveView<ShownPart> => {
  const [session = "", part = ""] = key.split(" ");
  const store = opened.part(asId<"session">(session), asId<"part">(part));
  const retained = partStores(key).value;

  return {
    subscribe: (listener) => store.subscribe(listener),
    show: (previous) =>
      showPart({ snapshot: store.snapshot(), freshness: store.freshness() }, previous ?? retained),
    close: () => store.close(),
  };
});

/** The part, or the one shown before while the store has none, with when it went stale; `previous` itself while neither changed. A store with no part to show fails with its error, or waits. */
export function showPart(
  store: { readonly snapshot: PartSnapshot | null; readonly freshness: Freshness },
  previous: ShownPart | undefined,
): Shown<ShownPart> {
  const freshness = store.freshness;
  const staleSince = freshness.kind === "stale" ? freshness.since : null;
  const found = store.snapshot === null ? previous?.part : store.snapshot.part;

  if (found === undefined)
    return freshness.kind === "stale" && freshness.error !== null
      ? { kind: "failed", error: freshness.error }
      : { kind: "waiting" };

  if (previous?.part === found && previous.staleSince === staleSince)
    return { kind: "shown", value: previous };

  return { kind: "shown", value: { part: found, staleSince } };
}

export function partStore(session: SessionId, part: PartId) {
  return partStores(`${session} ${part}`);
}

let holds = NO_HOLDS;

const held = new Map<SessionId, () => void>();

let expiry: ReturnType<typeof setTimeout> | undefined;

/** Applies `event` to the holds, holds each chat they name and releases the rest, and sets the one timer at the next warm hold's end. */
function hold(event: HoldEvent): void {
  holds = nextHolds(holds, event);
  reconcile(
    held,
    heldSessions(holds),
    (session) => chatStore(session).subscribe(() => undefined),
    (release) => release(),
  );
  clearTimeout(expiry);
  const until = nextExpiry(holds);

  expiry =
    until === null
      ? undefined
      : setTimeout(() => hold({ kind: "tick", now: Date.now() }), until - Date.now());
}

onInstall((replaced) => {
  if (replaced) hold({ kind: "replaced" });
});

export function keepChat(session: SessionId): void {
  hold({ kind: "keep", session });
}

export function warmSession(session: SessionId): void {
  hold({ kind: "warm", session, now: Date.now() });
}

/** Sends an unsent message the journal stopped sending after a day again, as if just sent. */
export function resendMessage(session: SessionId, message: MessageId): Promise<void> {
  return connection().chat(session).resend(message);
}

/** Asks the host to stop the run the session's open chat shows; see `Chat.stop`. */
export function stopChat(session: SessionId): Promise<void> {
  return chats.get(session)?.stop() ?? Promise.resolve();
}

/**
 * The open chat's `stopping`, read from the chat itself as soon as it changes, not on the next
 * frame the chat store publishes, so a pressed Stop shows in the commit that pressed it.
 */
export function useChatStopping(session: SessionId): ChatSnapshot["stopping"] {
  return useSyncExternalStore(
    (notice) => {
      let leave = chats.get(session)?.subscribe(notice);

      const follow = (): void => {
        leave?.();
        leave = chats.get(session)?.subscribe(notice);
        notice();
      };

      chatsChanged.add(follow);

      return () => {
        chatsChanged.delete(follow);
        leave?.();
      };
    },
    () => chats.get(session)?.snapshot().stopping ?? "no",
  );
}

export async function loadEarlierMessages(session: SessionId, limit: number): Promise<number> {
  return (await chats.get(session)?.earlier(limit)) ?? 0;
}
