import { asId, asSeq } from "@nyte-ai/schema";
import type {
  Activation,
  BackgroundItem,
  CommitId,
  Delivery,
  Execution,
  FileChange,
  HeadInfo,
  HeadName,
  MessageId,
  PartId,
  PartStatus,
  PatchEvent,
  Placement,
  Position,
  PrincipalId,
  RunId,
  RunView,
  SessionCatalogView,
  SessionEvent,
  SessionId,
  TurnId,
  TurnInfo,
} from "@nyte-ai/schema";
import type { Failure } from "@nyte-ai/schema/model";
import { INDEX } from "../contract/fold.ts";
import type {
  Draft,
  FoldHead,
  FoldInput,
  FoldRun,
  FoldState,
  Index,
  Logged,
  UserMessage,
} from "../contract/fold.ts";
import type { CommitRecord, PartRecord } from "../contract/records.ts";
import { readPositionCommit, START } from "../store/session.ts";
import { isJsonObject } from "../util/json-schema.ts";
import { applyCall, describeLiveActivity } from "./calls.ts";
import {
  committed,
  dropFailed,
  emptyHead,
  IDLE,
  liveRun,
  newPath,
  openTurn,
  partView,
  pendingTurn,
  setMessage,
  setTurn,
  toPartMessageId,
  turnInfo,
  updateHead,
  updatePart,
  WORKING,
} from "./draft.ts";
import { finish } from "./paths.ts";

const INACTIVE: Activation = { kind: "inactive" };

const SINGLE: UserMessage["siblings"] = { index: 0, count: 1, ids: [] };

export const EMPTY_CATALOG: SessionCatalogView = {
  commands: [],
  settings: [],
  skills: [],
  agents: [],
  tools: [],
};

const STOPPED: Failure = { class: "aborted", message: "Stopped." };

export function emptyFold(input: {
  readonly session: SessionId;
  readonly principal: PrincipalId;
}): FoldState {
  const index: Index = {
    heads: new Map(),
    commits: new Map(),
    siblings: new Map(),
    inputs: new Map(),
    parts: new Map(),
    runs: new Map(),
    calls: new Map(),
    turns: new Map(),
    messages: new Map(),
    byRun: new Map(),
    riders: new Set(),
    thinking: new Map(),
    paths: new Map(),
  };

  return {
    [INDEX]: index,
    session: input.session,
    principal: input.principal,
    seen: new Map(),
    seq: asSeq(0),
    activation: INACTIVE,
    catalog: EMPTY_CATALOG,
    changes: [],
    heads: index.heads,
    headInfos: [],
    commits: index.commits,
    siblings: index.siblings,
    inputs: index.inputs,
    parts: index.parts,
    partViews: [],
    runs: index.runs,
    calls: index.calls,
    turns: index.turns,
    messages: index.messages,
  };
}

export function fold(state: FoldState, event: SessionEvent | PatchEvent): FoldState {
  const draft = open(state);

  if (event.kind === "patch") {
    if (!applyPatch(draft, event)) return state;
  } else {
    if (event.seq !== 0) draft.seq = event.seq;
    apply(draft, event);
  }

  return finish(state, draft);
}

function open(state: FoldState): Draft {
  return {
    ...state[INDEX],
    seen: state.seen,
    seq: state.seq,
    activation: state.activation,
    catalog: state.catalog,
    changes: state.changes,
    partViews: state.partViews,
    walk: new Set(),
    appended: new Map(),
    rebuild: new Set(),
    swapped: new Set(),
    retitled: new Set(),
    steps: new Map(),
  };
}

