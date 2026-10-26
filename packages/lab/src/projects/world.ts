import { plan } from "./contract.ts";
import type { Matching, Plan } from "./contract.ts";
import type { CheckFact, Evidence, PullRequestFact, Trace } from "./evidence.ts";
import type {
  CallFact,
  DesignedSession,
  Lane,
  Membership,
  ModelChoice,
  Observation,
  ObservedCheck,
  PullRequestLink,
  World,
  WriterLease,
} from "./lane.ts";
import {
  babysitterBrief,
  dragNotice,
  restackQuestion,
  reviewerBrief,
  setupPrompt,
  workerBrief,
} from "./prompts.ts";
import type { Prompt } from "./prompts.ts";

interface Ticked {
  readonly world: World;
  readonly plan: Plan;
}

export interface Step {
  readonly id: string;
  readonly clock: string;
  readonly label: string;
  readonly caption: string;
  readonly estimate: boolean;
  readonly world: World;
  readonly plan: Plan | null;
  readonly prompts: readonly Prompt[];
  readonly focus: readonly Trace[];
}

export type ScenarioId = "today" | "incident" | "stack" | "drag";

export interface Scenario {
  readonly id: ScenarioId;
  readonly title: string;
  readonly summary: string;
  readonly steps: readonly Step[];
}

const WORKTREES = "/Users/workgyver/.nyte/worktrees/nyte";

const DRAGGED = "25e38e5a-173e-4ef8-b26d-f4364ed23f98";

const KEEPER = "lane:polish:keeper";

const MINUTE = 60_000;

export type ModelId = "openai-codex/gpt-6.1-sol" | "anthropic/claude-opus-5-5";

export interface Knobs {
  readonly worker: ModelId;
  readonly reviewer: ModelId;
  readonly babysitter: ModelId;
  readonly gateChangesets: boolean;
  readonly remedies: boolean;
  readonly families: boolean;
  readonly matching: Matching;
  readonly attempts: number;
  readonly budgetUsd: number;
  readonly lifetimeDays: number;
  readonly pollPendingSeconds: number;
  readonly pollSettledSeconds: number;
}

export const DEFAULT_KNOBS: Knobs = {
  worker: "openai-codex/gpt-6.1-sol",
  reviewer: "anthropic/claude-opus-5-5",
  babysitter: "openai-codex/gpt-6.1-sol",
  gateChangesets: true,
  remedies: true,
  families: true,
  matching: "step-and-files",
  attempts: 3,
  budgetUsd: 2,
  lifetimeDays: 7,
  pollPendingSeconds: 60,
  pollSettledSeconds: 300,
};

function choice(model: ModelId, thinking: ModelChoice["thinking"]): ModelChoice {
  const [provider = "", id = ""] = model.split("/");

  return { provider, id, thinking };
}

