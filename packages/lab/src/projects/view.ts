import { readyToMerge } from "./contract.ts";
import type { SessionFact, Trace, WorktreeFact } from "./evidence.ts";
import type { Dispatch, DesignedSession, PullObservation, Role, World } from "./lane.ts";

export type Status = "needs-you" | "failing" | "working" | "watching" | "ready" | "idle" | "merged";

export const STATUSES: readonly {
  readonly status: Status;
  readonly label: string;
  readonly rule: string;
}[] = [
  {
    status: "needs-you",
    label: "Needs you",
    rule: "a question waits for you: merge, rebase, a budget hit",
  },
  { status: "failing", label: "Failing", rule: "an own failure nothing is fixing" },
  { status: "working", label: "Working", rule: "a run is in progress" },
  {
    status: "watching",
    label: "Watching",
    rule: "a watch waits on CI or on a base fix, with no model running",
  },
  { status: "ready", label: "Ready", rule: "the gate passed, no open thread, mergeable" },
  { status: "idle", label: "Idle", rule: "uncommitted or unpushed work, nothing running" },
  { status: "merged", label: "Merged", rule: "done" },
];

export interface Link {
  readonly role: Role;
  readonly session: string;
  readonly title: string;
  readonly model: string | null;
  readonly running: boolean;
  readonly costUsd: number;
  readonly designed: boolean;
}

export interface Unit {
  readonly id: string;
  readonly kind: "pull-request" | "worktree" | "checkout" | "chat" | "base";
  readonly lane: string | null;
  readonly title: string;
  readonly status: Status;
  readonly why: string;
  readonly chain: readonly Link[];
  readonly checkout: {
    readonly path: string;
    readonly writers: readonly string[];
    readonly own: number;
    readonly copied: number;
    readonly unknown: number;
  } | null;
  readonly pull: {
    readonly number: number;
    readonly base: string;
    readonly failing: readonly string[];
    readonly routed: string | null;
  } | null;
  readonly dispatches: readonly Dispatch[];
  readonly spendUsd: number;
  readonly trace: readonly Trace[];
}

function sessionLink(world: World, role: Role, id: string): Link {
  const fact = world.sessions.find((session) => session.id === id);
  const designed = world.designed.find((session) => session.id === id);

  if (designed !== undefined) return designedLink(designed);

  return {
    role,
    session: id,
    title: fact?.title ?? id.slice(0, 8),
    model: fact?.models[0] ?? null,
    running: fact?.running ?? false,
    costUsd: fact?.costUsd ?? 0,
    designed: false,
  };
}

function designedLink(session: DesignedSession): Link {
  return {
    role: session.role,
    session: session.id,
    title: session.title,
    model: session.model,
    running: session.running,
    costUsd: session.costUsd,
    designed: true,
  };
}

function pending(world: World, dispatches: readonly Dispatch[]): Dispatch | undefined {
  return dispatches.findLast(
    (dispatch) => dispatch.decision.kind === "ask" && !world.answered.includes(dispatch.key),
  );
}