function apply(draft: Draft, event: SessionEvent): void {
  switch (event.kind) {
    case "commit":
      return applyCommit(draft, event);
    case "head":
      return applyHead(draft, event);
    case "seen":
      return applySeen(draft, event);
    case "input":
      return applyInput(draft, event);
    case "run":
      return applyRun(draft, event);
    case "part":
      return applyPart(draft, event);
    case "call":
      return applyCall(draft, event);
    case "background":
      return eachHead(draft, event.head, (head) => ({
        ...head,
        background: upsert(head.background, event.item),
      }));
    case "configured":
      return eachHead(draft, event.head, (head) => ({
        ...head,
        configuration: { selected: event.selected, effective: event.effective },
      }));
    case "request":
      return eachHead(draft, event.head, (head) => ({ ...head, context: event.context }));
    case "changes":
      draft.changes = mergeChanges(draft.changes, event.files);

      return;
    case "session":
      return applySession(draft, event);
    case "activation":
      draft.activation = event.activation;

      return;
    case "catalog":
      draft.catalog = event.catalog;
  }
}

function applyCommit(draft: Draft, event: Logged<"commit">): void {
  const body = event.body;
  const name = event.head;

  const record: CommitRecord = {
    parent: event.parent,
    at: event.at,
    run: event.run,
    body,
  };

  draft.commits.set(event.id, record);

  if (body.kind === "user") {
    addSibling(draft, event.parent, event.id, body.siblings);
    landCommitted(draft, event, body);
  } else {
    updatePart(draft, body.part, (part) =>
      part.status.kind === "settled"
        ? part
        : { ...part, status: { kind: "settled", commit: event.id, endedAt: event.at } },
    );

    for (const head of draft.heads.values()) {
      if (!head.live.includes(body.part)) continue;
      updateHead(draft, head.info.name, (current) => ({
        ...current,
        live: current.live.filter((part) => part !== body.part),
      }));
      draft.rebuild.add(head.info.name);
    }
  }

  if (name === null) return;
  const tip = draft.heads.get(name)?.info.tip ?? START;
  updateHead(draft, name, (head) => ({
    ...head,
    info: { ...head.info, tip: { kind: "commit", id: event.id } },
  }));
  draft.appended.set(name, event.id);

  if (readPositionCommit(tip) !== event.parent) draft.walk.add(name);

  if (body.kind === "user") dropFailed(draft, name);
}

function landCommitted(
  draft: Draft,
  event: Logged<"commit">,
  body: Extract<CommitRecord["body"], { readonly kind: "user" }>,
): void {
  const id = body.message;
  const input = draft.inputs.get(id);
  const message = draft.messages.get(id);
  const owner = input?.head ?? event.head;

  if (owner === null) return;
  updateHead(draft, owner, (head) =>
    head.pending.includes(id)
      ? { ...head, pending: head.pending.filter((pending) => pending !== id) }
      : head,
  );
  draft.rebuild.add(owner);

  if (input !== undefined && input.landed === null)
    draft.inputs.set(id, { ...input, landed: { commit: event.id, run: event.run } });

  if (
    message?.kind === "user" &&
    message.status.kind === "landed" &&
    message.status.commit === event.id
  )
    return;
  const turn = landingTurn(draft, owner, body.delivery, event.run, id, event.at);

  setMessage(draft, {
    id,
    turn,
    at: message?.at ?? event.at,
    kind: "user",
    content: body.content,
    source: body.source,
    delivery: body.delivery,
    status: { kind: "landed", commit: event.id, run: event.run, replaced: input?.replaced ?? null },
    siblings: message?.kind === "user" ? message.siblings : SINGLE,
  });
}

function addSibling(
  draft: Draft,
  parent: CommitId | null,
  id: CommitId,
  listed: readonly CommitId[],
): void {
  const prior = draft.siblings.get(parent) ?? [];
  const candidates = [...listed, id];

  const added = [...new Set(candidates)].filter((sibling) => !prior.includes(sibling));

  if (added.length === 0) return;
  draft.siblings.set(parent, [...prior, ...added]);

  for (const sibling of prior) committed(draft, sibling);
}

function applyHead(draft: Draft, event: Logged<"head">): void {
  const name = event.head;

  if (name === null) return;

  if (event.reason === "removed") {
    draft.heads.delete(name);
    draft.paths.delete(name);
    forget(draft, name);

    return;
  }

  const tip: Position = event.to === null ? START : { kind: "commit", id: event.to };
  updateHead(draft, name, (head) => ({
    ...head,
    info: { ...head.info, tip },
    live: event.reason === "moved" ? [] : head.live,
  }));
  draft.walk.add(name);
}