export function polishLane(at: number, knobs: Knobs = DEFAULT_KNOBS): Lane {
  const budget = { attempts: knobs.attempts, usd: knobs.budgetUsd, days: knobs.lifetimeDays };

  return {
    id: "polish",
    host: "this Mac",
    name: "Polish",
    intent:
      "Small fixes to Nyte's code quality and UI. Sol works each fix; Opus reviews it for code quality and UI correctness, commits it and opens the PR; a babysitter on Sol follows the PR until it merges.",
    until: { kind: "standing" },
    repository: "interfaces-lab/nyte",
    state: "active",
    createdAt: at,
    rules: {
      roles: {
        worker: {
          model: choice(knobs.worker, "medium"),
          skills: [
            { name: "nyte-styles", location: ".agents/skills/nyte-styles/SKILL.md" },
            { name: "clean-copy", location: "~/.agents/skills/clean-copy/SKILL.md" },
            { name: "unslop", location: "~/.agents/skills/unslop/SKILL.md" },
          ],
        },
        reviewer: {
          model: choice(knobs.reviewer, "high"),
          skills: [
            { name: "principles-review", location: "~/.agents/skills/principle-review/SKILL.md" },
            { name: "better-interface", location: "~/.agents/skills/better-interface/SKILL.md" },
          ],
        },
        babysitter: { model: choice(knobs.babysitter, "low"), skills: [] },
      },
      checkout: { from: "origin/main", copyUncommitted: false },
      commit: {
        by: "reviewer",
        message: "`type(scope): summary`",
        branch: "at most three hyphenated words",
      },
      pullRequest: {
        by: "reviewer",
        base: "main",
        gate: knobs.gateChangesets ? ["CI", "Changesets"] : ["CI"],
        merge: "ask",
        restack: "ask",
      },
      never: [
        "add .changeset files",
        "edit workflow files or lockfiles",
        "force-push",
        "stash, reset, checkout . or clean",
      ],
      remedies: knobs.remedies
        ? [
            {
              check: "CI",
              step: "pnpm format",
              command: "pnpm exec oxfmt <files>",
              commit: "style: format the files main leaves unformatted",
            },
          ]
        : [],
      asks: [
        {
          workflow: "Changesets",
          question:
            "RELEASING.md asks each pull request for a changeset, but AGENTS.md says to add none. Stop checking Changesets in this lane?",
        },
      ],
      triggers: [
        {
          id: "babysit-prs",
          when: { source: "github", event: "pull-request-opened", branches: "lane" },
          action: { kind: "babysit", role: "babysitter" },
          until: ["merged", "closed", "ready"],
          budget,
        },
      ],
      limits: {
        workers: 4,
        watched: 20,
        dailyUsd: 15,
        perPullRequest: budget,
        pollPendingSeconds: knobs.pollPendingSeconds,
        pollSettledSeconds: knobs.pollSettledSeconds,
      },
      requires: { cli: ["gh"], mcp: [] },
    },
  };
}

function observedCheck(check: CheckFact): ObservedCheck {
  return {
    workflow: check.workflow,
    name: check.name,
    outcome: check.state,
    runId: check.runId,
    step: check.failure?.step ?? null,
    files: check.failure?.files ?? [],
  };
}

export function observe(evidence: Evidence, at = evidence.observedAt): Observation {
  const open = evidence.pullRequests.filter((pull) => pull.state === "OPEN");

  const baseSha = (pull: PullRequestFact): string =>
    open.find((candidate) => candidate.head === pull.base)?.headSha ??
    (pull.base === evidence.base.branch ? evidence.base.sha : "");

  return {
    at,
    pulls: open.map((pull) => ({
      number: pull.number,
      state: pull.state,
      head: pull.head,
      headSha: pull.headSha,
      base: pull.base,
      baseSha: baseSha(pull),
      checks: pull.checks.map(observedCheck),
      unresolvedThreads: 0,
      mergeable: true,
    })),
    bases: [
      {
        branch: evidence.base.branch,
        sha: evidence.base.sha,
        checks: evidence.base.checks.map(observedCheck),
      },
    ],
  };
}

function today(evidence: Evidence): World {
  return {
    at: evidence.observedAt,
    sessions: evidence.sessions,
    pullRequests: evidence.pullRequests,
    designed: [],
    worktrees: evidence.worktrees,
    answered: [],
    lanes: [],
    memberships: [],
    leases: [
      ...evidence.worktrees.flatMap((tree) =>
        tree.owner === null
          ? []
          : [
              {
                checkout: tree.path,
                session: tree.owner,
                since: 0,
                until: null,
                via: "isolated",
              } satisfies WriterLease,
            ],
      ),
      ...evidence.checkout.writersNow.map(
        (session) =>
          ({
            checkout: evidence.checkout.folder,
            session,
            since: 0,
            until: null,
            via: "implicit",
          }) satisfies WriterLease,
      ),
    ],
    links: evidence.pullRequests.flatMap((pull) =>
      pull.openedBy === null
        ? []
        : [
            {
              session: pull.openedBy,
              number: pull.number,
              head: pull.head,
              base: pull.base,
              via: "created",
              at: pull.createdAt,
            } satisfies PullRequestLink,
          ],
    ),
    pullRequestWatches: [],
    dispatches: [],
    observation: observe(evidence),
    calls: [],
    kept: [],
  };
}

function babysitter(number: number, author: string, model: string): DesignedSession {
  return {
    id: `lane:polish:babysit-${String(number)}`,
    title: `Babysit #${String(number)}`,
    role: "babysitter",
    parent: author,
    model,
    running: false,
    costUsd: 0,
    contextTokens: 0,
  };
}

