import { asId, asSeq } from "@nyte-ai/schema";
import type {
  Activation,
  BackgroundItem,
  CallId,
  CommitId,
  ContextView,
  Delivery,
  Execution,
  FileChange,
  HeadInfo,
  HeadName,
  Json,
  Message,
  MessageId,
  MessageSource,
  PartId,
  PartStatus,
  PartView,
  PatchEvent,
  Placement,
  Position,
  PrincipalId,
  Revision,
  RunId,
  RunView,
  Schedule,
  Seq,
  SessionCatalogView,
  SessionEvent,
  SessionId,
  SessionView,
  ToolClass,
  ToolOutcome,
  TurnId,
  TurnInfo,
  UserContent,
  ViewOptions,
  WaitTarget,
} from "@nyte-ai/schema";
import type { Failure } from "@nyte-ai/schema/model";
import { SdkError } from "./error.ts";
import type { CommitRecord, PartRecord } from "./records.ts";

/** Returns a session as the fold holds it for one principal: every head, commit, input, part, run, call and turn. The maps and each head's `messages` and `turns` belong to the fold and change in place; every object a view carries is immutable and shared between steps. */
export interface FoldState {
  readonly session: SessionId;
  /** Whose seen marks decide `unread`. */
  readonly principal: PrincipalId;
  /** The last durable event folded; for resume, never on the view. */
  readonly seq: Seq;
  readonly activation: Activation;
  readonly catalog: SessionCatalogView;
  /** Files this session changed, latest per path, first-seen order. */
  readonly changes: readonly FileChange[];
  /** Every head by name, in creation order. */
  readonly heads: ReadonlyMap<HeadName, FoldHead>;
  /** Every head's row in `heads` order: `SessionView.heads`, shared by every head's view. */
  readonly headInfos: readonly HeadInfo[];
  /** Every commit folded, by id; a move rebuilds a head's path from it. */
  readonly commits: ReadonlyMap<CommitId, CommitRecord>;
  /** User commits sharing a parent, in creation order, by parent; null is the root. */
  readonly siblings: ReadonlyMap<CommitId | null, readonly CommitId[]>;
  /** Every admitted input not withdrawn or superseded, by message id. */
  readonly inputs: ReadonlyMap<MessageId, FoldInput>;
  /** Every part, any placement, by id. */
  readonly parts: ReadonlyMap<PartId, PartRecord>;
  /** Every open part not placed in the transcript, in creation order: `SessionView.parts`. */
  readonly partViews: readonly PartView[];
  /** Every run folded, by id. */
  readonly runs: ReadonlyMap<RunId, FoldRun>;
  /** Every tool call folded, by id. */
  readonly calls: ReadonlyMap<CallId, FoldCall>;
  /** Every turn, by id. */
  readonly turns: ReadonlyMap<TurnId, FoldTurn>;
  /** The one message object per id, shared by every head whose list carries it. */
  readonly messages: ReadonlyMap<MessageId, Message>;
}

/** Returns one head as the fold holds it: its row, revision, seen mark, messages, turns and the view fields that are per head. */
export interface FoldHead {
  /** Name, tip, stack, execution and unread; the same object sits in `FoldState.headInfos`. */
  readonly info: HeadInfo;
  /** The head ref's revision, stamped by `withRevision`; null until the ref exists. */
  readonly revision: Revision | null;
  /** The tip the fold's principal last saw on this head; null when none. */
  readonly seen: CommitId | null;
  /** The path's committed messages oldest first, then `live`, then `pending`. */
  readonly messages: readonly Message[];
  /** Transcript parts of this head's runs not yet committed, in creation order. */
  readonly live: readonly PartId[];
  /** Admitted inputs not yet landed, in inbox order. */
  readonly pending: readonly MessageId[];
  /** Turns over `messages`, in the same order. */
  readonly turns: readonly TurnInfo[];
  /** Children, jobs and pages working for this head, latest per `kind:id`. */
  readonly background: readonly BackgroundItem[];
  /** The head's stored selection and what admission would resolve now. */
  readonly configuration: SessionView["configuration"];
  /** The head's context size after its last request. */
  readonly context: ContextView;
}