function applySeen(draft: Draft, event: Logged<"seen">): void {
  const name = event.head;
  const marks = draft.seen.get(event.principal);

  if (name === null || !draft.heads.has(name) || marks?.get(name) === event.commit) return;
  draft.seen = new Map(draft.seen).set(event.principal, new Map(marks).set(name, event.commit));
}

function forget(draft: Draft, name: HeadName): void {
  if (![...draft.seen.values()].some((marks) => marks.has(name))) return;

  draft.seen = new Map(
    Array.from(draft.seen, ([principal, marks]) => {
      if (!marks.has(name)) return [principal, marks];
      const kept = new Map(marks);
      kept.delete(name);

      return [principal, kept];
    }),
  );
}

function applySession(draft: Draft, event: Logged<"session">): void {
  const heads = new Map<HeadName, FoldHead>();

  for (const row of event.info.heads) {
    const current = draft.heads.get(row.name);

    if (current === undefined) {
      const path = newPath();
      draft.paths.set(row.name, path);
      heads.set(row.name, { ...emptyHead(row.name, path), info: { ...row, unread: false } });
      draft.walk.add(row.name);
      continue;
    }

    heads.set(
      row.name,
      sameStack(current.info.stack, row.stack)
        ? current
        : { ...current, info: { ...current.info, stack: row.stack } },
    );
  }

  if (sameEntries(draft.heads, heads)) return;
  draft.heads.clear();

  for (const [name, head] of heads) draft.heads.set(name, head);

  for (const name of draft.paths.keys()) {
    if (heads.has(name)) continue;
    draft.paths.delete(name);
    forget(draft, name);
  }
}

function applyInput(draft: Draft, event: Logged<"input">): void {
  if (event.change === "admitted") return admit(draft, event);
  const input = draft.inputs.get(event.message);

  if (input === undefined) return;

  switch (event.change) {
    case "scheduled": {
      draft.inputs.set(input.id, { ...input, schedule: event.schedule });
      const message = draft.messages.get(input.id);

      if (message?.kind === "user" && message.status.kind === "pending")
        setMessage(draft, { ...message, status: { ...message.status, schedule: event.schedule } });
      updateHead(draft, input.head, (head) => ({
        ...head,
        pending: placeAt(head.pending, input.id, event.position),
      }));
      draft.rebuild.add(input.head);

      return;
    }

    case "landed": {
      draft.inputs.set(input.id, { ...input, landed: { commit: event.commit, run: event.run } });
      const message = draft.messages.get(input.id);

      if (message?.kind !== "user") return;
      const turn = landingTurn(draft, input.head, input.delivery, event.run, input.id, event.at);
      setMessage(draft, {
        ...message,
        turn,
        status: { kind: "landed", commit: event.commit, run: event.run, replaced: input.replaced },
      });

      return;
    }

    case "withdrawn":
    case "superseded":
      return leave(draft, input);
  }
}

function admit(
  draft: Draft,
  event: Extract<Logged<"input">, { readonly change: "admitted" }>,
): void {
  const head = event.head;
  const id = event.message;

  if (head === null) return;
  const turn = pendingTurn(id);

  draft.inputs.set(id, {
    id,
    head,
    at: event.at,
    content: event.content,
    source: event.source,
    delivery: event.delivery,
    schedule: event.schedule,
    covered: event.covered,
    configuration: event.configuration,
    replaced: event.replaced,
    landed: null,
  });

  setMessage(draft, {
    id,
    turn,
    at: event.at,
    kind: "user",
    content: event.content,
    source: event.source,
    delivery: event.delivery,
    status: { kind: "pending", schedule: event.schedule, covered: event.covered },
    siblings: SINGLE,
  });
  openTurn(draft, turn, head, id, event.at);
  updateHead(draft, head, (current) =>
    current.pending.includes(id) ? current : { ...current, pending: [...current.pending, id] },
  );
  draft.rebuild.add(head);
}