function keeper(model: string): DesignedSession {
  return {
    id: KEEPER,
    title: "Keep main green",
    role: "keeper",
    parent: null,
    model,
    running: false,
    costUsd: 0,
    contextTokens: 0,
  };
}

function adopt(
  world: World,
  lane: Lane,
  pulls: readonly PullRequestFact[],
  at: number,
  via: Membership["via"],
): World {
  const model = `${lane.rules.roles.babysitter.model.provider}/${lane.rules.roles.babysitter.model.id}`;

  const authors = [
    ...new Set(pulls.flatMap((pull) => (pull.openedBy === null ? [] : [pull.openedBy]))),
  ];

  return {
    ...world,
    at,
    lanes: [lane],
    designed: [
      keeper(model),
      ...pulls.map((pull) => babysitter(pull.number, pull.openedBy ?? KEEPER, model)),
    ],
    memberships: [
      ...authors.map(
        (session) =>
          ({ session, lane: lane.id, role: "author", joinedAt: at, via }) satisfies Membership,
      ),
      ...pulls.map(
        (pull) =>
          ({
            session: `lane:polish:babysit-${String(pull.number)}`,
            lane: lane.id,
            role: "babysitter",
            joinedAt: at,
            via: "trigger",
          }) satisfies Membership,
      ),
      { session: KEEPER, lane: lane.id, role: "keeper", joinedAt: at, via: "started" },
    ],
    leases: [
      ...world.leases,
      ...pulls.map(
        (pull) =>
          ({
            checkout: `${WORKTREES}/${pull.head}`,
            session: `lane:polish:babysit-${String(pull.number)}`,
            since: at,
            until: null,
            via: "isolated",
          }) satisfies WriterLease,
      ),
    ],
    pullRequestWatches: pulls.map((pull) => ({
      number: pull.number,
      lane: lane.id,
      owner: `lane:polish:babysit-${String(pull.number)}`,
      author: pull.openedBy ?? KEEPER,
      budget: lane.rules.limits.perPullRequest,
      startedAt: at,
      attempts: 0,
      spentUsd: 0,
      stop: null,
    })),
  };
}

function tick(
  world: World,
  lane: Lane,
  knobs: Knobs,
  previous: Observation | null,
  next: Observation,
  pushedByLane: ReadonlySet<string> = new Set(),
): Ticked {
  const planned = plan({
    matching: knobs.matching,
    families: knobs.families,
    lane,
    keeper: KEEPER,
    pullRequestWatches: world.pullRequestWatches,
    previous,
    next,
    dispatched: new Set(world.dispatches.map((dispatch) => dispatch.key)),
    pushedByLane,
  });

  return {
    world: {
      ...world,
      at: next.at,
      observation: next,
      dispatches: [...world.dispatches, ...planned.dispatches],
    },
    plan: planned,
  };
}

function withBase(observation: Observation, sha: string, at: number): Observation {
  return {
    at,
    pulls: observation.pulls.map((pull) =>
      pull.base === "main" ? { ...pull, baseSha: sha } : pull,
    ),
    bases: observation.bases.map((base) => ({
      ...base,
      sha,
      checks: base.checks.map((check) => ({ ...check, outcome: "passed", step: null, files: [] })),
    })),
  };
}

function rebased(
  observation: Observation,
  onto: string,
  numbers: ReadonlySet<number>,
  at: number,
): Observation {
  return {
    at,
    bases: observation.bases,
    pulls: observation.pulls.map((pull) =>
      numbers.has(pull.number)
        ? {
            ...pull,
            headSha: `${pull.headSha.slice(0, 7)}r`,
            baseSha: pull.base === "main" ? onto : `${pull.baseSha.slice(0, 7)}r`,
            checks: pull.checks.map((check) => ({
              ...check,
              outcome: "pending",
              step: null,
              files: [],
            })),
          }
        : pull,
    ),
  };
}

function green(observation: Observation, number: number, at: number): Observation {
  return {
    at,
    bases: observation.bases,
    pulls: observation.pulls.map((pull) =>
      pull.number === number
        ? {
            ...pull,
            checks: pull.checks.map((check) => ({
              ...check,
              outcome: check.workflow === "CI" ? "passed" : check.outcome,
            })),
          }
        : pull,
    ),
  };
}

