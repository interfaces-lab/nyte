import type { HeadName, Message } from "@nyte-ai/schema";
import { INDEX } from "../contract/fold.ts";
import type { Draft, FoldState, Path } from "../contract/fold.ts";
import { readPositionCommit, walkCommitPath } from "../store/session.ts";
import { committed, reuse, setTurn, stale, toPartMessageId } from "./draft.ts";

export function finish(state: FoldState, draft: Draft): FoldState {
  for (const name of updatePaths(draft)) {
    const head = draft.heads.get(name);

    if (head !== undefined) draft.heads.set(name, { ...head });
  }

  return {
    [INDEX]: state[INDEX],
    session: state.session,
    principal: state.principal,
    seen: draft.seen,
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

    const commits = walked
      ? walkCommitPath(draft.commits, readPositionCommit(head.info.tip))
      : appended === undefined
        ? []
        : [appended];

    truncate(draft, name, path, from);

    for (const commit of commits) {
      const message = committed(draft, commit);

      if (message !== undefined) push(draft, name, path, message);
    }

    path.committed = path.messages.length;

    for (const id of [...head.live.map(toPartMessageId), ...head.pending]) {
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