function leave(draft: Draft, input: FoldInput): void {
  const message = draft.messages.get(input.id);
  draft.inputs.delete(input.id);
  draft.messages.delete(input.id);

  if (message?.turn === pendingTurn(input.id)) draft.turns.delete(message.turn);
  updateHead(draft, input.head, (head) => ({
    ...head,
    pending: head.pending.filter((id) => id !== input.id),
  }));
  draft.rebuild.add(input.head);
}

function landingTurn(
  draft: Draft,
  head: HeadName,
  delivery: Delivery,
  run: RunId | null,
  id: MessageId,
  at: number,
): TurnId {
  const joined = run === null ? undefined : draft.runs.get(run);

  if (joined !== undefined) return joined.turn;
  const live = delivery === "attach" ? liveRun(draft, head) : undefined;

  if (live !== undefined) return live.turn;

  if (delivery === "attach") draft.riders.add(id);
  const turn = delivery === "attach" ? pendingTurn(id) : asId<"turn">(id);
  openTurn(draft, turn, head, id, at);

  return turn;
}

function applyRun(draft: Draft, event: Logged<"run">): void {
  if (event.change === "started") return start(draft, event);
  const run = draft.runs.get(event.run);

  if (run === undefined) return;

  if (event.change === "ended") return end(draft, run, event);
  const execution = draft.heads.get(run.view.head)?.info.execution;

  if (execution === undefined || execution.kind === "idle" || execution.run.id !== event.run)
    return;

  switch (event.change) {
    case "phase":
      execute(draft, run, {
        kind: "live",
        run: run.view,
        phase: event.phase,
        stopping: execution.kind === "live" && execution.stopping,
      });

      return work(draft, run.turn);
    case "waiting":
      execute(draft, run, { kind: "waiting", run: run.view, on: event.on });

      return turnState(draft, run.turn, { kind: "waiting", on: event.on });
    case "retrying": {
      const view: RunView = { ...run.view, attempt: event.attempt };
      draft.runs.set(event.run, { ...run, view });
      execute(draft, run, {
        kind: "retrying",
        run: view,
        until: event.until,
        reason: event.reason,
      });

      return work(draft, run.turn);
    }

    case "stopping":
      return execute(draft, run, {
        kind: "live",
        run: execution.run,
        phase:
          execution.kind === "live"
            ? execution.phase
            : execution.kind === "waiting"
              ? "executing"
              : "responding",
        stopping: true,
      });
  }
}

function start(draft: Draft, event: Extract<Logged<"run">, { readonly change: "started" }>): void {
  const view = event.view;
  const prompt = view.origin.kind === "input" ? view.origin.message : null;
  const id = prompt === null ? asId<"turn">(`run:${event.run}`) : asId<"turn">(prompt);
  const existing = draft.turns.get(id);
  draft.runs.set(event.run, { view, turn: id });

  setTurn(draft, {
    info: {
      ...(existing?.info ?? turnInfo(id, prompt, view.startedAt)),
      run: event.run,
      state: WORKING,
      startedAt: view.startedAt,
      endedAt: null,
    },
    head: view.head,
    live: existing?.live ?? [],
  });
  updateHead(draft, view.head, (head) => ({
    ...head,
    info: {
      ...head.info,
      execution: { kind: "live", run: view, phase: "responding", stopping: false },
    },
  }));
  dropFailed(draft, view.head);

  for (const rider of draft.riders) {
    const current = draft.messages.get(rider);

    if (
      current?.kind !== "user" ||
      current.status.kind !== "landed" ||
      current.turn !== pendingTurn(rider)
    ) {
      draft.riders.delete(rider);
      continue;
    }

    if (draft.paths.get(view.head)?.at.has(rider) !== true) continue;
    setMessage(draft, { ...current, turn: id });
    draft.riders.delete(rider);
  }
}

