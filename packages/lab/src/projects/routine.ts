import { plan } from "./contract.ts";
import type { Plan } from "./contract.ts";
import type { Evidence, PullRequestFact } from "./evidence.ts";
import type { Budget, Dispatch, Lane } from "./lane.ts";
import { babysitterBrief } from "./prompts.ts";
import type { Prompt } from "./prompts.ts";
import { observe, polishLane } from "./world.ts";
import type { Knobs, ModelId } from "./world.ts";

/** Which pull requests a trigger follows: ones a Nyte chat opened, or every one in the repository. */
export type Scope = "chats" | "anyone";

/** A trigger as the composer edits it; the lane's own trigger reads back into the same shape. */
export interface Routine {
  readonly scope: Scope;
  readonly gate: readonly string[];
  readonly model: ModelId;
  readonly shared: boolean;
  readonly budget: Budget;
}

/** What the lane does with one failing check of a caught pull request. */
export type Outcome = "babysitter" | "main" | "shared" | "stopped";

export interface CaughtCheck {
  readonly step: string;
  readonly outcome: Outcome;
}

export interface Catch {
  readonly pull: PullRequestFact;
  readonly checks: readonly CaughtCheck[];
}

export interface Fix {
  readonly usd: number;
  readonly samples: number;
}

export interface Backtest {
  readonly total: number;
  readonly scoped: number;
  readonly caught: readonly Catch[];
  readonly plan: Plan;
  readonly fix: Fix;
  readonly usd: number;
}

export interface Word {
  readonly text: string;
  readonly changed: boolean;
}

export interface Brief {
  readonly prompt: Prompt;
  readonly lines: readonly (readonly Word[])[];
  readonly changed: number;
}

const SOL: ModelId = "openai-codex/gpt-6.1-sol";

export function laneRoutine(lane: Lane, knobs: Knobs): Routine {
  return {
    scope: "chats",
    gate: lane.rules.pullRequest.gate,
    model: knobs.babysitter,
    shared: knobs.families,
    budget: lane.rules.limits.perPullRequest,
  };
}

export function routineLane(routine: Routine, at: number, knobs: Knobs): Lane {
  const lane = polishLane(at, {
    ...knobs,
    babysitter: routine.model,
    families: routine.shared,
    attempts: routine.budget.attempts,
    budgetUsd: routine.budget.usd,
    lifetimeDays: routine.budget.days,
  });

  return {
    ...lane,
    rules: {
      ...lane.rules,
      pullRequest: { ...lane.rules.pullRequest, gate: routine.gate },
    },
  };
}

export function workflows(evidence: Evidence): readonly string[] {
  return [
    ...new Set(evidence.pullRequests.flatMap((pull) => pull.checks.map((check) => check.workflow))),
  ].toSorted();
}

/**
 * Replays the routine over every pull request in the export with the lane's real planner, as if
 * each had been watched from the start, and prices the babysitter runs it would have woken.
 */
export function backtest(evidence: Evidence, routine: Routine, knobs: Knobs): Backtest {
  const at = evidence.observedAt;
  const lane = routineLane(routine, at, knobs);

  const scoped = evidence.pullRequests.filter(
    (pull) => routine.scope === "anyone" || pull.openedBy !== null,
  );

  const planned = plan({
    matching: knobs.matching,
    families: routine.shared,
    lane,
    keeper: "keeper",
    pullRequestWatches: scoped.map((pull) => ({
      number: pull.number,
      lane: lane.id,
      owner: `babysit-${String(pull.number)}`,
      author: pull.openedBy ?? "you",
      budget: routine.budget,
      startedAt: at,
      attempts: 0,
      spentUsd: 0,
      stop: null,
    })),
    previous: null,
    next: observe(evidence, at, evidence.pullRequests),
    dispatched: new Set(),
    pushedByLane: new Set(),
  });

  const caught = scoped.flatMap((pull): readonly Catch[] => {
    const checks = planned.dispatches
      .filter((dispatch) => dispatch.event.pull === pull.number)
      .flatMap((dispatch): readonly CaughtCheck[] => {
        const outcome = classify(dispatch);

        if (outcome === null || dispatch.event.check === null) return [];

        return [
          {
            step: dispatch.event.check.step ?? dispatch.event.check.name,
            outcome,
          },
        ];
      });

    return checks.length === 0 ? [] : [{ pull, checks }];
  });

  const fix = medianFix(evidence, routine.model);

  const babysat = caught.reduce((sum, entry) => {
    const wakes = entry.checks.filter((check) => check.outcome === "babysitter").length;

    return sum + Math.min(Math.min(wakes, routine.budget.attempts) * fix.usd, routine.budget.usd);
  }, 0);

  const keeper = planned.dispatches.filter(
    (dispatch) => dispatch.event.pull === null && dispatch.decision.kind === "wake",
  ).length;

  return {
    total: evidence.pullRequests.length,
    scoped: scoped.length,
    caught,
    plan: planned,
    fix,
    usd: babysat + keeper * fix.usd,
  };
}