function withoutChangesets(lane: Lane): Lane {
  return {
    ...lane,
    rules: { ...lane.rules, pullRequest: { ...lane.rules.pullRequest, gate: ["CI"] } },
  };
}

function answer(world: World, lane: Lane, at: number): World {
  const asked = world.dispatches
    .filter((dispatch) => dispatch.decision.kind === "ask")
    .map((dispatch) => dispatch.key);

  return { ...world, at, lanes: [lane], answered: [...world.answered, ...asked] };
}

function stackScenario(evidence: Evidence, knobs: Knobs): Scenario {
  const lane = polishLane(evidence.observedAt, knobs);
  const open = evidence.pullRequests.filter((pull) => pull.state === "OPEN");
  const start = adopt(today(evidence), lane, open, evidence.observedAt, "dragged");
  const first = tick(start, lane, knobs, null, observe(evidence));

  const second = tick(
    first.world,
    lane,
    knobs,
    first.world.observation,
    observe(evidence, evidence.observedAt + MINUTE),
  );

  const gated = withoutChangesets(lane);
  const answered = answer(second.world, gated, evidence.observedAt + 2 * MINUTE);
  const fixedSha = "f0r4a7a1n";
  const afterFix = withBase(second.world.observation, fixedSha, evidence.observedAt + 23 * MINUTE);
  const third = tick(answered, gated, knobs, second.world.observation, afterFix);
  const stack = new Set(open.map((pull) => pull.number));
  const pushed = new Set(open.map((pull) => `${pull.headSha.slice(0, 7)}r`));

  const fourth = tick(
    answer(third.world, gated, evidence.observedAt + 25 * MINUTE),
    gated,
    knobs,
    third.world.observation,
    rebased(afterFix, fixedSha, stack, evidence.observedAt + 25 * MINUTE),
    pushed,
  );

  const routed = first.plan.dispatches.filter(
    (dispatch) => dispatch.decision.kind === "route",
  ).length;

  return {
    id: "stack",
    title: "Red stack",
    summary: `All ${String(open.length)} open pull requests are red. The trigger contract, replayed on them, plans one fix on main, one question, and nothing per pull request.`,
    steps: [
      {
        id: "adopt",
        clock: "0:00",
        label: "Adopt",
        caption: `The Polish lane adopts the ${String(open.length)} open pull requests: each gets a watch and a babysitter that has not run.`,
        estimate: false,
        world: start,
        plan: null,
        prompts: [],
        focus: open.map((pull) => ({ kind: "pull-request", number: pull.number })),
      },
      {
        id: "tick-1",
        clock: "0:01",
        label: "First tick",
        caption: `${String(first.plan.dispatches.length)} dispatches. ${String(routed)} failures route to main's keeper: pnpm format is main's, and Changesets/status fails on its own in three stack roots. ${String(first.plan.remedies)} fix runs once on main as a command, ${String(first.plan.asks)} question goes to you. Model runs: ${String(first.plan.runs)}.`,
        estimate: false,
        world: first.world,
        plan: first.plan,
        prompts: [],
        focus: [{ kind: "pull-request", number: 19 }],
      },
      {
        id: "tick-2",
        clock: "0:02",
        label: "Nothing changed",
        caption: `The next tick sees the same stack: ${String(second.plan.dispatches.length)} new dispatches, ${String(second.plan.runs)} model runs.`,
        estimate: false,
        world: second.world,
        plan: second.plan,
        prompts: [],
        focus: [],
      },
      {
        id: "answered",
        clock: "0:02",
        label: "You answer once",
        caption:
          "You drop Changesets/status from the lane's gate, since #29 removes the workflow. One rule change answers it for all eleven pull requests.",
        estimate: false,
        world: answered,
        plan: null,
        prompts: [],
        focus: [],
      },
      {
        id: "base-fixed",
        clock: "0:23",
        label: "Main fixed",
        caption: `The format fix's CI passed and you merged it (on Oct 22 a full run took 20.1 minutes, and verify 3.1). ${String(third.plan.asks)} question for the ${String(third.plan.dispatches.length)} pull requests based on main: rebase onto it.`,
        estimate: true,
        world: third.world,
        plan: third.plan,
        prompts: [
          restackQuestion(
            "main",
            open.map((pull) => pull.head),
          ),
        ],
        focus: open
          .filter((pull) => pull.base === "main")
          .map((pull) => ({ kind: "pull-request", number: pull.number })),
      },
      {
        id: "rebased",
        clock: "0:25",
        label: "Rebased",
        caption: `You agreed. The lane rebased ${String(open.length)} branches; the new heads are its own pushes, so ${String(fourth.plan.runs)} runs start. Each pull request now runs CI past format for the first time.`,
        estimate: true,
        world: fourth.world,
        plan: fourth.plan,
        prompts: [],
        focus: [],
      },
    ],
  };
}

