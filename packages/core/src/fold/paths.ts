import type { HeadName, Message } from "@nyte-ai/schema";
import { INDEX } from "../contract/fold.ts";
import type { Draft, FoldState, Path, Ring, Table } from "../contract/fold.ts";
import { readPositionCommit, walkCommitPath } from "../store/session.ts";
import { addUsage, ZERO_USAGE } from "../util/usage.ts";
import { committed, reuse, setTurn, stale, toPartMessageId, touchPath, touchRow } from "./draft.ts";

const RING = 512;

export function finish(state: FoldState, draft: Draft): FoldState {
  for (const name of updatePaths(draft)) {
    const head = draft.heads.get(name);

    if (head !== undefined) draft.heads.set(name, { ...head });
  }

  if (draft.durable) record(state[INDEX].ring, draft);

  return {
    [INDEX]: state[INDEX],
    session: state.session,
    principal: state.principal,
    seen: draft.seen,
    seq: draft.seq,
    base: state.base,
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

function record(ring: Ring, draft: Draft): void {
  const last = ring.steps.at(-1);

  if (last?.seq !== draft.seq) {
    ring.steps.push({ seq: draft.seq, ...draft.touched });
    const evicted = ring.steps.length > RING ? ring.steps.shift() : undefined;

    if (evicted !== undefined) ring.from = evicted.seq;

    return;
  }

  for (const table of TABLES) {
    for (const key of draft.touched.upsert[table]) {
      last.upsert[table].add(key);
      last.drop[table].delete(key);
    }

    for (const key of draft.touched.drop[table]) {
      last.drop[table].add(key);
      last.upsert[table].delete(key);
    }
  }

  for (const [head, position] of draft.touched.paths)
    last.paths.set(head, Math.min(position, last.paths.get(head) ?? position));
}

const TABLES: readonly Table[] = [
  "messages",
  "turns",
  "parts",
  "changes",
  "catalog",
  "heads",
  "background",
];

function updatePaths(draft: Draft): ReadonlySet<HeadName> {
  const touched = new Set<HeadName>();
  const reflows = new Map<HeadName, number>();
  const sums = new Map<HeadName, number>();

  const reflow = (name: HeadName, from: number): void => {
    reflows.set(name, Math.min(from, reflows.get(name) ?? from));
    touched.add(name);
  };

  const resum = (name: HeadName, from: number): void => {
    sums.set(name, Math.min(from, sums.get(name) ?? from));
  };

  for (const name of new Set([...draft.walk, ...draft.appended.keys(), ...draft.rebuild])) {
    const head = draft.heads.get(name);
    const path = draft.paths.get(name);

    if (head === undefined || path === undefined) continue;
    const walked = draft.walk.has(name);
    const appended = draft.appended.get(name);
    const kept = walked ? 0 : path.committed;

    const commits = walked
      ? walkCommitPath(draft.commits, readPositionCommit(head.info.tip))
      : appended === undefined
        ? []
        : [appended];

    const landed = commits.flatMap((commit) => committed(draft, commit) ?? []);

    const next = [
      ...landed,
      ...[...head.live.map(toPartMessageId), ...head.pending].flatMap(
        (id) => draft.messages.get(id) ?? [],
      ),
    ];

    const start = kept + sharedLength(path.messages, kept, next);
    const leaving = new Set(path.messages.slice(start).map((message) => message.id));
    truncate(draft, name, path, start);

    for (const message of next.slice(start - kept)) {
      if (!leaving.has(message.id)) place(draft, message);
      push(draft, name, path, message);
    }

    path.committed = kept + landed.length;

    if (start < path.messages.length || leaving.size > 0) touchPath(draft, name, start);
    reflow(name, start);
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

      if (message.kind === "user") touchPath(draft, name, position);

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

    if (path !== undefined) resum(name, reflowTurns(draft, path, from));
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
      resum(name, position);
    }
  }

  for (const [name, from] of sums) {
    const path = draft.paths.get(name);

    if (path === undefined) continue;
    const before = path.usage.at(-1) ?? ZERO_USAGE;
    sumUsage(path, from);

    const after = path.usage.at(-1) ?? ZERO_USAGE;

    if (before !== after && JSON.stringify(before) !== JSON.stringify(after))
      touchRow(draft, "heads", name);
  }

  return touched;
}

export function sumUsage(path: Path, from: number): void {
  path.usage.splice(from);

  for (const info of path.turns.slice(from)) {
    const prior = path.usage.at(-1) ?? ZERO_USAGE;

    path.usage.push(
      info.state.kind === "ended" && info.state.end.kind === "completed"
        ? addUsage(prior, info.state.end.usage)
        : prior,
    );
  }
}

function sharedLength(
  messages: readonly Message[],
  offset: number,
  next: readonly Message[],
): number {
  const length = Math.min(messages.length - offset, next.length);
  const index = next.slice(0, length).findIndex((message, at) => messages[offset + at] !== message);

  return index < 0 ? length : index;
}

function place(draft: Draft, message: Message): void {
  touchRow(draft, "messages", message.id);

  if (draft.turns.has(message.turn)) touchRow(draft, "turns", message.turn);
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

function reflowTurns(draft: Draft, path: Path, from: number): number {
  while ((path.firstAt.at(-1) ?? -1) >= from) {
    path.firstAt.pop();
    const info = path.turns.pop();

    if (info !== undefined) path.turnAt.delete(info.id);
  }

  const kept = path.turns.length;

  for (let position = from; position < path.messages.length; position += 1) {
    const message = path.messages[position];

    if (message.kind === "user" && message.status.kind !== "landed") continue;
    const turn = draft.turns.get(message.turn);

    if (turn === undefined || path.turnAt.has(turn.info.id)) continue;
    path.turnAt.set(turn.info.id, path.turns.length);
    path.turns.push(turn.info);
    path.firstAt.push(position);
  }

  stale(path.turns);

  return kept;
}