/** Returns one admitted input as the fold holds it, from admission until it is withdrawn or superseded. */
export interface FoldInput {
  readonly id: MessageId;
  readonly head: HeadName;
  readonly at: number;
  readonly content: UserContent;
  readonly source: MessageSource;
  readonly delivery: Delivery;
  readonly schedule: Schedule;
  readonly covered: boolean;
  readonly replaced: { readonly previous: MessageId; readonly stopped: RunId | null } | null;
  /** Set when it lands. */
  readonly landed: { readonly commit: CommitId; readonly run: RunId | null } | null;
}

/** Returns one run as the fold holds it: its fixed metadata and the turn it writes. */
export interface FoldRun {
  readonly view: RunView;
  readonly turn: TurnId;
}

/** Returns one tool call as the fold holds it: its part, class, wait and whether it settled. */
export interface FoldCall {
  readonly part: PartId;
  readonly class: ToolClass;
  readonly waiting: WaitTarget | null;
  readonly settled: boolean;
}

/** Returns one turn as the fold holds it: its view, its head, and its unsettled tool calls. */
export interface FoldTurn {
  readonly info: TurnInfo;
  readonly head: HeadName;
  /** Tool calls in this turn not yet settled, oldest first; the newest names `activity`. */
  readonly live: readonly CallId[];
}

const DEFAULT_TAIL = 200;

const START: Position = { kind: "start" };

const IDLE: Execution = { kind: "idle", lastRun: null };

const INACTIVE: Activation = { kind: "inactive" };

const WORKING: TurnInfo["state"] = { kind: "working", activity: null };

const SINGLE: UserMessage["siblings"] = { index: 0, count: 1, ids: [] };

const UNCONFIGURED: SessionView["configuration"] = { selected: null, effective: null };

const NO_CONTEXT: ContextView = { tokens: 0, window: 0, lastRequest: null };

const EMPTY_CATALOG: SessionCatalogView = {
  commands: [],
  settings: [],
  skills: [],
  agents: [],
  tools: [],
};


const EMPTY_REVISION = asId<"revision">("");

const STOPPED: Failure = { class: "aborted", message: "Stopped." };

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

type UserMessage = Extract<Message, { readonly kind: "user" }>;

type Logged<Kind extends SessionEvent["kind"]> = Extract<SessionEvent, { readonly kind: Kind }>;

interface Index {
  readonly heads: Map<HeadName, FoldHead>;
  readonly commits: Map<CommitId, CommitRecord>;
  readonly siblings: Map<CommitId | null, readonly CommitId[]>;
  readonly inputs: Map<MessageId, FoldInput>;
  readonly parts: Map<PartId, PartRecord>;
  readonly runs: Map<RunId, FoldRun>;
  readonly calls: Map<CallId, FoldCall>;
  readonly turns: Map<TurnId, FoldTurn>;
  readonly messages: Map<MessageId, Message>;
  /** Every part a run created, by run. */
  readonly byRun: Map<RunId, PartId[]>;
  /** Landed attach inputs still on their pending turn, waiting for a run to ride. */
  readonly riders: Set<MessageId>;
  /** Thinking steps per turn on its head's path, beside `TurnInfo.steps`. */
  readonly thinking: Map<TurnId, number>;
  /** Every head's path, by head. */
  readonly paths: Map<HeadName, Path>;
}

interface Path {
  /** The array `FoldHead.messages` is. */
  readonly messages: Message[];
  /** How many leading `messages` are committed; live parts and pending inputs follow. */
  committed: number;
  /** Each message's position in `messages`. */
  readonly at: Map<MessageId, number>;
  /** The array `FoldHead.turns` is. */
  readonly turns: TurnInfo[];
  /** Each turn's position in `turns`. */
  readonly turnAt: Map<TurnId, number>;
  /** The position in `messages` of each turn's first message, beside `turns`. */
  readonly firstAt: number[];
}

interface Draft extends Index {
  readonly principal: PrincipalId;
  seq: Seq;
  activation: Activation;
  catalog: SessionCatalogView;
  changes: readonly FileChange[];
  partViews: readonly PartView[];
  /** Heads whose tip left the end of their path. */
  readonly walk: Set<HeadName>;
  /** The commit a head's tip moved to. */
  readonly appended: Map<HeadName, CommitRecord>;
  /** Heads whose live parts or pending inputs changed. */
  readonly rebuild: Set<HeadName>;
  readonly swapped: Set<MessageId>;
  readonly retitled: Set<TurnId>;
  /** Steps entering and leaving each turn's own head path. */
  readonly steps: Map<TurnId, { steps: number; thinking: number }>;
}

const indexes = new WeakMap<ReadonlyMap<MessageId, Message>, Index>();

