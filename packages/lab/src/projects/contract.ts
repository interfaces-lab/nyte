import type {
  Decision,
  Dispatch,
  EventKind,
  Lane,
  Observation,
  ObservedCheck,
  PullObservation,
  TriggerEvent,
  PullRequestWatch,
} from "./lane.ts";

export type Matching = "step-and-files" | "check-name";

export interface PlanInput {
  readonly matching: Matching;
  readonly families: boolean;
  readonly lane: Lane;
  readonly keeper: string;
  readonly pullRequestWatches: readonly PullRequestWatch[];
  readonly previous: Observation | null;
  readonly next: Observation;
  readonly dispatched: ReadonlySet<string>;
  readonly pushedByLane: ReadonlySet<string>;
}

export interface Plan {
  readonly dispatches: readonly Dispatch[];
  readonly runs: number;
  readonly remedies: number;
  readonly baseFixes: readonly string[];
  readonly asks: number;
}

export function eventKey(
  repository: string,
  kind: EventKind,
  branch: string,
  pull: number | null,
  subject: string,
): string {
  return `${repository}${pull === null ? `@${branch}` : `#${String(pull)}`}:${kind}:${subject}`;
}

export function familyKey(check: ObservedCheck): string {
  return `family:${check.workflow}/${check.name}:${check.step ?? ""}:${[...check.files].toSorted().join(",")}`;
}

function families(input: PlanInput): ReadonlySet<string> {
  if (!input.families) return new Set();

  const watched = input.next.pulls.filter((pull) =>
    input.pullRequestWatches.some((watch) => watch.number === pull.number && watch.stop === null),
  );

  const own = watched.flatMap((pull) =>
    pull.checks
      .filter(
        (check) =>
          check.outcome === "failed" && input.lane.rules.pullRequest.gate.includes(check.workflow),
      )
      .filter((check) => inheritedRoot(input.next, pull, check, input.matching) === null)
      .map((check) => familyKey(check)),
  );

  return new Set(own.filter((key, index) => own.indexOf(key) !== index));
}

export function plan(input: PlanInput): Plan {
  const repository = input.lane.repository;
  const shared = families(input);
  const gated = input.next.pulls.flatMap((pull) => pullEvents(repository, input, pull, shared));

  const roots = [
    ...new Set(
      gated.flatMap((entry) => (entry.decision.kind === "route" ? [entry.decision.cause] : [])),
    ),
  ];

  const keeper = roots.flatMap((root) => baseDispatch(input, root));
  const asked = new Set<string>();

  const dispatches = [...gated, ...keeper].flatMap((dispatch): readonly Dispatch[] => {
    if (input.dispatched.has(dispatch.key)) return [];

    if (dispatch.decision.kind !== "ask") return [dispatch];

    if (asked.has(dispatch.decision.cause))
      return [
        {
          ...dispatch,
          decision: {
            kind: "ignore",
            reason: `asked once for ${dispatch.decision.cause}`,
          } satisfies Decision,
        },
      ];

    asked.add(dispatch.decision.cause);

    return [dispatch];
  });

  return {
    dispatches,
    runs: dispatches.filter((dispatch) => dispatch.decision.kind === "wake").length,
    remedies: dispatches.filter((dispatch) => dispatch.decision.kind === "remedy").length,
    baseFixes: [
      ...new Set(
        dispatches.flatMap((dispatch) =>
          dispatch.decision.kind === "route" ? [dispatch.decision.cause] : [],
        ),
      ),
    ],
    asks: dispatches.filter((dispatch) => dispatch.decision.kind === "ask").length,
  };
}

