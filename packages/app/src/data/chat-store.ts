import { asId } from "@nyte-ai/schema";
import type { PartId, PartView } from "@nyte-ai/schema";
import { paintSpans, SdkError } from "@nyte-ai/sdk";
import type { MessageId, SessionId } from "@nyte-ai/sdk";
import type {
  Chat,
  ChatSnapshot,
  ClientConnection,
  Freshness,
  HeadView,
  PartSnapshot,
} from "@nyte-ai/sdk/client";
import { useSyncExternalStore } from "react";
import { countWork } from "../lib/work-counts.ts";
import { heldSessions, nextExpiry, nextHolds, NO_HOLDS } from "./chat-holds.ts";
import type { HoldEvent } from "./chat-holds.ts";
import { connection, onInstall } from "./connection.ts";
import { reconcile } from "./keep.ts";
import { createTextPacer } from "./paced-text.ts";
import { sessionActivityProjector } from "./session-activity.ts";
import type { SessionActivity } from "./session-activity.ts";
import { watchFamily } from "./watch-store.ts";
import type { LiveView, Shown, WatchState } from "./watch-store.ts";

export interface ChatView extends HeadView {
  readonly seq: number;
  readonly freshness: Freshness;
  readonly activity: SessionActivity;
  readonly expired: readonly MessageId[];
  readonly stopping: ChatSnapshot["stopping"];
}

const OPENING_TAIL = 40;

const REOPENING_TAIL = 240;

const NO_TRANSCRIPTS: ReadonlySet<SessionId> = new Set();

let shownTranscripts: () => ReadonlySet<SessionId> = () => NO_TRANSCRIPTS;

export function paceTranscripts(shown: () => ReadonlySet<SessionId>): void {
  shownTranscripts = shown;
}

const chats = new Map<SessionId, Chat>();

const chatsChanged = new Set<() => void>();

function changeChats(change: () => void): void {
  change();

  for (const listener of chatsChanged) listener();
}

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

export const chatStore = watchFamily(openChat, (view) => staleChat(view, Date.now()));

function openChat(opened: ClientConnection, session: SessionId): LiveView<ChatView> {
  const known = chatStore(session).value?.messages.length ?? 0;
  const tail = Math.min(Math.max(OPENING_TAIL, known), REOPENING_TAIL);
  const chat = opened.chat(session, { tail });
  const activity = sessionActivityProjector();
  const paint = paintSpans(session, nextFrame);
  let drawn: ChatSnapshot | undefined;
  performance.mark("nyte:session-requested", { detail: session });

  const pacer = createTextPacer<ChatView>(
    () => shownTranscripts().has(session),
    (view) => chatStore(session).revise(view),
  );

  changeChats(() => chats.set(session, chat));

  return {
    subscribe: (listener) => chat.subscribe(listener),
    show(previous) {
      const snapshot = chat.snapshot();

      if (snapshot === drawn && previous !== undefined) return { kind: "shown", value: previous };
      const shown = showChat(snapshot, activity);

      if (shown.kind !== "shown") return shown;

      if (drawn === undefined) performance.mark("nyte:session-view", { detail: session });
      drawn = snapshot;
      paint(shown.value);
      countWork(`publish:view:${session}`);

      return { kind: "shown", value: pacer.receive(shown.value) };
    },
    close() {
      pacer.dispose();

      if (chats.get(session) === chat) changeChats(() => chats.delete(session));
    },
  };
}

function staleChat(view: ChatView, since: number): ChatView {
  return view.freshness.kind === "stale"
    ? view
    : { ...view, freshness: { kind: "stale", since, error: null } };
}

export function showChat(
  snapshot: ChatSnapshot,
  activity: (view: HeadView) => SessionActivity,
): Shown<ChatView> {
  const view = snapshot.view;
  const freshness = snapshot.freshness;

  if (view === null) {
    return freshness.kind === "stale" && freshness.error !== null
      ? { kind: "failed", error: freshness.error }
      : { kind: "waiting" };
  }

  return {
    kind: "shown",
    value: {
      ...view,
      seq: snapshot.seq,
      freshness,
      expired: snapshot.expired,
      stopping: snapshot.stopping,
      activity: activity(view),
    },
  };
}

export interface ShownPart {
  readonly part: PartView | null;
  readonly staleSince: number | null;
}

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

export function showPart(
  store: { readonly snapshot: PartSnapshot | null; readonly freshness: Freshness },
  previous: ShownPart | undefined,
): Shown<ShownPart> {
  const freshness = store.freshness;
  const staleSince = freshness.kind === "stale" ? freshness.since : null;
  const found = store.snapshot === null ? previous?.part : store.snapshot.part;

  if (found === undefined) {
    return freshness.kind === "stale" && freshness.error !== null
      ? { kind: "failed", error: freshness.error }
      : { kind: "waiting" };
  }

  if (previous?.part === found && previous.staleSince === staleSince) {
    return { kind: "shown", value: previous };
  }

  return { kind: "shown", value: { part: found, staleSince } };
}

export function partStore(session: SessionId, part: PartId) {
  return partStores(`${session} ${part}`);
}

let holds = NO_HOLDS;

const held = new Map<SessionId, () => void>();

let expiry: ReturnType<typeof setTimeout> | undefined;

function hold(event: HoldEvent): void {
  holds = nextHolds(holds, event);
  reconcile(
    held,
    heldSessions(holds),
    (session) => {
      const store = chatStore(session);

      return store.subscribe(() => {
        if (chatGone(store.getState())) queueMicrotask(() => hold({ kind: "gone", session }));
      });
    },
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

function chatGone(state: WatchState<ChatView>): boolean {
  const freshness = state.value?.freshness;
  const error = state.error ?? (freshness?.kind === "stale" ? freshness.error : null);

  return error instanceof SdkError && error.code === "unknown";
}

export function keepChat(session: SessionId): void {
  hold({ kind: "keep", session });
}

export function warmSession(session: SessionId): void {
  hold({ kind: "warm", session, now: Date.now() });
}

export function resendMessage(session: SessionId, message: MessageId): Promise<void> {
  return connection().chat(session).resend(message);
}

export function stopChat(session: SessionId): Promise<void> {
  return chats.get(session)?.stop() ?? Promise.resolve();
}

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
