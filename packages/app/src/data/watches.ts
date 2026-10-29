import { asId } from "@nyte-ai/schema";
import { pagedViews, tracePaints } from "@nyte-ai/sdk";
import type {
  GitStatus,
  HostView,
  JobView,
  McpView,
  PagedViews,
  PartId,
  PartView,
  SessionId,
  SessionInfo,
  SessionView,
  WorkspaceId,
} from "@nyte-ai/sdk";
import { startupReadsReleased } from "./startup.ts";
import { countWork } from "../lib/work-counts.ts";
import { sessionActivityProjector } from "./session-activity.ts";
import type { LoadedSessionView } from "./session-activity.ts";
import { createTextPacer } from "./paced-text.ts";
import { type WatchStore, watchFamily } from "./watch-store.ts";

export const hostWatch = watchFamily((current, _key: "host"): AsyncIterable<HostView> =>
  current.watch(),
);

export const sessionsWatch = watchFamily(
  (current, parents: "roots" | "all"): AsyncIterable<readonly SessionInfo[]> =>
    current.sessions.watch({ parents: { kind: parents } }),
);

export function findListedSession(session: SessionId): SessionInfo | undefined {
  return (
    sessionsWatch("roots").value?.find((item) => item.id === session) ??
    sessionsWatch("all").value?.find((item) => item.id === session)
  );
}

export const childrenWatch = watchFamily(
  (current, session: SessionId): AsyncIterable<readonly SessionInfo[]> =>
    current.sessions.watch({ parents: { kind: "children", session } }),
);

const OPENING_TAIL = 40;

const NO_TRANSCRIPTS: ReadonlySet<SessionId> = new Set();

let shownTranscripts: () => ReadonlySet<SessionId> = () => NO_TRANSCRIPTS;

/** Paces streamed text only in the transcripts `shown` reads as on screen; every other view publishes text as it arrives. */
export function paceTranscripts(shown: () => ReadonlySet<SessionId>): void {
  shownTranscripts = shown;
}

/** What an open view says about its own run: the viewed head's execution and every head's read state. */
export type OpenView = Pick<SessionView, "execution" | "heads">;

let views: ReadonlyMap<SessionId, OpenView> = new Map();

const viewListeners = new Set<() => void>();

/** Every session whose view is open, as its view last reported it, before text pacing; a new map once any changes. */
export function openViews(): ReadonlyMap<SessionId, OpenView> {
  return views;
}

export function subscribeOpenViews(listener: () => void): () => void {
  viewListeners.add(listener);

  return () => viewListeners.delete(listener);
}

function reportView(session: SessionId, view: OpenView | undefined): void {
  const known = views.get(session);

  if (view === undefined ? known === undefined : keepItem(known, view) === known) return;
  const next = new Map(views);

  if (view === undefined) next.delete(session);
  else next.set(session, view);
  views = next;

  for (const listener of viewListeners) listener();
}

const pagers = new Map<SessionId, PagedViews>();

function nextFrame(): Promise<void> {
  return new Promise((resolve) => requestAnimationFrame(() => setTimeout(resolve, 0)));
}

function keepItem<T>(shown: T | undefined, next: T): T {
  return shown !== undefined && JSON.stringify(shown) === JSON.stringify(next) ? shown : next;
}

function keepItems<T>(
  shown: readonly T[],
  next: readonly T[],
  key: (item: T) => string,
): readonly T[] {
  const known = new Map(shown.map((item) => [key(item), item]));
  const items = next.map((item) => keepItem(known.get(key(item)), item));

  return items.length === shown.length && items.every((item, index) => item === shown[index])
    ? shown
    : items;
}

function keepShown(shown: SessionView, next: SessionView): SessionView {
  return {
    ...next,
    messages: keepItems(shown.messages, next.messages, (message) => message.id),
    queue: keepItems(shown.queue, next.queue, (message) => message.id),
    leadingPrompt: keepItem(shown.leadingPrompt, next.leadingPrompt),
    turns: keepItems(shown.turns, next.turns, (turn) => turn.id),
    changes: keepItems(shown.changes, next.changes, (change) => change.path),
  };
}

export const sessionWatch = watchFamily(
  (current, session: SessionId): AsyncIterable<LoadedSessionView> => {
    return {
      [Symbol.asyncIterator]() {
        const views = pagedViews(current.session(session), { tail: OPENING_TAIL });
        const iterator = tracePaints(views, session, nextFrame)[Symbol.asyncIterator]();
        const activity = sessionActivityProjector();

        const pacer = createTextPacer<LoadedSessionView>(
          () => shownTranscripts().has(session),
          (view) => sessionWatch(session).revise(view),
        );

        pagers.set(session, views);
        let first = true;

        return {
          async next() {
            const next = await iterator.next();

            if (next.done === true) return next;
            countWork(`publish:view:${session}`);

            let view = next.value;

            if (first) {
              first = false;
              const shown = sessionWatch(session).value;

              if (shown !== undefined) view = keepShown(shown, view);
            }

            reportView(session, { execution: view.execution, heads: view.heads });

            return { done: false, value: pacer.receive({ ...view, activity: activity(view) }) };
          },
          async return() {
            pacer.dispose();
            reportView(session, undefined);

            if (pagers.get(session) === views) pagers.delete(session);
            await iterator.return?.();

            return { done: true, value: undefined };
          },
        };
      },
    };
  },
);

const partWatches = watchFamily((current, key: string): AsyncIterable<PartView | null> => {
  const [session = "", part = ""] = key.split(" ");

  return current.session(asId<"session">(session)).part(asId<"part">(part)).watch();
});

/** One part, live wherever it sits in its chat, even past the messages the chat's view holds. */
export function partWatch(session: SessionId, part: PartId): WatchStore<PartView | null> {
  return partWatches(`${session} ${part}`);
}

const WARM_SESSIONS = 3;

const WARM_MS = 5_000;

const hotSet = new Map<SessionId, () => void>();

export function warmSession(session: SessionId): void {
  const holds = [
    sessionWatch(session).subscribe(() => undefined),
    childrenWatch(session).subscribe(() => undefined),
  ];

  const release = (): void => {
    clearTimeout(timer);

    if (hotSet.get(session) === release) hotSet.delete(session);

    for (const leave of holds) leave();
  };

  const timer = setTimeout(release, WARM_MS);
  hotSet.get(session)?.();
  hotSet.set(session, release);

  if (hotSet.size > WARM_SESSIONS) hotSet.values().next().value?.();
}

export async function loadEarlierMessages(session: SessionId, limit: number): Promise<number> {
  return (await pagers.get(session)?.earlier(limit)) ?? 0;
}

export const jobsWatch = watchFamily(
  (current, workspace: WorkspaceId): AsyncIterable<readonly JobView[]> =>
    current.workspace(workspace).jobs.watch(),
);

export const mcpWatch = watchFamily((current, workspace: WorkspaceId): AsyncIterable<McpView> =>
  current.workspace(workspace).mcp.watch(),
);

export const gitStatusWatch = watchFamily(
  (current, workspace: WorkspaceId): AsyncIterable<GitStatus> =>
    (async function* () {
      await startupReadsReleased();
      const git = await current.workspace(workspace).git();

      if (git.kind === "available") yield* git.api.watch();
    })(),
);
