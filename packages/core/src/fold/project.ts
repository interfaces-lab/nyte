import { compile, isJsonObject } from "@nyte-ai/schema";
import type {
  CommitId,
  Execution,
  HeadInfo,
  HeadName,
  Message,
  PartView,
  PrincipalId,
  QueuedMessage,
  Revision,
  SessionView,
  TurnInfo,
  Usage,
  ViewOptions,
} from "@nyte-ai/schema";
import { Type } from "typebox";
import { INDEX } from "../contract/fold.ts";
import type { FoldHead, FoldState, HeadPair, Path } from "../contract/fold.ts";
import { text, thinking } from "../contract/parts.ts";
import { readPositionCommit, START } from "../store/session.ts";
import { addUsage, ZERO_USAGE } from "../util/usage.ts";
import { emptyHead, reuse, snapshots } from "./draft.ts";

const DEFAULT_TAIL = 200;

const projections = new WeakMap<FoldHead, Map<PrincipalId, Map<number, SessionView>>>();

const unreads = new WeakMap<
  readonly HeadInfo[],
  WeakMap<ReadonlyMap<HeadName, CommitId | null>, readonly HeadInfo[]>
>();

const NOTHING_SEEN: ReadonlyMap<HeadName, CommitId | null> = new Map();

const tails = new WeakMap<readonly Message[], Map<number, readonly Message[]>>();

const queues = new WeakMap<readonly Message[], readonly QueuedMessage[]>();

const absent = new WeakMap<ReadonlyMap<HeadName, FoldHead>, Map<HeadName, FoldHead>>();

const windows = new WeakMap<Path, Map<number, readonly TurnInfo[]>>();

const usages = new WeakMap<readonly TurnInfo[], Usage>();

const unsigned = new WeakMap<Message, Message>();

const SIGNED: ReadonlySet<string> = new Set([text.kind, thinking.kind]);

const SIGNED_STATE = compile(Type.Object({ signature: Type.Unknown() }));

export function project(state: FoldState, head: HeadName, options?: ViewOptions): SessionView {
  const folded = state.heads.get(head) ?? absentHead(state.heads, head);
  const tail = options?.tail ?? DEFAULT_TAIL;
  const heads = headsFor(state);
  const byPrincipal = projections.get(folded) ?? new Map<PrincipalId, Map<number, SessionView>>();
  const byTail = byPrincipal.get(state.principal) ?? new Map<number, SessionView>();
  const cached = byTail.get(tail);

  if (
    cached !== undefined &&
    cached.seq === state.seq &&
    cached.activation === state.activation &&
    cached.parts === state.partViews &&
    cached.heads === heads &&
    cached.changes === state.changes &&
    cached.catalog === state.catalog
  )
    return cached;

  const execution = folded.info.execution;
  const messages = readMessageTail(folded.messages, tail, execution);
  const turns = frozen(folded.turns);
  const path = state[INDEX].paths.get(head);

  const view: SessionView = {
    revision: folded.revision,
    seq: state.seq,
    activation: state.activation,
    messages,
    queue: readQueue(state, folded),
    leadingPrompt: findLeadingPrompt(path, Math.max(0, folded.messages.length - tail)),
    parts: state.partViews,
    turns: readTurnWindow(turns, path, messages),
    usage: sumCompletedUsage(turns),
    execution,
    reportsHeld: holdsReports(execution),
    background: folded.background,
    configuration: folded.configuration,
    context: folded.context,
    heads,
    changes: state.changes,
    catalog: state.catalog,
  };

  byTail.set(tail, view);
  byPrincipal.set(state.principal, byTail);
  projections.set(folded, byPrincipal);

  return view;
}

export function holdsReports(execution: Execution): boolean {
  return execution.kind === "idle" && execution.lastRun?.end.kind !== "completed";
}

function headsFor(state: FoldState): readonly HeadInfo[] {
  const seen = state.seen.get(state.principal) ?? NOTHING_SEEN;
  const known = unreads.get(state.headInfos) ?? new WeakMap();
  const cached = known.get(seen);

  if (cached !== undefined) return cached;

  const heads = reuse(
    state.headInfos,
    state.headInfos.map((info) => {
      const unread = readPositionCommit(info.tip) !== (seen.get(info.name) ?? null);

      return info.unread === unread ? info : { ...info, unread };
    }),
  );

  known.set(seen, heads);
  unreads.set(state.headInfos, known);

  return heads;
}

export function withPair(state: FoldState, head: HeadName, pair: HeadPair): FoldState {
  const tip = readPositionCommit(state.heads.get(head)?.info.tip ?? START);

  return withRevision(state, head, tip === pair.tip ? pair.revision : null);
}

function withRevision(state: FoldState, head: HeadName, revision: Revision | null): FoldState {
  const folded = state.heads.get(head);

  if (folded === undefined || folded.revision === revision) return state;
  state[INDEX].heads.set(head, { ...folded, revision });

  return { ...state };
}