function pullUnit(world: World, pull: PullObservation): Unit {
  const link = world.links.find((candidate) => candidate.number === pull.number);
  const watch = world.pullRequestWatches.find((candidate) => candidate.number === pull.number);
  const lane = world.lanes.find((candidate) => candidate.id === watch?.lane);
  const gate = lane?.rules.pullRequest.gate ?? ["CI"];
  const dispatches = world.dispatches.filter((dispatch) => dispatch.event.pull === pull.number);

  const failing = pull.checks.filter(
    (check) => check.outcome === "failed" && gate.includes(check.workflow),
  );

  const routed = dispatches.findLast((dispatch) => dispatch.decision.kind === "route");

  const owned = dispatches.filter(
    (dispatch) => dispatch.decision.kind === "wake" || dispatch.decision.kind === "stop",
  );

  const chain = [
    ...(link === undefined ? [] : [sessionLink(world, "author", link.session)]),
    ...(watch === undefined ? [] : [sessionLink(world, "babysitter", watch.owner)]),
  ];

  const lease = world.leases.find(
    (candidate) => candidate.session === watch?.owner && candidate.until === null,
  );

  const question = pending(world, dispatches);
  const running = chain.some((entry) => entry.running && entry.role !== "author");

  const status: { readonly status: Status; readonly why: string } =
    pull.state === "MERGED"
      ? { status: "merged", why: "merged" }
      : question?.decision.kind === "ask"
        ? { status: "needs-you", why: question.decision.question }
        : failing.length > 0 && watch === undefined
          ? {
              status: "failing",
              why: `${failing.map((check) => `${check.workflow}/${check.name} at ${check.step ?? "?"}`).join(", ")}; nothing pullRequestWatches it`,
            }
          : owned.some((dispatch) => dispatch.decision.kind === "stop")
            ? { status: "failing", why: "its babysitter stopped" }
            : running
              ? { status: "working", why: "its babysitter is running" }
              : readyToMerge(pull, gate)
                ? { status: "ready", why: "every gate check passed" }
                : watch !== undefined
                  ? {
                      status: "watching",
                      why:
                        routed?.decision.kind === "route" && failing.length > 0
                          ? `waits on one fix on ${routed.decision.cause.split("@")[0] ?? "main"}`
                          : "waits for CI",
                    }
                  : { status: "idle", why: "open" };

  return {
    id: `pull-${String(pull.number)}`,
    kind: "pull-request",
    lane: watch?.lane ?? null,
    title: world.pullRequests.find((fact) => fact.number === pull.number)?.title ?? pull.head,
    ...status,
    chain,
    checkout:
      lease === undefined
        ? null
        : { path: lease.checkout, writers: [lease.session], own: 0, copied: 0, unknown: 0 },
    pull: {
      number: pull.number,
      base: pull.base,
      failing: failing.map((check) => `${check.workflow}/${check.name}`),
      routed: routed?.decision.kind === "route" ? routed.decision.cause : null,
    },
    dispatches,
    spendUsd:
      (watch?.spentUsd ?? 0) + dispatches.reduce((sum, dispatch) => sum + dispatch.costUsd, 0),
    trace: [
      { kind: "pull-request", number: pull.number },
      ...(link === undefined ? [] : [{ kind: "session", id: link.session } satisfies Trace]),
    ],
  };
}

function worktreeUnit(world: World, tree: WorktreeFact): Unit {
  const owner =
    tree.owner === null ? undefined : world.sessions.find((session) => session.id === tree.owner);

  const lease = world.leases.find(
    (candidate) => candidate.checkout === tree.path && candidate.until === null,
  );

  const chain = tree.owner === null ? [] : [sessionLink(world, "author", tree.owner)];

  const status: { readonly status: Status; readonly why: string } =
    owner?.running === true
      ? { status: "working", why: "its chat is running" }
      : tree.merged
        ? { status: "merged", why: "its branch is in origin/main" }
        : tree.owner === null
          ? { status: "idle", why: "no Nyte chat owns it" }
          : {
              status: "idle",
              why: `${String(tree.uncommitted.own.length)} own uncommitted files, ${String(tree.ahead)} commits ahead`,
            };

  return {
    id: `worktree-${tree.path}`,
    kind: "worktree",
    lane: world.memberships.find((membership) => membership.session === tree.owner)?.lane ?? null,
    title: tree.branch ?? tree.path.split("/").at(-1) ?? tree.path,
    ...status,
    chain,
    checkout: {
      path: tree.path,
      writers: lease === undefined ? [] : [lease.session],
      own: tree.uncommitted.own.length,
      copied: tree.uncommitted.copied.length,
      unknown: tree.uncommitted.unknown.length,
    },
    pull: null,
    dispatches: [],
    spendUsd: owner?.costUsd ?? 0,
    trace: [
      { kind: "worktree", path: tree.path },
      ...(tree.owner === null ? [] : [{ kind: "session", id: tree.owner } satisfies Trace]),
    ],
  };
}

