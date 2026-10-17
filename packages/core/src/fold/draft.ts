import { asId } from "@nyte-ai/schema";
import type {
  CommitId,
  ContextView,
  Execution,
  HeadName,
  Message,
  MessageId,
  PartId,
  PartView,
  SessionView,
  TurnId,
  TurnInfo,
} from "@nyte-ai/schema";
import type { Draft, FoldHead, FoldRun, FoldTurn, Path } from "../contract/fold.ts";
import type { PartRecord } from "../contract/records.ts";
import { START } from "../store/session.ts";

export const IDLE: Execution = { kind: "idle", lastRun: null };

export const WORKING: TurnInfo["state"] = { kind: "working", activity: null };

const UNCONFIGURED: SessionView["configuration"] = { selected: null, effective: null };

const NO_CONTEXT: ContextView = { tokens: 0, window: 0, lastRequest: null };

const UNTOUCHED = { count: 0, paths: [] };

const EMPTY_SUMMARY: TurnInfo["summary"] = {
  byClass: {
    read: UNTOUCHED,
    list: UNTOUCHED,
    edit: UNTOUCHED,
    shell: UNTOUCHED,
    delegate: UNTOUCHED,
    custom: UNTOUCHED,
  },
  failed: 0,
  stopped: 0,
  added: 0,
  removed: 0,
};

export const snapshots = new WeakMap<
  readonly TurnInfo[],
  { readonly turns: readonly TurnInfo[]; readonly stale: boolean }
>();

export function updatePart(
  draft: Draft,
  id: PartId,
  change: (part: PartRecord) => PartRecord,
): void {
  const current = draft.parts.get(id);

  if (current === undefined) return;
  const next = change(current);

  if (next === current) return;
  draft.parts.set(id, next);
  const message = draft.messages.get(toPartMessageId(id));

  if (message?.kind === "part")
    return setMessage(draft, {
      ...message,
      state: next.state,
      version: next.version,
      status: next.status,
    });
  const index = draft.partViews.findIndex((view) => view.id === id);

  if (index >= 0) draft.partViews = draft.partViews.with(index, partView(next));
}

export function committed(draft: Draft, id: CommitId): Message | undefined {
  const commit = draft.commits.get(id);

  if (commit === undefined) return undefined;
  const body = commit.body;

  if (body.kind !== "user") return draft.messages.get(toPartMessageId(body.part));
  const message = draft.messages.get(body.message);

  if (message?.kind !== "user") return message;
  const ids = draft.siblings.get(commit.parent) ?? [id];

  const index = Math.max(
    0,
    ids.findIndex((sibling) => sibling === id),
  );

  if (
    message.siblings.ids === ids &&
    message.siblings.index === index &&
    message.siblings.count === ids.length
  )
    return message;
  const next: Message = { ...message, siblings: { index, count: ids.length, ids } };
  setMessage(draft, next);

  return next;
}

export function setMessage(draft: Draft, message: Message): void {
  const previous = draft.messages.get(message.id);

  if (previous === message) return;
  draft.messages.set(message.id, message);

  if (previous === undefined) return;
  draft.swapped.add(message.id);

  if (previous.turn !== message.turn && previous.turn === pendingTurn(message.id))
    draft.turns.delete(previous.turn);
}

export function setTurn(draft: Draft, turn: FoldTurn): void {
  const previous = draft.turns.get(turn.info.id);

  if (previous === turn) return;
  draft.turns.set(turn.info.id, turn);

  if (previous?.info !== turn.info) draft.retitled.add(turn.info.id);
}

export function openTurn(
  draft: Draft,
  id: TurnId,
  head: HeadName,
  prompt: MessageId | null,
  at: number,
): void {
  if (!draft.turns.has(id)) setTurn(draft, { info: turnInfo(id, prompt, at), head, live: [] });
}

export function turnInfo(id: TurnId, prompt: MessageId | null, at: number): TurnInfo {
  return {
    id,
    run: null,
    prompt,
    state: WORKING,
    startedAt: at,
    endedAt: null,
    steps: 0,
    thinkingOnly: false,
    summary: EMPTY_SUMMARY,
  };
}

export function updateHead(
  draft: Draft,
  name: HeadName,
  change: (head: FoldHead) => FoldHead,
): void {
  const current = draft.heads.get(name);
  const next = change(current ?? createHead(draft, name));

  if (next !== current) draft.heads.set(name, next);
}

export function dropFailed(draft: Draft, name: HeadName): void {
  const failed = (part: PartId) => draft.parts.get(part)?.status.kind === "failed";

  if (!draft.heads.get(name)?.live.some(failed)) return;
  updateHead(draft, name, (head) => ({ ...head, live: head.live.filter((part) => !failed(part)) }));
  draft.rebuild.add(name);
}

export function liveRun(draft: Draft, head: HeadName): FoldRun | undefined {
  const execution = draft.heads.get(head)?.info.execution;

  return execution === undefined || execution.kind === "idle"
    ? undefined
    : draft.runs.get(execution.run.id);
}

function createHead(draft: Draft, name: HeadName): FoldHead {
  const path = newPath();
  draft.paths.set(name, path);

  return emptyHead(name, path);
}

export function newPath(): Path {
  return { messages: [], committed: 0, at: new Map(), turns: [], turnAt: new Map(), firstAt: [] };
}

export function emptyHead(
  name: HeadName,
  path: { readonly messages: readonly Message[]; readonly turns: readonly TurnInfo[] },
): FoldHead {
  return {
    info: { name, tip: START, stack: null, execution: IDLE, unread: false },
    revision: null,
    messages: path.messages,
    live: [],
    pending: [],
    turns: path.turns,
    background: [],
    configuration: UNCONFIGURED,
    context: NO_CONTEXT,
  };
}

export function stale(turns: readonly TurnInfo[]): void {
  const known = snapshots.get(turns);

  if (known !== undefined && !known.stale)
    snapshots.set(turns, { turns: known.turns, stale: true });
}

export function partView(part: PartRecord): PartView {
  return {
    id: part.id,
    partKind: part.partKind,
    placement: part.placement,
    state: part.state,
    version: part.version,
    status: part.status,
    owner: part.owner,
  };
}

export function reuse<T>(previous: readonly T[], next: readonly T[]): readonly T[] {
  return previous.length === next.length && previous.every((item, index) => item === next[index])
    ? previous
    : next;
}

export function toPartMessageId(part: PartId): MessageId {
  return asId<"message">(part);
}

export function pendingTurn(id: MessageId): TurnId {
  return asId<"turn">(`pending:${id}`);
}