function absentHead(heads: ReadonlyMap<HeadName, FoldHead>, name: HeadName): FoldHead {
  const known = absent.get(heads) ?? new Map<HeadName, FoldHead>();
  const head = known.get(name) ?? emptyHead(name, { messages: [], turns: [] });
  known.set(name, head);
  absent.set(heads, known);

  return head;
}

function readMessageTail(
  messages: readonly Message[],
  tail: number,
  execution: Execution,
): readonly Message[] {
  const known = tails.get(messages) ?? new Map<number, readonly Message[]>();

  const slice = reuse(
    known.get(tail) ?? [],
    messages
      .slice(Math.max(0, messages.length - tail))
      .flatMap((message) => (belongsInQueue(message, execution) ? [] : [showMessage(message)])),
  );

  known.set(tail, slice);
  tails.set(messages, known);

  return slice;
}

function readQueue(state: FoldState, folded: FoldHead): readonly QueuedMessage[] {
  const queue = reuse(
    queues.get(folded.messages) ?? [],
    folded.pending.flatMap((id) => {
      const message = state.messages.get(id);

      return message !== undefined && belongsInQueue(message, folded.info.execution)
        ? [message]
        : [];
    }),
  );

  queues.set(folded.messages, queue);

  return queue;
}

function belongsInQueue(message: Message, execution: Execution): message is QueuedMessage {
  if (message.kind !== "user" || message.status.kind !== "pending") return false;

  if (message.source.kind === "child" || message.source.kind === "job") return false;
  const schedule = message.status.schedule;

  return (
    schedule.kind === "attached" ||
    (schedule.kind === "next-turn" &&
      (schedule.reason !== "idle" || (execution.kind !== "idle" && message.delivery !== "steer")))
  );
}

/**
 * The message as views send it: a text or thinking part with its signature nulled, since only
 * provider requests read it, from the stored part. One copy per message, as view frames compare
 * messages by identity.
 */
export function showMessage(message: Message): Message {
  const state = message.kind === "part" && SIGNED.has(message.partKind) ? message.state : null;

  if (message.kind !== "part" || !SIGNED_STATE.Check(state) || state.signature === null)
    return message;
  const known = unsigned.get(message);

  if (known !== undefined) return known;
  const shown = { ...message, state: { ...state, signature: null } };
  unsigned.set(message, shown);

  return shown;
}

/** The part's view as `part.watch` sends it: a text or thinking part with its signature nulled, as {@link showMessage} does. */
export function showPart(view: PartView): PartView {
  const state = view.state;

  if (!SIGNED.has(view.partKind) || !isJsonObject(state) || (state.signature ?? null) === null)
    return view;

  return { ...view, state: { ...state, signature: null } };
}

/** The prompt of the turn the message at `start` of `path` belongs to, when that prompt is on `path` before `start`; found through the path's indexes, never by walking its messages. */
export function findLeadingPrompt(
  path: Path | undefined,
  start: number,
): SessionView["leadingPrompt"] {
  const first = path?.messages[start];

  if (path === undefined || first === undefined) return null;
  const prompt = path.turns[path.turnAt.get(first.turn) ?? -1]?.prompt ?? null;
  const at = prompt === null ? undefined : path.at.get(prompt);
  const message = at === undefined || at >= start ? undefined : path.messages[at];

  return message?.kind === "user" ? message : null;
}

/** The turns `messages` belong to, from the earliest one on, reusing the head's last window from the same turn when it holds the same turns. */
function readTurnWindow(
  turns: readonly TurnInfo[],
  path: Path | undefined,
  messages: readonly Message[],
): readonly TurnInfo[] {
  if (path === undefined) return turns;
  let first = turns.length;

  for (const message of messages) first = Math.min(first, path.turnAt.get(message.turn) ?? first);
  const known = windows.get(path) ?? new Map<number, readonly TurnInfo[]>();
  const window = reuse(known.get(first) ?? [], first === 0 ? turns : turns.slice(first));
  known.set(first, window);
  windows.set(path, known);

  return window;
}

/** The usage of every completed run among `turns`, summed once per snapshot of them. */
function sumCompletedUsage(turns: readonly TurnInfo[]): Usage {
  const known = usages.get(turns);

  if (known !== undefined) return known;

  const usage = turns.reduce(
    (sum, turn) =>
      turn.state.kind === "ended" && turn.state.end.kind === "completed"
        ? addUsage(sum, turn.state.end.usage)
        : sum,
    ZERO_USAGE,
  );

  usages.set(turns, usage);

  return usage;
}

function frozen(turns: readonly TurnInfo[]): readonly TurnInfo[] {
  const known = snapshots.get(turns);

  if (known !== undefined && !known.stale) return known.turns;
  const snapshot = reuse(known?.turns ?? [], [...turns]);
  snapshots.set(turns, { turns: snapshot, stale: false });

  return snapshot;
}
