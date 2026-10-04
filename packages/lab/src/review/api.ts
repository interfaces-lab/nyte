/**
 * The Review page's line to the lab's review core (`server/review.ts`) and to
 * real core itself, all through React Query: no effects, no timers.
 *
 * What changes on its own (a brief landing, an answer arriving) comes from one
 * Nyte watch on the review's core session, read through `@nyte-ai/client` as
 * a streamed query that counts the events that matter. That count is part of
 * every dependent query's key, so each event refetches exactly what it can
 * change. A branch that gained commits shows up when the window regains focus,
 * because that is when you come back from committing.
 */
import { createNyteClient, type NyteClient } from "@nyte-ai/client";
import type { SessionEvent, SessionId, Turn } from "@nyte-ai/protocol";
import {
  experimental_streamedQuery,
  useMutation,
  useQuery,
  useQueryClient,
  type Query,
} from "@tanstack/react-query";
import type { Static, TSchema } from "typebox";
import { Value } from "typebox/value";
import {
  CompareSchema,
  CreatedSchema,
  ErrorSchema,
  PatchListSchema,
  RepoSchema,
  ReviewDetailSchema,
  ReviewListSchema,
  SessionSchema,
  type Ask,
  type Change,
  type Chat,
  type CreateReview,
  type ReviewDetail,
  type Task,
} from "./wire";

const ROOT = "/core/review";

export class ReviewError extends Error {
  /** The lab's dev server is not serving core: a static build, or core failed to open. */
  readonly offline: boolean;

  constructor(message: string, offline: boolean) {
    super(message);
    this.offline = offline;
  }
}