function pullEvents(
  repository: string,
  input: PlanInput,
  pull: PullObservation,
  shared: ReadonlySet<string>,
): readonly Dispatch[] {
  const watch = input.pullRequestWatches.find(
    (candidate) => candidate.number === pull.number && candidate.stop === null,
  );

  if (watch === undefined) return [];
  const before = input.previous?.pulls.find((candidate) => candidate.number === pull.number);
  const gate = input.lane.rules.pullRequest.gate;

  const event = (kind: EventKind, subject: string, check: ObservedCheck | null): TriggerEvent => ({
    key: eventKey(repository, kind, pull.head, pull.number, subject),
    kind,
    pull: pull.number,
    branch: pull.head,
    subject,
    check,
  });

  const dispatch = (triggered: TriggerEvent, decision: Decision, owner: string): Dispatch => ({
    key: triggered.key,
    lane: input.lane.id,
    owner,
    event: triggered,
    decision,
    at: input.next.at,
    costUsd: 0,
  });

  if (pull.state === "MERGED" && before?.state !== "MERGED")
    return [
      dispatch(
        event("merged", pull.headSha, null),
        { kind: "stop", reason: "merged" },
        watch.owner,
      ),
    ];

  if (pull.state === "CLOSED" && before?.state !== "CLOSED")
    return [
      dispatch(
        event("closed", pull.headSha, null),
        { kind: "stop", reason: "closed" },
        watch.owner,
      ),
    ];

  const pushed =
    before !== undefined && before.headSha !== pull.headSha
      ? [
          dispatch(
            event("pushed", pull.headSha, null),
            input.pushedByLane.has(pull.headSha)
              ? { kind: "ignore", reason: "the lane pushed it" }
              : { kind: "stop", reason: "pushed-by-someone-else" },
            watch.owner,
          ),
        ]
      : [];

  const moved =
    before !== undefined && before.baseSha !== pull.baseSha
      ? [
          dispatch(
            event("base-moved", pull.baseSha, null),
            input.pushedByLane.has(pull.baseSha)
              ? { kind: "ignore", reason: "the lane rebased it" }
              : {
                  kind: "ask",
                  question: `${pull.base} moved to ${pull.baseSha.slice(0, 9)}. Rebase the branches on it? Old heads stay kept.`,
                  cause: `rebase onto ${pull.base}@${pull.baseSha.slice(0, 9)}`,
                },
            watch.owner,
          ),
        ]
      : [];

  const failed = pull.checks
    .filter((check) => check.outcome === "failed")
    .filter(
      (check) =>
        before?.checks.some(
          (old) =>
            old.name === check.name && old.outcome === "failed" && before.headSha === pull.headSha,
        ) !== true,
    )
    .map((check) => {
      const triggered = event(
        "check-failed",
        `${pull.headSha}:${check.workflow}/${check.name}`,
        check,
      );

      if (!gate.includes(check.workflow))
        return dispatch(
          triggered,
          { kind: "ignore", reason: `${check.workflow}/${check.name} is not in this lane's gate` },
          watch.owner,
        );

      const root =
        inheritedRoot(input.next, pull, check, input.matching) ??
        (shared.has(familyKey(check)) ? familyKey(check) : null);

      if (root !== null)
        return dispatch(triggered, { kind: "route", to: input.keeper, cause: root }, input.keeper);

      return dispatch(triggered, wakeOrStop(input, watch, pull, check), watch.owner);
    });

  const passed =
    readyToMerge(pull, gate) &&
    (before === undefined || !readyToMerge(before, gate) || before.headSha !== pull.headSha)
      ? [
          dispatch(
            event("checks-passed", pull.headSha, null),
            {
              kind: "ask",
              question: `#${String(pull.number)} is ready to merge.`,
              cause: `ready #${String(pull.number)}@${pull.headSha.slice(0, 9)}`,
            },
            watch.owner,
          ),
        ]
      : [];

  const threads =
    pull.unresolvedThreads > (before?.unresolvedThreads ?? 0)
      ? [
          dispatch(
            event("thread-opened", `${pull.headSha}:${String(pull.unresolvedThreads)}`, null),
            {
              kind: "wake",
              message: `A reviewer opened a thread on #${String(pull.number)}. Read it, fix what it asks, reply on the thread.`,
            },
            watch.owner,
          ),
        ]
      : [];

  return [...pushed, ...moved, ...failed, ...passed, ...threads];
}

export function readyToMerge(pull: PullObservation, gate: readonly string[]): boolean {
  const gateChecks = pull.checks.filter((check) => gate.includes(check.workflow));

  return (
    pull.state === "OPEN" &&
    gateChecks.length > 0 &&
    gateChecks.every((check) => check.outcome === "passed" || check.outcome === "skipped") &&
    pull.unresolvedThreads === 0 &&
    pull.mergeable
  );
}

function wakeOrStop(
  input: PlanInput,
  watch: PullRequestWatch,
  pull: PullObservation,
  check: ObservedCheck,
): Decision {
  const budget = watch.budget;

  if (watch.attempts >= budget.attempts) return { kind: "stop", reason: "attempts" };

  if (watch.spentUsd >= budget.usd) return { kind: "stop", reason: "budget" };

  if (input.next.at - watch.startedAt > budget.days * 86_400_000)
    return { kind: "stop", reason: "expired" };

  return {
    kind: "wake",
    message: `${check.workflow}/${check.name} failed at \`${check.step ?? "?"}\` on ${pull.headSha.slice(0, 9)}${check.runId === null ? "" : ` (run ${String(check.runId)})`}. It does not fail on ${pull.base}, so it is this pull request's. Attempt ${String(watch.attempts + 1)} of ${String(budget.attempts)}, $${watch.spentUsd.toFixed(2)} of $${budget.usd.toFixed(2)} spent.`,
  };
}