function dragScenario(evidence: Evidence, knobs: Knobs): Scenario {
  const lane = polishLane(evidence.observedAt, knobs);
  const chat = evidence.sessions.find((session) => session.id === DRAGGED);

  const owned = evidence.pullRequests.filter(
    (pull) => pull.openedBy === DRAGGED && pull.state === "OPEN",
  );

  const before = { ...today(evidence), lanes: [lane] };
  const dragged = adopt(today(evidence), lane, owned, evidence.observedAt, "dragged");
  const first = tick(dragged, lane, knobs, null, observe(evidence, evidence.observedAt + MINUTE));
  const gated = withoutChangesets(lane);
  const answered = answer(first.world, gated, evidence.observedAt + 2 * MINUTE);
  const fixedSha = "f0r4a7a1n";
  const merged = withBase(first.world.observation, fixedSha, evidence.observedAt + 23 * MINUTE);
  const moved = tick(answered, gated, knobs, first.world.observation, merged);
  const numbers = new Set(owned.map((pull) => pull.number));
  const restacked = rebased(merged, fixedSha, numbers, evidence.observedAt + 24 * MINUTE);

  const pushed = tick(
    answer(moved.world, gated, evidence.observedAt + 24 * MINUTE),
    gated,
    knobs,
    moved.world.observation,
    restacked,
    new Set(owned.map((pull) => `${pull.headSha.slice(0, 7)}r`)),
  );

  const ready = tick(
    pushed.world,
    gated,
    knobs,
    pushed.world.observation,
    green(restacked, 19, evidence.observedAt + 44 * MINUTE),
  );

  const babysitters = owned.map((pull) => `lane:polish:babysit-${String(pull.number)}`);

  const trace: Trace[] = [
    { kind: "session", id: DRAGGED },
    ...owned.map((pull) => ({ kind: "pull-request", number: pull.number }) satisfies Trace),
  ];

  const runs = first.plan.runs + moved.plan.runs + pushed.plan.runs + ready.plan.runs;

  return {
    id: "drag",
    title: "Drag a running chat",
    summary: `Drag "${chat?.title ?? DRAGGED}" into Polish. It opened ${owned.map((pull) => `#${String(pull.number)}`).join(", ")}, all red at pnpm format. About 44 minutes later #19 is ready to merge if main's later jobs pass, and Opus never ran.`,
    steps: [
      {
        id: "before",
        clock: "before",
        label: "Before",
        caption: `The chat runs on ${chat?.models[0] ?? "?"} with ${String(Math.round((chat?.contextTokens ?? 0) / 1000))}k tokens of context, so waking it to watch CI re-reads all of it. Drag its row onto Polish.`,
        estimate: false,
        world: before,
        plan: null,
        prompts: [],
        focus: trace,
      },
      {
        id: "drag",
        clock: "0:00",
        label: "Drag",
        caption:
          "The chat joins the lane and keeps its transcript, model and folder. Its pull requests are linked, and each gets a babysitter on Sol that holds the branch's worktree.",
        estimate: false,
        world: dragged,
        plan: null,
        prompts: [
          dragNotice(lane, {
            session: DRAGGED,
            pulls: owned.map((pull) => pull.number),
            babysitters,
          }),
          ...owned.map((pull) =>
            babysitterBrief(lane, {
              number: pull.number,
              title: pull.title,
              branch: pull.head,
              worktree: `${WORKTREES}/${pull.head}`,
              author: DRAGGED,
            }),
          ),
        ],
        focus: trace,
      },
      {
        id: "tick",
        clock: "0:01",
        label: "First tick",
        caption: `${String(first.plan.dispatches.filter((dispatch) => dispatch.decision.kind === "route").length)} failures are not these pull requests' own. pnpm format is main's, fixed once there as a command with no model; Changesets/status is a policy, asked once.`,
        estimate: false,
        world: first.world,
        plan: first.plan,
        prompts: [],
        focus: [{ kind: "pull-request", number: 19 }],
      },
      {
        id: "answered",
        clock: "0:02",
        label: "You answer once",
        caption:
          "You drop Changesets/status from the gate. The format fix's pull request to main is open and running CI.",
        estimate: false,
        world: answered,
        plan: null,
        prompts: [],
        focus: [{ kind: "pull-request", number: 19 }],
      },
      {
        id: "merged",
        clock: "0:23",
        label: "Fix merged",
        caption:
          "Its CI passed (a full run took 20.1 minutes on Oct 22) and you merged it. #19's base moved, so the lane asks one question for the stack.",
        estimate: true,
        world: moved.world,
        plan: moved.plan,
        prompts: [
          restackQuestion(
            "main",
            owned.map((pull) => pull.head),
          ),
        ],
        focus: [{ kind: "pull-request", number: 19 }],
      },
      {
        id: "rebased",
        clock: "0:24",
        label: "Rebased",
        caption:
          "You agreed; the lane rebased its branches, keeping the old heads. #19 runs lint, typecheck, build and tests for the first time.",
        estimate: true,
        world: pushed.world,
        plan: pushed.plan,
        prompts: [],
        focus: [{ kind: "pull-request", number: 19 }],
      },
      {
        id: "ready",
        clock: "0:44",
        label: "Ready",
        caption: `#19 is green and asks you to merge. Model runs in the whole journey: ${String(runs)}. Limit: on Oct 22 main's unit tests failed on all three OSes; if they still do, that failure is main's too, one more dispatch to the keeper, and #19 waits on main, not on you.`,
        estimate: true,
        world: ready.world,
        plan: ready.plan,
        prompts: [],
        focus: [{ kind: "pull-request", number: 19 }],
      },
    ],
  };
}