function end(
  draft: Draft,
  run: FoldRun,
  event: Extract<Logged<"run">, { readonly change: "ended" }>,
): void {
  const turn = draft.turns.get(run.turn);
  const execution = draft.heads.get(run.view.head)?.info.execution ?? IDLE;

  if (execution.kind === "idle" || execution.run.id === event.run)
    execute(draft, run, {
      kind: "idle",
      lastRun: { id: event.run, end: event.end, endedAt: event.at },
    });

  if (turn !== undefined)
    setTurn(draft, {
      ...turn,
      info: { ...turn.info, state: { kind: "ended", end: event.end }, endedAt: event.at },
      live: [],
    });

  if (event.end.kind === "completed") return;
  const failure = event.end.kind === "failed" ? event.end.failure : STOPPED;

  for (const id of draft.byRun.get(event.run) ?? []) {
    updatePart(draft, id, (part) =>
      part.status.kind === "live" || part.status.kind === "waiting"
        ? { ...part, status: { kind: "failed", run: event.run, failure } }
        : part,
    );
  }
}

function execute(draft: Draft, run: FoldRun, execution: Execution): void {
  updateHead(draft, run.view.head, (head) => ({ ...head, info: { ...head.info, execution } }));
}

function work(draft: Draft, id: TurnId): void {
  const turn = draft.turns.get(id);

  if (turn !== undefined)
    turnState(draft, id, { kind: "working", activity: describeLiveActivity(draft, turn.live) });
}

function turnState(draft: Draft, id: TurnId, state: TurnInfo["state"]): void {
  const turn = draft.turns.get(id);

  if (turn === undefined || sameTurnState(turn.info.state, state)) return;
  setTurn(draft, { ...turn, info: { ...turn.info, state } });
}

function applyPart(draft: Draft, event: Logged<"part">): void {
  if (event.change === "created") return create(draft, event);
  const id = event.part;

  switch (event.change) {
    case "updated":
      return updatePart(draft, id, (part) => ({
        ...part,
        state: event.state,
        version: event.version,
      }));
    case "waiting":
      return updatePart(draft, id, (part) =>
        part.status.kind === "live"
          ? { ...part, status: { ...part.status, waiting: event.call } }
          : part,
      );
    case "settled":
      return updatePart(draft, id, (part) => ({
        ...part,
        status: { kind: "settled", commit: event.commit, endedAt: event.endedAt },
      }));
    case "failed":
      return updatePart(draft, id, (part) => ({
        ...part,
        status: { kind: "failed", run: part.run, failure: event.failure },
      }));
    case "answered":
      return updatePart(draft, id, (part) =>
        part.status.kind === "live"
          ? { ...part, status: { ...part.status, answer: event.answer } }
          : part,
      );
    case "closed":
      if (!draft.parts.has(id) || draft.messages.has(toPartMessageId(id))) return;
      draft.parts.delete(id);
      draft.partViews = draft.partViews.filter((view) => view.id !== id);
  }
}

function create(
  draft: Draft,
  event: Extract<Logged<"part">, { readonly change: "created" }>,
): void {
  const id = event.part;
  const run = event.run;
  const status: PartStatus = { kind: "live", run };

  const record: PartRecord = {
    id,
    partKind: event.partKind,
    placement: event.placement,
    state: event.state,
    version: event.version,
    owner: event.owner,
    run,
    status,
  };

  const role = transcriptRole(event.placement);
  draft.parts.set(id, record);

  if (run !== null) {
    const owned = draft.byRun.get(run) ?? [];
    owned.push(id);
    draft.byRun.set(run, owned);
  }

  if (role === null) {
    draft.partViews = [...draft.partViews.filter((view) => view.id !== id), partView(record)];

    return;
  }

  const folded = run === null ? undefined : draft.runs.get(run);
  const head = folded?.view.head ?? event.head;

  if (head === null) return;
  const execution = draft.heads.get(head)?.info.execution;

  if (execution?.kind !== "live" || !execution.stopping) dropFailed(draft, head);
  const turn = folded?.turn ?? noteTurn(draft, head, id, event.at);
  setMessage(draft, {
    id: toPartMessageId(id),
    turn,
    at: event.at,
    kind: "part",
    part: id,
    partKind: event.partKind,
    role,
    state: event.state,
    version: event.version,
    status,
  });
  updateHead(draft, head, (current) => ({
    ...current,
    live: [...current.live.filter((live) => live !== id), id],
  }));
  draft.rebuild.add(head);
}

