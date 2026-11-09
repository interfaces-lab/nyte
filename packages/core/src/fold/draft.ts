import { asId, backgroundRowKey, compile } from "@nyte-ai/schema";
import type {
  BackgroundItem,
  BackgroundRow,
  CatalogId,
  CommitId,
  ContextView,
  Execution,
  FileChange,
  HeadName,
  Message,
  MessageId,
  PartId,
  PartView,
  Placement,
  QueuedMessage,
  SessionView,
  TurnId,
  TurnInfo,
} from "@nyte-ai/schema";
import { Type } from "typebox";
import type {
  Draft,
  FoldHead,
  FoldRun,
  FoldTurn,
  Index,
  Path,
  Table,
  Touched,
} from "../contract/fold.ts";
import { text, thinking } from "../contract/parts.ts";
import type { PartRecord } from "../contract/records.ts";
import { NO_BACKGROUND, START } from "../store/session.ts";

const SIGNED = compile(Type.Object({ signature: Type.Unknown() }));

export const IDLE: Execution = { kind: "idle", lastRun: null };

export const WORKING: TurnInfo["state"] = { kind: "working", activity: null };

export const UNCONFIGURED: SessionView["configuration"] = { selected: null, effective: null };

export const NO_CONTEXT: ContextView = { tokens: 0, window: 0, lastRequest: null };

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
};

export function updatePart(
  draft: Draft,
  id: PartId,
  change: (part: PartRecord) => PartRecord,
): void {
  const current = draft.parts.get(id);

  if (current === undefined) return;
  const next = change(current);

  if (next === current) return;
  putPart(draft, next);

  if (transcriptRole(next.placement) !== null) {
    const message = draft.messages.get(toPartMessageId(id));

    if (message?.kind === "part")
      setMessage(draft, {
        ...message,
        state: next.state,
        version: next.version,
        status: next.status,
      });

    return;
  }

  const index = draft.partViews.findIndex((view) => view.id === id);

  if (index < 0) return;
  draft.partViews = draft.partViews.with(index, partView(next));
  touchRow(draft, "parts", id);
}

export function putPart(draft: Draft, record: PartRecord): void {
  draft.parts.set(record.id, record);

  if (awaitsSettlement(record)) draft.unsettled.add(record.id);
  else draft.unsettled.delete(record.id);
}

export function dropPart(draft: Draft, id: PartId): void {
  draft.parts.delete(id);
  draft.unsettled.delete(id);
}

export function awaitsSettlement(part: PartRecord): boolean {
  return part.status.kind === "live" || part.status.kind === "waiting";
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
  draft.messages.set(message.id, unsign(message));
  touchRow(draft, "messages", message.id);

  const info = draft.turns.get(message.turn)?.info;

  if (
    info !== undefined &&
    !hidesTurn(info, message) &&
    previous !== undefined &&
    (previous.turn !== message.turn || hidesTurn(info, previous))
  )
    touchRow(draft, "turns", message.turn);
  const owner = draft.inputs.get(message.id)?.head;
  const head = owner === undefined ? undefined : draft.heads.get(owner);

  if (
    owner !== undefined &&
    head?.pending.includes(message.id) === true &&
    queued(previous, head) !== queued(message, head)
  )
    touchRow(draft, "heads", owner);

  if (previous === undefined) return;
  draft.swapped.add(message.id);

  if (previous.turn !== message.turn && previous.turn === pendingTurn(message.id)) {
    const left = draft.turns.get(previous.turn)?.info;
    draft.turns.delete(previous.turn);

    if (left === undefined || !hidesTurn(left, previous)) dropRow(draft, "turns", previous.turn);
  }
}

export function setTurn(draft: Draft, turn: FoldTurn): void {
  const previous = draft.turns.get(turn.info.id);

  if (previous === turn) return;
  draft.turns.set(turn.info.id, turn);

  if (previous?.info === turn.info) return;
  draft.retitled.add(turn.info.id);

  if ([...draft.paths.values()].some((path) => path.turnAt.has(turn.info.id)))
    touchRow(draft, "turns", turn.info.id);
}

export function showsTurn(messages: ReadonlyMap<MessageId, Message>, info: TurnInfo): boolean {
  return !hidesTurn(info, info.prompt === null ? undefined : messages.get(info.prompt));
}

export function hidesTurn(info: TurnInfo, prompt: Message | undefined): boolean {
  return (
    prompt?.kind === "user" &&
    prompt.id === info.prompt &&
    prompt.turn === info.id &&
    prompt.status.kind !== "landed"
  );
}

export function touchRow(draft: Draft, table: Table, key: string): void {
  if (!draft.durable) return;
  draft.stamps[table].set(key, draft.seq);
  draft.touched.upsert[table].add(key);
  draft.touched.drop[table].delete(key);
}

export function dropRow(draft: Draft, table: Table, key: string): void {
  if (!draft.durable) return;
  draft.stamps[table].set(key, draft.seq);
  draft.touched.drop[table].add(key);
  draft.touched.upsert[table].delete(key);
}

export function touchPath(draft: Draft, head: HeadName, position: number): void {
  if (!draft.durable) return;
  draft.touched.paths.set(head, Math.min(position, draft.touched.paths.get(head) ?? position));
  const edits = draft.paths.get(head)?.edits;

  if (edits === undefined) return;

  while ((edits.at(-1)?.position ?? -1) >= position) edits.pop();

  if (edits.at(-1)?.seq !== draft.seq) edits.push({ seq: draft.seq, position });
}

export function setChanges(draft: Draft, files: readonly FileChange[]): void {
  diffRows(
    draft,
    "changes",
    new Map(draft.changes.map((file) => [file.path, file])),
    new Map(files.map((file) => [file.path, file])),
  );
  draft.changes = files;
}