function classify(dispatch: Dispatch): Outcome | null {
  if (dispatch.event.kind !== "check-failed") return null;

  switch (dispatch.decision.kind) {
    case "wake":
      return "babysitter";
    case "route":
      return dispatch.decision.cause.startsWith("family:") ? "shared" : "main";
    case "stop":
      return "stopped";
    case "ignore":
    case "ask":
    case "remedy":
      return null;
    default: {
      const _exhaustive: never = dispatch.decision;

      return _exhaustive;
    }
  }
}

/**
 * The median cost of a CI-fix chat in the store. Sol's figure reprices every recorded fix at Sol's
 * rates; any other model counts only the fixes it ran.
 */
export function medianFix(evidence: Evidence, model: ModelId): Fix {
  const costs = (
    model === SOL
      ? evidence.ciFixes.map((fix) => fix.atSolUsd)
      : evidence.ciFixes.filter((fix) => fix.model === model).map((fix) => fix.recordedUsd)
  ).toSorted((left, right) => left - right);

  const middle = Math.floor(costs.length / 2);

  const usd =
    costs.length === 0
      ? 0
      : costs.length % 2 === 1
        ? (costs[middle] ?? 0)
        : ((costs[middle - 1] ?? 0) + (costs[middle] ?? 0)) / 2;

  return { usd, samples: costs.length };
}

/** The babysitter brief this routine would send for its first catch, marked against the lane's. */
export function brief(
  evidence: Evidence,
  routine: Routine,
  current: Routine,
  knobs: Knobs,
  pull: PullRequestFact,
): Brief {
  const author =
    evidence.sessions.find((session) => session.id === pull.openedBy)?.title ?? "the author";

  const input = {
    number: pull.number,
    title: pull.title,
    branch: pull.head,
    worktree:
      evidence.worktrees.find((tree) => tree.branch === pull.head)?.path ??
      `~/.nyte/worktrees/nyte/${pull.head}`,
    author,
  };

  const before = babysitterBrief(routineLane(current, evidence.observedAt, knobs), input);
  const after = babysitterBrief(routineLane(routine, evidence.observedAt, knobs), input);
  const old = [before.model ?? "", ...before.text.split("\n")];

  const lines = [after.model ?? "", ...after.text.split("\n")].map((line, index) =>
    markWords(old[index] ?? "", line),
  );

  return {
    prompt: after,
    lines,
    changed: lines.filter((words) => words.some((word) => word.changed)).length,
  };
}

/** Marks the words of `after` outside its longest common word sequence with `before`. */
function markWords(before: string, after: string): readonly Word[] {
  const old = before.split(" ");
  const next = after.split(" ");

  const table = Array.from({ length: old.length + 1 }, () =>
    Array.from({ length: next.length + 1 }, () => 0),
  );

  for (let i = old.length - 1; i >= 0; i -= 1)
    for (let j = next.length - 1; j >= 0; j -= 1) {
      const row = table[i];

      if (row !== undefined)
        row[j] =
          old[i] === next[j]
            ? (table[i + 1]?.[j + 1] ?? 0) + 1
            : Math.max(table[i + 1]?.[j] ?? 0, row[j + 1] ?? 0);
    }

  const kept = new Set<number>();
  let i = 0;
  let j = 0;

  while (i < old.length && j < next.length) {
    if (old[i] === next[j]) {
      kept.add(j);
      i += 1;
      j += 1;
    } else if ((table[i + 1]?.[j] ?? 0) >= (table[i]?.[j + 1] ?? 0)) i += 1;
    else j += 1;
  }

  return next.map((text, index) => ({ text, changed: text !== "" && !kept.has(index) }));
}

export function sameRoutine(left: Routine, right: Routine): boolean {
  return (
    left.scope === right.scope &&
    left.model === right.model &&
    left.shared === right.shared &&
    left.gate.join() === right.gate.join() &&
    left.budget.attempts === right.budget.attempts &&
    left.budget.usd === right.budget.usd &&
    left.budget.days === right.budget.days
  );
}