function sameFailure(own: ObservedCheck, base: ObservedCheck, matching: Matching): boolean {
  if (base.outcome !== "failed") return false;

  if (matching === "check-name") return own.workflow === base.workflow && own.name === base.name;

  if (own.step === null || own.step !== base.step) return false;

  return own.files.length === 0
    ? own.name === base.name
    : own.files.every((file) => base.files.includes(file));
}

export function inheritedRoot(
  observation: Observation,
  pull: PullObservation,
  check: ObservedCheck,
  matching: Matching,
): string | null {
  const parent = observation.pulls.find(
    (candidate) => candidate.head === pull.base && candidate.headSha === pull.baseSha,
  );

  if (parent !== undefined) {
    const parentCheck = parent.checks.find((candidate) => sameFailure(check, candidate, matching));

    return parentCheck === undefined
      ? null
      : inheritedRoot(observation, parent, parentCheck, matching);
  }

  const base = observation.bases.find(
    (candidate) => candidate.branch === pull.base && candidate.sha === pull.baseSha,
  );

  const baseCheck = base?.checks.find((candidate) => sameFailure(check, candidate, matching));

  if (base === undefined || baseCheck === undefined) return null;

  return `${base.branch}@${base.sha.slice(0, 9)}:${baseCheck.workflow}/${baseCheck.name}:${baseCheck.step ?? ""}`;
}

function familyDispatch(input: PlanInput, root: string): readonly Dispatch[] {
  const sample = input.next.pulls
    .flatMap((pull) => pull.checks)
    .find((check) => check.outcome === "failed" && familyKey(check) === root);

  if (sample === undefined) return [];

  const count = input.next.pulls.filter((pull) =>
    pull.checks.some((check) => check.outcome === "failed" && familyKey(check) === root),
  ).length;

  const remedy = input.lane.rules.remedies.find(
    (candidate) => candidate.check === sample.workflow && candidate.step === sample.step,
  );

  const asked = input.lane.rules.asks.find((candidate) => candidate.workflow === sample.workflow);

  const key = eventKey(
    input.lane.repository,
    "check-failed",
    input.lane.rules.pullRequest.base,
    null,
    root,
  );

  const decision: Decision =
    remedy !== undefined
      ? {
          kind: "remedy",
          command: remedy.command.replace("<files>", sample.files.join(" ")),
          commit: remedy.commit,
        }
      : asked !== undefined
        ? {
            kind: "ask",
            question: `${String(count)} pull requests fail ${sample.workflow}/${sample.name} on their own. ${asked.question}`,
            cause: root,
          }
        : {
            kind: "wake",
            message: `${String(count)} pull requests fail ${sample.workflow}/${sample.name} at \`${sample.step ?? "?"}\` on their own. Fix it once on a branch from ${input.lane.rules.pullRequest.base}.`,
          };

  return [
    {
      key,
      lane: input.lane.id,
      owner: input.keeper,
      event: {
        key,
        kind: "check-failed",
        pull: null,
        branch: input.lane.rules.pullRequest.base,
        subject: root,
        check: sample,
      },
      decision,
      at: input.next.at,
      costUsd: 0,
    },
  ];
}

function baseDispatch(input: PlanInput, root: string): readonly Dispatch[] {
  if (root.startsWith("family:")) return familyDispatch(input, root);
  const [branchAt = ""] = root.split(":");
  const [branch = "", sha = ""] = branchAt.split("@");

  const base = input.next.bases.find(
    (candidate) => candidate.branch === branch && candidate.sha.startsWith(sha),
  );

  const check = base?.checks.find((candidate) =>
    root.endsWith(`${candidate.workflow}/${candidate.name}:${candidate.step ?? ""}`),
  );

  if (base === undefined || check === undefined) return [];

  const remedy = input.lane.rules.remedies.find(
    (candidate) => candidate.check === check.workflow && candidate.step === check.step,
  );

  const key = eventKey(
    input.lane.repository,
    "check-failed",
    base.branch,
    null,
    `${base.sha}:${check.workflow}/${check.name}`,
  );

  return [
    {
      key,
      lane: input.lane.id,
      owner: input.keeper,
      event: {
        key,
        kind: "check-failed",
        pull: null,
        branch: base.branch,
        subject: `${base.sha}:${check.workflow}/${check.name}`,
        check,
      },
      decision:
        remedy === undefined
          ? {
              kind: "wake",
              message: `${base.branch} fails ${check.workflow}/${check.name} at \`${check.step ?? "?"}\`. Fix it once there.`,
            }
          : {
              kind: "remedy",
              command: remedy.command.replace("<files>", check.files.join(" ")),
              commit: remedy.commit,
            },
      at: input.next.at,
      costUsd: 0,
    },
  ];
}
