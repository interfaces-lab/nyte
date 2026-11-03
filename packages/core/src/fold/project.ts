import type { Execution, HeadName, Message, Revision, SessionView } from "@nyte-ai/schema";
import { INDEX } from "../contract/fold.ts";
import type { FoldState, HeadPair, Path } from "../contract/fold.ts";
import { readPositionCommit, START } from "../store/session.ts";

export function holdsReports(execution: Execution): boolean {
  return execution.kind === "idle" && execution.lastRun?.end.kind !== "completed";
}

export function readSeenThrough(state: FoldState, head: HeadName): number | null {
  const mark = state.seen.get(state.principal)?.get(head) ?? null;

  return mark === null ? null : (state.commits.get(mark)?.at ?? null);
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

export function showMessage(message: Message): Message {
  return message;
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