async function request<T extends TSchema>(
  schema: T,
  path: string,
  body?: Ask | Change | CreateReview | Task | { readonly head: string },
): Promise<Static<T>> {
  const response = await fetch(`${ROOT}${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: body === undefined ? undefined : { "content-type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  }).catch(() => undefined);

  if (response === undefined) throw new ReviewError("The lab's dev server is not running.", true);

  const reply: unknown = await response.json().catch(() => undefined);

  if (response.ok && Value.Check(schema, reply)) return reply;

  if (Value.Check(ErrorSchema, reply)) throw new ReviewError(reply.error, response.status === 503);

  throw new ReviewError("This lab build has no review core. Run it with `pnpm dev`.", true);
}

export const keys = {
  repo: ["review", "repo"] as const,
  list: ["review", "list"] as const,
  detail: (id: string) => ["review", "detail", id] as const,
  session: (id: string) => ["review", "session", id] as const,
  events: (session: string) => ["review", "events", session] as const,
  turns: (session: string, head: string) => ["review", "turns", session, head] as const,
  compare: (base: string, head: string) => ["review", "compare", base, head] as const,
  patches: (id: string, base: string, head: string) =>
    ["review", "patches", id, base, head] as const,
};

/** What a review query needs that the app's client turns off: fresh reads and a refetch on focus. */
const LIVE = { staleTime: 0, refetchOnWindowFocus: true } as const;

/** Keep the previous result while the next one loads, but only for the same thing. */
function sameAs<Data>(prefix: readonly string[]) {
  return (
    previous: Data | undefined,
    query: Query<Data, Error, Data, readonly unknown[]> | undefined,
  ) => (prefix.every((part, index) => query?.queryKey[index] === part) ? previous : undefined);
}

export function useRepo() {
  return useQuery({
    queryKey: keys.repo,
    queryFn: () => request(RepoSchema, "/repo"),
    ...LIVE,
  });
}

export function useCompare(base: string | undefined, head: string | undefined) {
  return useQuery({
    queryKey: keys.compare(base ?? "", head ?? ""),
    queryFn: () =>
      request(
        CompareSchema,
        `/compare?base=${encodeURIComponent(base ?? "")}&head=${encodeURIComponent(head ?? "")}`,
      ),
    enabled: base !== undefined && head !== undefined && base !== "" && head !== "",
    placeholderData: (previous) => previous,
  });
}

/** `version` is the open review's event count: its guide status shows up in the list as it changes. */
export function useReviews(version: number) {
  return useQuery({
    queryKey: [...keys.list, version],
    queryFn: () => request(ReviewListSchema, "/reviews"),
    ...LIVE,
    placeholderData: (previous) => previous,
  });
}

export function useReview(id: string | undefined, version: number) {
  return useQuery({
    queryKey: [...keys.detail(id ?? ""), version],
    queryFn: () => request(ReviewDetailSchema, `/reviews/${encodeURIComponent(id ?? "")}`),
    enabled: id !== undefined,
    ...LIVE,
    placeholderData: sameAs(keys.detail(id ?? "")),
  });
}

/** Patches between two commit ids never change. */
export function usePatches(id: string, base: string | undefined, head: string | undefined) {
  return useQuery({
    queryKey: keys.patches(id, base ?? "", head ?? ""),
    queryFn: () =>
      request(
        PatchListSchema,
        `/reviews/${encodeURIComponent(id)}/patches?base=${base ?? ""}&head=${head ?? ""}`,
      ),
    enabled: base !== undefined && head !== undefined,
  });
}

export function useCreateReview() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (input: CreateReview) => request(CreatedSchema, "/reviews", input),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.list }),
  });
}

/**
 * A review's core sessions never change once they exist, so their event
 * streams can start before the review loads. Nyte's session appears with the
 * first change request; that request refetches this.
 */
export function useSessions(id: string | undefined) {
  const { data } = useQuery({
    queryKey: keys.session(id ?? ""),
    queryFn: () => request(SessionSchema, `/reviews/${encodeURIComponent(id ?? "")}/session`),
    enabled: id !== undefined,
  });

  return data;
}

export function useStartTask() {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (input: Task) => request(CreatedSchema, "/tasks", input),
    onSuccess: () => client.invalidateQueries({ queryKey: keys.list }),
  });
}

function useDetailMutation<Input extends Ask | Change | { readonly head: string }>(
  id: string,
  path: string,
) {
  const client = useQueryClient();

  return useMutation({
    mutationFn: (input: Input) =>
      request(ReviewDetailSchema, `/reviews/${encodeURIComponent(id)}/${path}`, input),
    onSuccess: () =>
      Promise.all([
        client.invalidateQueries({ queryKey: keys.detail(id) }),
        client.invalidateQueries({ queryKey: keys.session(id) }),
      ]),
  });
}

export const useAsk = (id: string) => useDetailMutation<Ask>(id, "ask");

export const useChange = (id: string) => useDetailMutation<Change>(id, "change");

export const useApprove = (id: string) =>
  useDetailMutation<{ readonly head: string }>(id, "approve");

export const useRetry = (id: string) => useDetailMutation<{ readonly head: string }>(id, "retry");

let nyteClient: NyteClient | undefined;

function nyte(): NyteClient {
  nyteClient ??= createNyteClient({
    baseUrl: new URL("/core/nyte", window.location.origin).href,
  });

  return nyteClient;
}

async function* emptyStream(): AsyncIterable<SessionEvent> {}

/** Events that can change a head, its run, or its queue; text and progress cannot. */
function changesReview(event: SessionEvent): boolean {
  return (
    event.kind === "commit" ||
    event.kind === "run" ||
    event.kind === "head_moved" ||
    event.kind === "stack" ||
    event.kind === "queued" ||
    event.kind === "landed"
  );
}

/**
 * How many events that change the review core has sent on `session` while
 * this page watched it. The watch is the query: it streams for as long as
 * something observes it, unmounting aborts it, and a dropped stream is
 * retried with the library's backoff. Appending keeps the count rising across
 * reconnects, so no dependent key ever falls back to an older value.
 */
export function useCoreEvents(session: SessionId | undefined): number {
  const { data } = useQuery({
    queryKey: keys.events(session ?? ""),
    queryFn: experimental_streamedQuery({
      streamFn: (context) =>
        session === undefined
          ? emptyStream()
          : nyte().watch({ sessionId: session, live: true, signal: context.signal }),
      refetchMode: "append",
      reducer: (seen: number, event: SessionEvent) => (changesReview(event) ? seen + 1 : seen),
      initialValue: 0,
    }),
    enabled: session !== undefined,
    retry: 3,
    ...LIVE,
  });

  return data ?? 0;
}

/** A turn of the conversation itself, as the transcript draws it. */
export type ConversationTurn = Extract<Turn, { readonly kind: "turn" }>;

const isConversationTurn = (turn: Turn): turn is ConversationTurn => turn.kind === "turn";

/** One turn in the side chat: whose it is, and for the reviewer, which head it was about. */
export interface ChatTurn {
  readonly turn: ConversationTurn;
  readonly source: "nyte" | "reviewer";
  readonly head?: string;
}

async function headTurns(
  session: SessionId,
  head: string,
  forkedAt: number | null,
): Promise<readonly ConversationTurn[]> {
  const snapshot = await nyte().sessions.snapshot({ sessionId: session, head });

  return (snapshot?.transcript ?? [])
    .filter(isConversationTurn)
    .filter((turn) => forkedAt === null || turn.startedAt > forkedAt);
}

/** The turns a core head added after it was cut, read again whenever `version` moves. */
export function useHeadTurns(
  session: SessionId | undefined,
  head: { readonly name: string; readonly forkedAt: number | null } | undefined,
  version: number,
): readonly ConversationTurn[] {
  const name = head?.name ?? "";
  const forkedAt = head?.forkedAt ?? null;

  const { data } = useQuery({
    queryKey: [...keys.turns(session ?? "", name), forkedAt, version],
    queryFn: () =>
      session === undefined ? Promise.resolve([]) : headTurns(session, name, forkedAt),
    enabled: session !== undefined && head !== undefined,
    placeholderData: sameAs(keys.turns(session ?? "", name)),
  });

  return data ?? [];
}

/**
 * The side chat as one conversation: Nyte's work on the branch and the
 * reviewer's answers, in the order they happened. Two sessions, one timeline.
 */
export function useSideChat(review: ReviewDetail, version: number): readonly ChatTurn[] {
  const author = review.author?.sessionId;

  const { data } = useQuery({
    queryKey: ["review", "side-chat", review.id, author ?? "", review.chats.length, version],
    queryFn: async (): Promise<readonly ChatTurn[]> => {
      const reviewer = await Promise.all(
        review.chats.map(async (chat: Chat) =>
          (await headTurns(review.sessionId, chat.name, chat.forkedAt)).map((turn): ChatTurn => ({
            turn,
            source: "reviewer",
            head: chat.head,
          })),
        ),
      );

      const nyteTurns =
        author === undefined
          ? []
          : (await headTurns(author, "main", null)).map((turn): ChatTurn => ({
              turn,
              source: "nyte",
            }));

      return [...nyteTurns, ...reviewer.flat()].toSorted(
        (left, right) => left.turn.startedAt - right.turn.startedAt,
      );
    },
    placeholderData: sameAs(["review", "side-chat", review.id]),
  });

  return data ?? [];
}