function noteTurn(draft: Draft, head: HeadName, id: PartId, at: number): TurnId {
  const last = draft.heads
    .get(head)
    ?.messages.findLast((message) => !message.turn.startsWith("pending:"));

  if (last !== undefined) return last.turn;
  const turn = asId<"turn">(`part:${id}`);
  openTurn(draft, turn, head, null, at);

  return turn;
}

function applyPatch(draft: Draft, event: PatchEvent): boolean {
  const part = draft.parts.get(event.part);

  if (part === undefined) return false;
  const state = part.state;

  if ("append" in event || "markdown" in event) {
    if (
      part.status.kind !== "live" ||
      (part.partKind !== "text" && part.partKind !== "thinking") ||
      !isJsonObject(state) ||
      typeof state.markdown !== "string"
    )
      return false;

    const markdown = "append" in event ? state.markdown + event.append : event.markdown;

    updatePart(draft, part.id, (current) => ({
      ...current,
      state: { ...state, markdown },
      version: current.version + 1,
    }));

    return true;
  }

  if (
    !("progress" in event) ||
    (part.status.kind !== "live" && part.status.kind !== "waiting") ||
    !isJsonObject(state) ||
    state.phase !== "running"
  )
    return false;

  updatePart(draft, part.id, (current) => ({
    ...current,
    state: { ...state, progress: event.progress },
  }));

  return true;
}

function eachHead(draft: Draft, name: HeadName | null, change: (head: FoldHead) => FoldHead): void {
  for (const head of name === null ? draft.heads.keys() : [name]) updateHead(draft, head, change);
}

function upsert(items: readonly BackgroundItem[], item: BackgroundItem): readonly BackgroundItem[] {
  const index = items.findIndex((current) => current.kind === item.kind && current.id === item.id);

  return index < 0 ? [...items, item] : items.with(index, item);
}

function placeAt(
  list: readonly MessageId[],
  id: MessageId,
  position: number,
): readonly MessageId[] {
  const rest = list.filter((current) => current !== id);
  const index = Math.min(Math.max(0, position), rest.length);

  return [...rest.slice(0, index), id, ...rest.slice(index)];
}

function transcriptRole(placement: Placement): "step" | "answer" | "note" | null {
  if (placement.kind !== "transcript") return null;
  const role = placement.role;

  return role === "step" || role === "answer" || role === "note" ? role : null;
}

function sameEntries<K, V>(left: ReadonlyMap<K, V>, right: ReadonlyMap<K, V>): boolean {
  if (left.size !== right.size) return false;
  const entries = [...right];

  return [...left].every(
    ([key, value], index) => entries[index]?.[0] === key && entries[index]?.[1] === value,
  );
}

function sameStack(left: HeadInfo["stack"], right: HeadInfo["stack"]): boolean {
  if (left === null || right === null) return left === right;

  return (
    left.parent === right.parent &&
    left.stale === right.stale &&
    readPositionCommit(left.base) === readPositionCommit(right.base)
  );
}

function sameTurnState(left: TurnInfo["state"], right: TurnInfo["state"]): boolean {
  if (left.kind === "working" && right.kind === "working") return left.activity === right.activity;

  if (left.kind === "waiting" && right.kind === "waiting") return left.on === right.on;

  return left === right;
}

/** Folds one call's changed files into the session's list: a path already listed takes the call's entry in place, a new path goes last. A `changes` event carries one call's files; logs written before that carried the whole merged list each time, which merges to the same list. */
function mergeChanges(
  kept: readonly FileChange[],
  files: readonly FileChange[],
): readonly FileChange[] {
  if (kept.length === 0) return files;
  const merged = new Map(kept.map((file) => [file.path, file]));

  for (const file of files) merged.set(file.path, file);

  return [...merged.values()];
}