function incidentScenario(evidence: Evidence): Scenario {
  const incident = evidence.incident;
  const shared = evidence.checkout.folder;
  const base = today(evidence);
  const writers = evidence.checkout.writersAtWipe;
  const started = incident.at - 97 * 1000;

  const sharedLeases = writers.map(
    (session) =>
      ({
        checkout: shared,
        session,
        since: started - MINUTE,
        until: null,
        via: "implicit",
      }) satisfies WriterLease,
  );

  const ownLeases = writers.map(
    (session) =>
      ({
        checkout: `${WORKTREES}/${session.slice(0, 8)}`,
        session,
        since: started - MINUTE,
        until: null,
        via: "isolated",
      }) satisfies WriterLease,
  );

  const wipe: CallFact = {
    session: incident.session,
    checkout: shared,
    at: incident.at,
    changed: true,
    snapshot: incident.after,
  };

  const ownWipe: CallFact = { ...wipe, checkout: `${WORKTREES}/${incident.session.slice(0, 8)}` };
  const kept = [incident.before, incident.after];

  const incidentWorld = (
    leases: readonly WriterLease[],
    calls: readonly CallFact[],
    at: number,
  ): World => ({ ...base, at, leases: [...base.leases, ...leases], calls, kept });

  const trace: Trace[] = writers.map((session) => ({ kind: "session", id: session }));
  const asked = incident.asked;

  return {
    id: "incident",
    title: "Oct 24, 18:31",
    summary: `A chat ran \`git checkout -- .\` in the shared checkout while ${String(writers.length)} chats had uncommitted work there.`,
    steps: [
      {
        id: "start",
        clock: "18:29:26",
        label: "Run starts",
        caption: `Run ${incident.run.slice(0, 8)} starts and takes its snapshot, ${incident.before.slice(0, 13)}. ${String(writers.length)} chats have their own uncommitted work in ${shared}; ${String(evidence.checkout.runningAtWipe.length)} are running.`,
        estimate: false,
        world: incidentWorld(sharedLeases, [], started),
        plan: null,
        prompts: [],
        focus: trace,
      },
      {
        id: "wipe",
        clock: "18:31:03",
        label: "The wipe",
        caption: `\`cd /tmp/t3code\` fails, the \`;\` chain runs on, and \`git checkout -- .\` reverts the shared tree. The tool runner records ${String(incident.recorded.paths)} changed paths and unattributed: ${String(incident.recorded.unattributed)}. This chat alone loses ${String(incident.lost.filter((file) => file.whole).length)} whole files and part of ${String(incident.lost.filter((file) => !file.whole).length)} more.`,
        estimate: false,
        world: incidentWorld(sharedLeases, [wipe], incident.at),
        plan: null,
        prompts: [],
        focus: [{ kind: "session", id: incident.session }],
      },
      {
        id: "by-hand",
        clock: "18:34",
        label: "Recovery by hand",
        caption: `${String(new Set(asked.map((ask) => ask.session)).size)} chats are told to redo their edits from their transcripts, then 7 to split patches by hand: ${String(asked.reduce((sum, ask) => sum + ask.runs, 0))} runs, $${asked.reduce((sum, ask) => sum + ask.costUsd, 0).toFixed(2)}, ${(asked.reduce((sum, ask) => sum + ask.minutes, 0) / 60).toFixed(1)} agent-hours.`,
        estimate: false,
        world: incidentWorld(sharedLeases, [wipe], incident.at + 35 * MINUTE),
        plan: null,
        prompts: [],
        focus: asked.map((ask) => ({ kind: "session", id: ask.session })),
      },
      {
        id: "in-a-lane",
        clock: "18:31:03",
        label: "Same command, in a lane",
        caption:
          "Each chat writes its own worktree. The same command reverts only 7af0e645's own worktree, the call is its writer's, and its after-snapshot is kept: the rule holds and nobody else loses anything.",
        estimate: false,
        world: incidentWorld(ownLeases, [ownWipe], incident.at),
        plan: null,
        prompts: [],
        focus: [{ kind: "session", id: incident.session }],
      },
      {
        id: "restore",
        clock: "18:31:10",
        label: "Restore",
        caption: `Restore from ${incident.before.slice(0, 13)}: ${String(incident.restored.filter((file) => file.differingLines === 0).length)} of ${String(incident.restored.length)} files equal today's tree, and the last differs only by an edit made 22 minutes later.`,
        estimate: false,
        world: incidentWorld(ownLeases, [ownWipe], incident.at + 7000),
        plan: null,
        prompts: [],
        focus: [{ kind: "session", id: incident.session }],
      },
    ],
  };
}