function checkoutUnits(world: World, folder: string): readonly Unit[] {
  const writers = [
    ...new Set(
      world.leases
        .filter((lease) => lease.checkout === folder && lease.until === null)
        .map((lease) => lease.session),
    ),
  ];

  if (writers.length === 0) return [];
  const wiped = world.calls.find((call) => call.checkout === folder && call.changed);

  return [
    {
      id: `checkout-${folder}`,
      kind: "checkout",
      lane: null,
      title: folder.split("/").at(-1) ?? folder,
      status: writers.length > 1 ? "needs-you" : "idle",
      why:
        writers.length > 1
          ? `${String(writers.length)} chats hold uncommitted work in one checkout${wiped === undefined ? "" : "; one of them just changed every file"}`
          : "one writer",
      chain: writers.map((session) => sessionLink(world, "author", session)),
      checkout: { path: folder, writers, own: 0, copied: 0, unknown: 0 },
      pull: null,
      dispatches: [],
      spendUsd: 0,
      trace: writers.map((session) => ({ kind: "session", id: session })),
    },
  ];
}

function keeperUnits(world: World): readonly Unit[] {
  const keeper = world.designed.find((session) => session.role === "keeper");

  if (keeper === undefined) return [];

  const dispatches = world.dispatches.filter(
    (dispatch) => dispatch.owner === keeper.id && dispatch.event.pull === null,
  );

  const routed = world.dispatches.filter((dispatch) => dispatch.decision.kind === "route");
  const remedy = dispatches.findLast((dispatch) => dispatch.decision.kind === "remedy");

  const fixed = world.observation.bases.every((base) =>
    base.checks.every((check) => check.outcome !== "failed"),
  );

  if (routed.length === 0) return [];

  return [
    {
      id: "keeper",
      kind: "base",
      lane: world.lanes[0]?.id ?? null,
      title: keeper.title,
      status: remedy === undefined || fixed ? "idle" : "working",
      why: fixed
        ? "main passes the gate's format step"
        : remedy?.decision.kind === "remedy"
          ? remedy.decision.command
          : "nothing to fix",
      chain: [designedLink(keeper)],
      checkout: null,
      pull: null,
      dispatches,
      spendUsd: 0,
      trace: [
        ...new Set(
          routed.flatMap((dispatch) => (dispatch.event.pull === null ? [] : [dispatch.event.pull])),
        ),
      ].map((number) => ({ kind: "pull-request", number }) satisfies Trace),
    },
  ];
}

function runningUnits(world: World, covered: ReadonlySet<string>): readonly Unit[] {
  return world.sessions
    .filter((session) => session.running && !covered.has(session.id))
    .map((session: SessionFact) => ({
      id: `chat-${session.id}`,
      kind: "chat",
      lane: world.memberships.find((membership) => membership.session === session.id)?.lane ?? null,
      title: session.title ?? session.id.slice(0, 8),
      status: "working",
      why: `${session.models[0] ?? "a model"} is running`,
      chain: [sessionLink(world, session.parent === null ? "author" : "worker", session.id)],
      checkout: null,
      pull: null,
      dispatches: [],
      spendUsd: session.costUsd,
      trace: [{ kind: "session", id: session.id }],
    }));
}

export function deriveView(world: World, folder: string): readonly Unit[] {
  const pulls = world.observation.pulls.map((pull) => pullUnit(world, pull));
  const heads = new Set(world.observation.pulls.map((pull) => pull.head));

  const trees = world.worktrees
    .filter((tree) => tree.branch === null || !heads.has(tree.branch))
    .map((tree) => worktreeUnit(world, tree));

  const rows = [...keeperUnits(world), ...pulls, ...checkoutUnits(world, folder), ...trees];
  const covered = new Set(rows.flatMap((row) => row.chain.map((entry) => entry.session)));
  const order = STATUSES.map((entry) => entry.status);

  return [...rows, ...runningUnits(world, covered)].toSorted(
    (left, right) => order.indexOf(left.status) - order.indexOf(right.status),
  );
}
