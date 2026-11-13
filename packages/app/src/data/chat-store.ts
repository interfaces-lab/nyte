import { asId } from "@nyte-ai/schema";
import type { PartId, PartView } from "@nyte-ai/schema";
import { pagedViews, tracePaints } from "@nyte-ai/sdk";
import type { PagedViews, SessionId } from "@nyte-ai/sdk";
import { unsentSends } from "@nyte-ai/sdk/client";
import type { ChatSnapshot, Freshness, HeadView, HostConnection } from "@nyte-ai/sdk/client";
import { countWork } from "../lib/work-counts.ts";
import { connection, registries } from "./connection.ts";
import { createTextPacer } from "./paced-text.ts";
import { sessionActivityProjector } from "./session-activity.ts";
import type { SessionActivity } from "./session-activity.ts";
import { liveFamily, liveValues } from "./watch-store.ts";

export interface ChatView extends HeadView {
  readonly seq: number;
  readonly freshness: Freshness;
  readonly activity: SessionActivity;
}

type LaidView = HeadView & { readonly seq: number; readonly freshness: Freshness };

const MAIN = asId<"head">("main");

const OPENING_TAIL = 40;

const REOPENING_TAIL = 240;

const NO_TRANSCRIPTS: ReadonlySet<SessionId> = new Set();

let shownTranscripts: () => ReadonlySet<SessionId> = () => NO_TRANSCRIPTS;

export function paceTranscripts(shown: () => ReadonlySet<SessionId>): void {
  shownTranscripts = shown;
}

const pagers = new Map<SessionId, PagedViews<LaidView>>();

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

export const chatStore = liveFamily((live, session: SessionId): AsyncIterable<ChatView> => ({
  [Symbol.asyncIterator]() {
    const known = chatStore(session).value?.messages.length ?? 0;
    const tail = Math.min(Math.max(OPENING_TAIL, known), REOPENING_TAIL);

    const views = pagedViews<LaidView>({
      watch: () => laidViews(live, session, tail),
      history: (query) => connection().session(session).history(query),
    });

    const iterator = tracePaints(views, session, nextFrame)[Symbol.asyncIterator]();
    const activity = sessionActivityProjector();

    const pacer = createTextPacer<ChatView>(
      () => shownTranscripts().has(session),
      (view) => chatStore(session).revise(view),
    );

    pagers.set(session, views);

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

        if (pagers.get(session) === views) pagers.delete(session);
        await iterator.return?.();

        return { done: true, value: undefined };
      },
    };
  },
}));

function laidViews(live: HostConnection, session: SessionId, tail: number) {
  return liveValues<LaidView>((changed) => {
    const chat = live.chat(session, MAIN, {
      tail,
      unsent: unsentSends(connection(), session, MAIN),
    });

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
          shown = { snapshot, view: { ...snapshot.view, seq: snapshot.seq, freshness } };

        return shown.view;
      },
      close: chat.subscribe(changed),
    };
  });
}

export type ShownPart = { readonly part: PartView | null; readonly staleSince: number | null };

const partStores = liveFamily((live, key: string): AsyncIterable<ShownPart> =>
  liveValues<ShownPart>((changed) => {
    const [session = "", part = ""] = key.split(" ");
    const store = live.part(asId<"session">(session), asId<"part">(part));
    const stop = store.subscribe(changed);
    let shown = partStores(key).value ?? null;

    return {
      read() {
        const freshness = store.freshness();
        const staleSince = freshness.kind === "stale" ? freshness.since : null;
        const snapshot = store.snapshot();
        const found = snapshot === null ? shown?.part : snapshot.part;

        if (found === undefined) {
          if (freshness.kind === "stale" && freshness.error !== null) throw freshness.error;

          return null;
        }

        if (shown?.part === found && shown.staleSince === staleSince) return shown;
        shown = { part: found, staleSince };

        return shown;
      },
      close() {
        stop();
        store.close();
      },
    };
  }),
);

export function partStore(session: SessionId, part: PartId) {
  return partStores(`${session} ${part}`);
}

const KEPT_CHATS = 8;

const kept = new Map<SessionId, () => void>();

registries.add({
  clear() {
    for (const release of kept.values()) release();
    kept.clear();
  },
});

export function keepChat(session: SessionId): void {
  const held = kept.get(session) ?? chatStore(session).subscribe(() => undefined);
  kept.delete(session);
  kept.set(session, held);

  for (const [oldest, release] of kept) {
    if (kept.size <= KEPT_CHATS) break;
    kept.delete(oldest);
    release();
  }
}

const WARM_SESSIONS = 3;

const WARM_MS = 5_000;

const hotSet = new Map<SessionId, () => void>();

export function warmSession(session: SessionId): void {
  const hold = chatStore(session).subscribe(() => undefined);

  const release = (): void => {
    clearTimeout(timer);

    if (hotSet.get(session) === release) hotSet.delete(session);
    hold();
  };

  const timer = setTimeout(release, WARM_MS);
  hotSet.get(session)?.();
  hotSet.set(session, release);

  if (hotSet.size > WARM_SESSIONS) hotSet.values().next().value?.();
}

export async function loadEarlierMessages(session: SessionId, limit: number): Promise<number> {
  return (await pagers.get(session)?.earlier(limit)) ?? 0;
}
