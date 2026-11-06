import { asId } from "@nyte-ai/schema";
import { pagedViews, tracePaints } from "@nyte-ai/sdk";
import type { PagedViews, SessionId } from "@nyte-ai/sdk";
import { headView, streamText, unsentSends, withStreamedText } from "@nyte-ai/sdk/client";
import type {
  Freshness,
  HeadStore,
  HeadView,
  HostConnection,
  StreamedText,
} from "@nyte-ai/sdk/client";
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
      watch: () => laidViews(live, live.head(session, MAIN, { tail }), session),
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

function laidViews(
  live: HostConnection,
  store: HeadStore,
  session: SessionId,
): AsyncIterable<LaidView> {
  return liveValues<LaidView>((changed) => {
    const unsent = unsentSends(connection(), session, MAIN);
    let texts: StreamedText = new Map();
    let seq = 0;
    let shown: { readonly source: HeadView; readonly view: LaidView } | null = null;
    const stops = [store.subscribe(changed), unsent.subscribe(changed)];

    const stopText = live.text((update) => {
      texts = streamText(texts, update);
      changed();
    });

    return {
      read() {
        const snapshot = store.snapshot();
        const freshness = store.freshness();

        if (snapshot === null) {
          if (freshness.kind === "stale" && freshness.error !== null) throw freshness.error;

          return null;
        }

        if (freshness.kind === "fresh") seq = freshness.seq;

        const source = withStreamedText(
          unsent.lay(headView(snapshot), freshness.kind === "fresh" ? freshness.seq : null),
          texts,
        );

        if (shown?.source === source && shown.view.freshness === freshness) return shown.view;
        shown = { source, view: { ...source, seq, freshness } };

        return shown.view;
      },
      close() {
        for (const stop of stops) stop();
        stopText();
        store.close();
      },
    };
  });
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