export function setCatalogId(draft: Draft, id: CatalogId): void {
  if (draft.catalogId === id) return;

  if (draft.catalogId !== null) dropRow(draft, "catalog", draft.catalogId);
  touchRow(draft, "catalog", id);
  draft.catalogId = id;
}

export function noteHead(
  draft: Draft,
  name: HeadName,
  current: FoldHead | undefined,
  next: FoldHead,
): void {
  if (
    current === undefined ||
    current.revision !== next.revision ||
    !sameValue(current.info.execution, next.info.execution) ||
    (current.pending !== next.pending &&
      !sameValue(readQueueIds(draft.messages, current), readQueueIds(draft.messages, next)))
  )
    touchRow(draft, "heads", name);

  if (
    current === undefined ||
    !sameValue(current.configuration, next.configuration) ||
    !sameValue(current.context, next.context)
  )
    touchRow(draft, "settings", name);

  if (current === undefined) touchRow(draft, "usage", name);

  if (current?.background !== next.background)
    diffRows(
      draft,
      "background",
      backgroundRows(name, current?.background ?? []),
      backgroundRows(name, next.background),
    );

  if ((current?.info.execution.kind === "idle") !== (next.info.execution.kind === "idle"))
    touchPath(draft, name, draft.paths.get(name)?.committed ?? 0);
}

export function dropHead(draft: Draft, name: HeadName): void {
  const head = draft.heads.get(name);

  if (head === undefined) return;
  dropRow(draft, "heads", name);
  dropRow(draft, "settings", name);
  dropRow(draft, "usage", name);

  for (const key of backgroundRows(name, head.background).keys()) dropRow(draft, "background", key);
  touchPath(draft, name, 0);
}

export function emptyStamps(): Index["stamps"] {
  return {
    messages: new Map(),
    turns: new Map(),
    parts: new Map(),
    changes: new Map(),
    catalog: new Map(),
    heads: new Map(),
    settings: new Map(),
    usage: new Map(),
    background: new Map(),
  };
}

export function newTouched(): Touched {
  return { upsert: tableSets(), drop: tableSets(), paths: new Map() };
}

function tableSets(): Touched["upsert"] {
  return {
    messages: new Set(),
    turns: new Set(),
    parts: new Set(),
    changes: new Set(),
    catalog: new Set(),
    heads: new Set(),
    settings: new Set(),
    usage: new Set(),
    background: new Set(),
  };
}

function diffRows(
  draft: Draft,
  table: Table,
  before: ReadonlyMap<string, unknown>,
  after: ReadonlyMap<string, unknown>,
): void {
  for (const [key, row] of after) {
    const old = before.get(key);

    if (old === undefined || !sameValue(old, row)) touchRow(draft, table, key);
  }

  for (const key of before.keys()) if (!after.has(key)) dropRow(draft, table, key);
}

export function backgroundRows(
  head: HeadName,
  items: readonly BackgroundItem[],
): ReadonlyMap<string, BackgroundRow> {
  const rows = items.map((item) => ({ head, item }));

  return new Map(rows.map((row) => [backgroundRowKey(row), row]));
}

function sameValue<T>(left: T, right: T): boolean {
  return left === right || JSON.stringify(left) === JSON.stringify(right);
}

export function readQueueIds(
  messages: ReadonlyMap<MessageId, Message>,
  head: FoldHead,
): readonly MessageId[] {
  return head.pending.filter((id) => queued(messages.get(id), head));
}

function queued(message: Message | undefined, head: FoldHead): boolean {
  return message !== undefined && belongsInQueue(message, head.info.execution);
}

export function belongsInQueue(message: Message, execution: Execution): message is QueuedMessage {
  if (message.kind !== "user" || message.status.kind !== "pending") return false;

  if (
    message.source.kind === "child" ||
    message.source.kind === "job" ||
    message.source.kind === "answer"
  )
    return false;
  const schedule = message.status.schedule;

  return (
    schedule.kind === "attached" ||
    (schedule.kind === "next-turn" &&
      (schedule.reason !== "idle" || (execution.kind !== "idle" && message.delivery !== "steer")))
  );
}

function unsign(message: Message): Message {
  if (message.kind !== "part") return message;
  const state = unsignedState(message.partKind, message.state);

  return state === message.state ? message : { ...message, state };
}

function unsignedState<State>(partKind: string, state: State): State | { signature: null } {
  if (partKind !== text.kind && partKind !== thinking.kind) return state;

  if (!SIGNED.Check(state) || state.signature === null) return state;

  return { ...state, signature: null };
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

  if (next === current) return;
  draft.heads.set(name, next);
  noteHead(draft, name, current, next);
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
  return {
    messages: [],
    committed: 0,
    at: new Map(),
    turns: [],
    turnAt: new Map(),
    firstAt: [],
    usage: [],
    edits: [],
  };
}

export function emptyHead(
  name: HeadName,
  path: { readonly messages: readonly Message[]; readonly turns: readonly TurnInfo[] },
): FoldHead {
  return {
    info: {
      name,
      tip: START,
      stack: null,
      execution: IDLE,
      unread: false,
      background: NO_BACKGROUND,
    },
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

export function partView(part: PartRecord): PartView {
  return {
    id: part.id,
    partKind: part.partKind,
    placement: part.placement,
    state: unsignedState(part.partKind, part.state),
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

export function transcriptRole(placement: Placement): "step" | "answer" | "note" | null {
  if (placement.kind !== "transcript") return null;
  const role = placement.role;

  return role === "step" || role === "answer" || role === "note" ? role : null;
}

export function toPartMessageId(part: PartId): MessageId {
  return asId<"message">(part);
}

export function pendingTurn(id: MessageId): TurnId {
  return asId<"turn">(`pending:${id}`);
}