/** Returns a session's state before its first event, for one principal. */
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

  indexes.set(index.messages, index);

  return {
    session: input.session,
    principal: input.principal,
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

/** Returns the state after one event: a token touches one part and the spine above it, and every object a view carries stays immutable and shared. The input state is consumed; callers hold only the returned state. */
export function fold(state: FoldState, event: SessionEvent | PatchEvent): FoldState {
  const draft = open(state);

  if (event.kind === "patch") {
    if (!applyPatch(draft, event)) return state;
  } else {
    if (event.seq > draft.seq) draft.seq = event.seq;
    apply(draft, event);
  }

  return finish(state, draft);
}

const projections = new WeakMap<FoldHead, Map<number, SessionView>>();

const tails = new WeakMap<readonly Message[], Map<number, readonly Message[]>>();

const snapshots = new WeakMap<
  readonly TurnInfo[],
  { readonly turns: readonly TurnInfo[]; readonly stale: boolean }
>();

const absent = new WeakMap<ReadonlyMap<HeadName, FoldHead>, Map<HeadName, FoldHead>>();

/** Returns a head's view, memoised per head: an unchanged head returns the same object, and unchanged messages and turns keep identity. `messages` is the tail; `turns` is every turn on the head's path. */
export function project(state: FoldState, head: HeadName, options?: ViewOptions): SessionView {
  const folded = state.heads.get(head) ?? absentHead(state.heads, head);
  const tail = options?.tail ?? DEFAULT_TAIL;
  const cached = projections.get(folded)?.get(tail);

  if (
    cached !== undefined &&
    cached.activation === state.activation &&
    cached.parts === state.partViews &&
    cached.heads === state.headInfos &&
    cached.changes === state.changes &&
    cached.catalog === state.catalog
  )
    return cached;

  const view: SessionView = {
    revision: folded.revision ?? EMPTY_REVISION,
    activation: state.activation,
    messages: tailOf(folded.messages, tail),
    parts: state.partViews,
    turns: frozen(folded.turns),
    execution: folded.info.execution,
    background: folded.background,
    configuration: folded.configuration,
    context: folded.context,
    heads: state.headInfos,
    changes: state.changes,
    catalog: state.catalog,
  };

  const byTail = projections.get(folded) ?? new Map<number, SessionView>();
  byTail.set(tail, view);
  projections.set(folded, byTail);

  return view;
}

/** Returns the state with a head's ref revision stamped, or the same state when it is unchanged. The input state is consumed. */
export function withRevision(state: FoldState, head: HeadName, revision: Revision): FoldState {
  const folded = state.heads.get(head);

  if (folded === undefined || folded.revision === revision) return state;
  indexOf(state).heads.set(head, { ...folded, revision });

  return { ...state };
}

function indexOf(state: FoldState): Index {
  const index = indexes.get(state.messages);

  if (index === undefined)
    throw new SdkError("internal", "The fold state was not made by emptyFold or fold.");

  return index;
}

function open(state: FoldState): Draft {
  return {
    ...indexOf(state),
    principal: state.principal,
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
      draft.changes = event.files;

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
    id: event.id,
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
  draft.appended.set(name, record);

  if (tipOf(tip) !== event.parent) draft.walk.add(name);

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

  const added = candidates.filter(
    (sibling, index) => !prior.includes(sibling) && candidates.indexOf(sibling) === index,
  );

  if (added.length === 0) return;
  draft.siblings.set(parent, [...prior, ...added]);

  for (const sibling of prior) {
    const commit = draft.commits.get(sibling);

    if (commit !== undefined) committed(draft, commit);
  }
}

function applyHead(draft: Draft, event: Logged<"head">): void {
  const name = event.head;

  if (name === null) return;

  if (event.reason === "removed") {
    draft.heads.delete(name);
    draft.paths.delete(name);

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

  if (name === null || event.principal !== draft.principal || !draft.heads.has(name)) return;
  updateHead(draft, name, (head) =>
    head.seen === event.commit ? head : { ...head, seen: event.commit },
  );
}

function applySession(draft: Draft, event: Logged<"session">): void {
  const heads = new Map<HeadName, FoldHead>();

  for (const row of event.info.heads) {
    const current = draft.heads.get(row.name);

    if (current === undefined) {
      const path = newPath();
      draft.paths.set(row.name, path);
      heads.set(row.name, {
        ...emptyHead(row.name, path),
        info: { ...row, unread: tipOf(row.tip) !== null },
      });
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
    if (!heads.has(name)) draft.paths.delete(name);
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
    turnState(draft, id, { kind: "working", activity: activityOf(draft, turn.live) });
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
    case "closed":
      if (!draft.parts.has(id) || draft.messages.has(messageOf(id))) return;
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
  dropFailed(draft, head);
  const turn = folded?.turn ?? noteTurn(draft, head, id, event.at);
  setMessage(draft, {
    id: messageOf(id),
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

function updatePart(draft: Draft, id: PartId, change: (part: PartRecord) => PartRecord): void {
  const current = draft.parts.get(id);

  if (current === undefined) return;
  const next = change(current);

  if (next === current) return;
  draft.parts.set(id, next);
  const message = draft.messages.get(messageOf(id));

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

function applyCall(draft: Draft, event: Logged<"call">): void {
  const call = draft.calls.get(event.call);

  switch (event.change) {
    case "intent": {
      draft.calls.set(event.call, {
        part: event.part,
        class: event.class,
        waiting: null,
        settled: false,
      });

      updatePart(draft, event.part, (part) => ({
        ...part,
        state: {
          call: event.call,
          name: event.name,
          args: event.args,
          class: event.class,
          phase: "running",
          progress: null,
        },
        version: part.version + 1,
      }));
      const turn = callTurn(draft, event.part, event.head);

      if (turn !== undefined)
        setTurn(
          draft,
          withActivity(draft, {
            ...turn,
            live: [...turn.live.filter((id) => id !== event.call), event.call],
          }),
        );

      return;
    }

    case "waiting":
      if (call !== undefined) draft.calls.set(event.call, { ...call, waiting: event.on });

      return updatePart(draft, event.part, (part) =>
        part.status.kind === "live" && part.status.run !== null
          ? { ...part, status: { kind: "waiting", run: part.status.run, on: event.on } }
          : part,
      );
    case "settled": {
      if (call !== undefined)
        draft.calls.set(event.call, { ...call, waiting: null, settled: true });

      updatePart(draft, event.part, (part) => ({
        ...part,
        state: settledState(part.state, event.outcome, event.changes),
        version: part.version + 1,
        status:
          part.status.kind === "waiting" ? { kind: "live", run: part.status.run } : part.status,
      }));
      const turn = callTurn(draft, event.part, event.head);

      if (turn === undefined) return;

      const summary =
        call === undefined
          ? turn.info.summary
          : summarise(turn.info.summary, call.class, event.outcome, event.changes);

      setTurn(
        draft,
        withActivity(draft, {
          ...turn,
          live: turn.live.filter((id) => id !== event.call),
          info: { ...turn.info, summary },
        }),
      );
    }
  }
}

function callTurn(draft: Draft, part: PartId, head: HeadName | null): FoldTurn | undefined {
  const record = draft.parts.get(part);

  const run =
    record !== undefined && record.run !== null
      ? draft.runs.get(record.run)
      : head === null
        ? undefined
        : liveRun(draft, head);

  return run === undefined ? undefined : draft.turns.get(run.turn);
}

function withActivity(draft: Draft, turn: FoldTurn): FoldTurn {
  if (turn.info.state.kind !== "working") return turn;
  const activity = activityOf(draft, turn.live);

  if (turn.info.state.activity === activity) return turn;

  return { ...turn, info: { ...turn.info, state: { kind: "working", activity } } };
}

function activityOf(draft: Draft, live: readonly CallId[]): string | null {
  const newest = live.at(-1);
  const call = newest === undefined ? undefined : draft.calls.get(newest);

  if (call === undefined) return null;

  switch (call.class.kind) {
    case "read":
    case "list":
      return "Exploring";
    case "edit":
      return "Editing";
    case "shell":
      return "Running";
    case "delegate":
      return "Delegating";
    case "custom":
      return call.class.label;
  }
}

function summarise(
  summary: TurnInfo["summary"],
  tool: ToolClass,
  outcome: ToolOutcome,
  changes: {
    readonly added: number;
    readonly removed: number;
    readonly paths: readonly string[];
  } | null,
): TurnInfo["summary"] {
  const added = summary.added + (changes?.added ?? 0);
  const removed = summary.removed + (changes?.removed ?? 0);

  if (outcome.kind === "stopped")
    return { ...summary, stopped: summary.stopped + 1, added, removed };

  if (outcome.kind !== "ok") return { ...summary, failed: summary.failed + 1, added, removed };
  const entry = summary.byClass[tool.kind];
  const touched = ["path" in tool ? [tool.path] : [], changes?.paths ?? []].flat();

  const paths = [
    ...entry.paths,
    ...touched.filter(
      (path, index) => !entry.paths.includes(path) && touched.indexOf(path) === index,
    ),
  ];

  return {
    ...summary,
    added,
    removed,
    byClass: { ...summary.byClass, [tool.kind]: { count: entry.count + 1, paths } },
  };
}

function settledState(
  state: Json,
  outcome: ToolOutcome,
  changes: {
    readonly added: number;
    readonly removed: number;
    readonly paths: readonly string[];
  } | null,
): Json {
  const fields = isJsonObject(state)
    ? Object.fromEntries(Object.entries(state).filter(([key]) => key !== "progress"))
    : {};

  return { ...fields, phase: "settled", outcome, changes };
}

function applyPatch(draft: Draft, event: PatchEvent): boolean {
  const part = draft.parts.get(event.part);

  if (part === undefined) return false;
  const state = part.state;

  if ("append" in event) {
    if (
      part.status.kind !== "live" ||
      (part.partKind !== "text" && part.partKind !== "thinking") ||
      !hasMarkdown(state)
    )
      return false;

    updatePart(draft, part.id, (current) => ({
      ...current,
      state: { ...state, markdown: state.markdown + event.append },
      version: current.version + 1,
    }));

    return true;
  }

  if ((part.status.kind !== "live" && part.status.kind !== "waiting") || !isRunning(state))
    return false;

  updatePart(draft, part.id, (current) => ({
    ...current,
    state: { ...state, progress: event.progress },
  }));

  return true;
}

function finish(state: FoldState, draft: Draft): FoldState {
  for (const name of updatePaths(draft)) {
    const head = draft.heads.get(name);

    if (head !== undefined) draft.heads.set(name, { ...head });
  }

  return {
    session: state.session,
    principal: state.principal,
    seq: draft.seq,
    activation: draft.activation,
    catalog: draft.catalog,
    changes: draft.changes,
    heads: draft.heads,
    headInfos: reuse(
      state.headInfos,
      Array.from(draft.heads.values(), (head) => head.info),
    ),
    commits: draft.commits,
    siblings: draft.siblings,
    inputs: draft.inputs,
    parts: draft.parts,
    partViews: draft.partViews,
    runs: draft.runs,
    calls: draft.calls,
    turns: draft.turns,
    messages: draft.messages,
  };
}

function updatePaths(draft: Draft): ReadonlySet<HeadName> {
  const touched = new Set<HeadName>();
  const reflows = new Map<HeadName, number>();

  const reflow = (name: HeadName, from: number): void => {
    reflows.set(name, Math.min(from, reflows.get(name) ?? from));
    touched.add(name);
  };

  for (const name of new Set([...draft.walk, ...draft.appended.keys(), ...draft.rebuild])) {
    const head = draft.heads.get(name);
    const path = draft.paths.get(name);

    if (head === undefined || path === undefined) continue;
    const walked = draft.walk.has(name);
    const appended = draft.appended.get(name);
    const from = walked ? 0 : path.committed;
    const commits = walked ? lineage(draft, head) : appended === undefined ? [] : [appended];
    truncate(draft, name, path, from);

    for (const commit of commits) {
      const message = committed(draft, commit);

      if (message !== undefined) push(draft, name, path, message);
    }

    path.committed = path.messages.length;

    for (const id of [...head.live.map(messageOf), ...head.pending]) {
      const message = draft.messages.get(id);

      if (message !== undefined) push(draft, name, path, message);
    }

    reflow(name, from);
  }

  for (const id of draft.swapped) {
    const message = draft.messages.get(id);

    if (message === undefined) continue;

    for (const [name, path] of draft.paths) {
      const position = path.at.get(id);

      if (position === undefined) continue;
      const previous = path.messages[position];

      if (previous === message) continue;
      count(draft, name, previous, -1);
      count(draft, name, message, 1);
      path.messages[position] = message;

      if (previous.turn === message.turn) touched.add(name);
      else reflow(name, position);
    }
  }

  for (const [id, delta] of draft.steps) {
    const turn = draft.turns.get(id);

    if (turn === undefined || (delta.steps === 0 && delta.thinking === 0)) continue;
    const steps = turn.info.steps + delta.steps;
    const thinking = (draft.thinking.get(id) ?? 0) + delta.thinking;
    const thinkingOnly = steps > 0 && steps === thinking;
    draft.thinking.set(id, thinking);

    if (steps !== turn.info.steps || thinkingOnly !== turn.info.thinkingOnly)
      setTurn(draft, { ...turn, info: { ...turn.info, steps, thinkingOnly } });
  }

  for (const [name, from] of reflows) {
    const path = draft.paths.get(name);

    if (path !== undefined) reflowTurns(draft, path, from);
  }

  for (const id of draft.retitled) {
    const info = draft.turns.get(id)?.info;

    if (info === undefined) continue;

    for (const [name, path] of draft.paths) {
      const position = path.turnAt.get(id);

      if (position === undefined || path.turns[position] === info) continue;
      path.turns[position] = info;
      stale(path.turns);
      touched.add(name);
    }
  }

  return touched;
}

function lineage(draft: Draft, head: FoldHead): readonly CommitRecord[] {
  const commits: CommitRecord[] = [];
  const visited = new Set<CommitId>();
  let cursor = tipOf(head.info.tip);

  while (cursor !== null && !visited.has(cursor)) {
    visited.add(cursor);
    const commit = draft.commits.get(cursor);

    if (commit === undefined) break;
    commits.push(commit);
    cursor = commit.parent;
  }

  return commits.reverse();
}

function truncate(draft: Draft, head: HeadName, path: Path, length: number): void {
  path.messages.splice(length).forEach((message, offset) => {
    if (path.at.get(message.id) === length + offset) path.at.delete(message.id);
    count(draft, head, message, -1);
  });
}

function push(draft: Draft, head: HeadName, path: Path, message: Message): void {
  path.at.set(message.id, path.messages.length);
  path.messages.push(message);
  count(draft, head, message, 1);
}

function count(draft: Draft, head: HeadName, message: Message, delta: number): void {
  if (
    message.kind !== "part" ||
    message.role !== "step" ||
    draft.turns.get(message.turn)?.head !== head
  )
    return;

  const entry = draft.steps.get(message.turn) ?? { steps: 0, thinking: 0 };
  entry.steps += delta;

  if (message.partKind === "thinking") entry.thinking += delta;
  draft.steps.set(message.turn, entry);
}

function reflowTurns(draft: Draft, path: Path, from: number): void {
  while ((path.firstAt.at(-1) ?? -1) >= from) {
    path.firstAt.pop();
    const info = path.turns.pop();

    if (info !== undefined) path.turnAt.delete(info.id);
  }

  for (let position = from; position < path.messages.length; position += 1) {
    const turn = draft.turns.get(path.messages[position].turn);

    if (turn === undefined || path.turnAt.has(turn.info.id)) continue;
    path.turnAt.set(turn.info.id, path.turns.length);
    path.turns.push(turn.info);
    path.firstAt.push(position);
  }

  stale(path.turns);
}

function committed(draft: Draft, commit: CommitRecord): Message | undefined {
  const body = commit.body;

  if (body.kind !== "user") return draft.messages.get(messageOf(body.part));
  const message = draft.messages.get(body.message);

  if (message?.kind !== "user") return message;
  const ids = draft.siblings.get(commit.parent) ?? [commit.id];
  const index = Math.max(0, ids.indexOf(commit.id));

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

function setMessage(draft: Draft, message: Message): void {
  const previous = draft.messages.get(message.id);

  if (previous === message) return;
  draft.messages.set(message.id, message);

  if (previous === undefined) return;
  draft.swapped.add(message.id);

  if (previous.turn !== message.turn && previous.turn === pendingTurn(message.id))
    draft.turns.delete(previous.turn);
}

function setTurn(draft: Draft, turn: FoldTurn): void {
  const previous = draft.turns.get(turn.info.id);

  if (previous === turn) return;
  draft.turns.set(turn.info.id, turn);

  if (previous?.info !== turn.info) draft.retitled.add(turn.info.id);
}

function openTurn(
  draft: Draft,
  id: TurnId,
  head: HeadName,
  prompt: MessageId | null,
  at: number,
): void {
  if (!draft.turns.has(id)) setTurn(draft, { info: turnInfo(id, prompt, at), head, live: [] });
}

function turnInfo(id: TurnId, prompt: MessageId | null, at: number): TurnInfo {
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

function updateHead(draft: Draft, name: HeadName, change: (head: FoldHead) => FoldHead): void {
  const current = draft.heads.get(name);
  const next = change(current ?? createHead(draft, name));
  const unread = tipOf(next.info.tip) !== next.seen;
  const settled = next.info.unread === unread ? next : { ...next, info: { ...next.info, unread } };

  if (settled !== current) draft.heads.set(name, settled);
}

function eachHead(draft: Draft, name: HeadName | null, change: (head: FoldHead) => FoldHead): void {
  for (const head of name === null ? draft.heads.keys() : [name]) updateHead(draft, head, change);
}

function dropFailed(draft: Draft, name: HeadName): void {
  const failed = (part: PartId) => draft.parts.get(part)?.status.kind === "failed";

  if (!draft.heads.get(name)?.live.some(failed)) return;
  updateHead(draft, name, (head) => ({ ...head, live: head.live.filter((part) => !failed(part)) }));
  draft.rebuild.add(name);
}

function liveRun(draft: Draft, head: HeadName): FoldRun | undefined {
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

function newPath(): Path {
  return { messages: [], committed: 0, at: new Map(), turns: [], turnAt: new Map(), firstAt: [] };
}

function emptyHead(
  name: HeadName,
  path: { readonly messages: readonly Message[]; readonly turns: readonly TurnInfo[] },
): FoldHead {
  return {
    info: { name, tip: START, stack: null, execution: IDLE, unread: false },
    revision: null,
    seen: null,
    messages: path.messages,
    live: [],
    pending: [],
    turns: path.turns,
    background: [],
    configuration: UNCONFIGURED,
    context: NO_CONTEXT,
  };
}

function absentHead(heads: ReadonlyMap<HeadName, FoldHead>, name: HeadName): FoldHead {
  const known = absent.get(heads) ?? new Map<HeadName, FoldHead>();
  const head = known.get(name) ?? emptyHead(name, { messages: [], turns: [] });
  known.set(name, head);
  absent.set(heads, known);

  return head;
}

function tailOf(messages: readonly Message[], tail: number): readonly Message[] {
  const known = tails.get(messages) ?? new Map<number, readonly Message[]>();
  const slice = reuse(known.get(tail) ?? [], messages.slice(Math.max(0, messages.length - tail)));
  known.set(tail, slice);
  tails.set(messages, known);

  return slice;
}

function frozen(turns: readonly TurnInfo[]): readonly TurnInfo[] {
  const known = snapshots.get(turns);

  if (known !== undefined && !known.stale) return known.turns;
  const snapshot = reuse(known?.turns ?? [], [...turns]);
  snapshots.set(turns, { turns: snapshot, stale: false });

  return snapshot;
}

function stale(turns: readonly TurnInfo[]): void {
  const known = snapshots.get(turns);

  if (known !== undefined && !known.stale)
    snapshots.set(turns, { turns: known.turns, stale: true });
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

function partView(part: PartRecord): PartView {
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

function transcriptRole(placement: Placement): "step" | "answer" | "note" | null {
  if (placement.kind !== "transcript") return null;
  const role = placement.role;

  return role === "step" || role === "answer" || role === "note" ? role : null;
}

function reuse<T>(previous: readonly T[], next: readonly T[]): readonly T[] {
  return previous.length === next.length && previous.every((item, index) => item === next[index])
    ? previous
    : next;
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
    tipOf(left.base) === tipOf(right.base)
  );
}

function sameTurnState(left: TurnInfo["state"], right: TurnInfo["state"]): boolean {
  if (left.kind === "working" && right.kind === "working") return left.activity === right.activity;

  if (left.kind === "waiting" && right.kind === "waiting") return left.on === right.on;

  return left === right;
}

function tipOf(position: Position): CommitId | null {
  return position.kind === "commit" ? position.id : null;
}

function messageOf(part: PartId): MessageId {
  return asId<"message">(part);
}

function pendingTurn(id: MessageId): TurnId {
  return asId<"turn">(`pending:${id}`);
}

function isJsonObject(value: Json): value is { readonly [key: string]: Json } {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasMarkdown(
  value: Json,
): value is { readonly [key: string]: Json; readonly markdown: string } {
  return isJsonObject(value) && typeof value.markdown === "string";
}

function isRunning(value: Json): value is { readonly [key: string]: Json } {
  return isJsonObject(value) && value.phase === "running";
}