function todayScenario(evidence: Evidence, knobs: Knobs): Scenario {
  const lane = polishLane(evidence.observedAt, knobs);

  const attached = [
    { name: "principles-review", messages: 26 },
    { name: "review-principles", messages: 17 },
    { name: "clean-copy", messages: 5 },
    { name: "unslop", messages: 4 },
  ];

  return {
    id: "today",
    title: "Today",
    summary: "Everything in flight on this Mac now, before any lane exists.",
    steps: [
      {
        id: "now",
        clock: new Date(evidence.observedAt).toISOString().slice(11, 16),
        label: "Now",
        caption: "No lane yet. Every row is a chat, pull request or worktree from the export.",
        estimate: false,
        world: today(evidence),
        plan: null,
        prompts: [
          setupPrompt(lane.intent, attached, lane),
          workerBrief(
            lane,
            "Fix: the browser sign-in hint stretches its row on narrow windows.",
            `${WORKTREES}/browser-hint-width`,
            "browser-hint-width",
          ),
          reviewerBrief(lane, "The worker", `${WORKTREES}/browser-hint-width`, "1 file, +3/−1"),
        ],
        focus: [],
      },
    ],
  };
}

export function scenarios(evidence: Evidence, knobs: Knobs = DEFAULT_KNOBS): readonly Scenario[] {
  return [
    todayScenario(evidence, knobs),
    incidentScenario(evidence),
    stackScenario(evidence, knobs),
    dragScenario(evidence, knobs),
  ];
}

export const KEEPER_SESSION = KEEPER;

export const DRAGGED_SESSION = DRAGGED;
