/** Reference tables. Every line number is read at `REVISION` in `source.ts`. */
import type { ReactNode } from "react";
import { C, Codes, To } from "./ui";

export const REFS: readonly (readonly [string, string, string])[] = [
  [
    "refs/heads/<head>",
    "Tip commit of a branch. Absent means unborn.",
    "land, respond, tools, checkpoint; heads.create, move, delete, fast-forward",
  ],
  [
    "refs/stacks/<head>",
    "Where the branch sits: its parent head and base commit.",
    "heads.create, restack, merge, delete",
  ],
  ["refs/inbox/<head>/<delivery>/tip", "Newest submitted Change.", "submit, redeliver"],
  ["refs/inbox/<head>/<delivery>/base", "Last landed Change. Pending is (base, tip].", "land"],
  [
    "refs/runs/<head>",
    "The head's current Run. Every phase is a new object.",
    "land, every phase change, config resolution, abort",
  ],
  [
    "refs/chains/<root>",
    "Blob { attempts }, the response budget one delegated chain shares.",
    "land opens it, respond reserves",
  ],
  [
    "refs/compactions/<head>",
    "Checkpoint work in progress, fenced by the head lease.",
    "startCompaction; cleared by the checkpoint or finishCompaction",
  ],
  [
    "refs/effects/<run>/<call>",
    "One tool call's durable state.",
    "openEffect through settleEffect; publishTools clears",
  ],
  ["refs/jobs/<job>", "A command job, its output, and what it still owes the head.", "jobs"],
  [
    "refs/delegations/<child>/<change>",
    "A request sent to a child, and whether its answer landed.",
    "delegation; land consumes it, Stop revokes it",
  ],
  ["refs/keys/<key>", "Idempotency receipt: the Change a key produced.", "submit"],
  [
    "refs/cancelled/<change>",
    "Tombstone for a pending Change that was withdrawn.",
    "cancel, redeliver",
  ],
  ["refs/facts/<key>", "A small session value.", "facts, plugin storage"],
  ["refs/deleted", "The session is being deleted.", "sessions.delete"],
];

export const ADMISSION: readonly (readonly string[])[] = [
  ["fresh", "wait", "start", "wait", "wait", "start, inherit", "wait"],
  ["idle", "wait", "start", "settle", "wait", "start, inherit", "wait"],
  ["live", "wait", "join*", "join*", "join*", "join*", "join*"],
  ["settling", "wait", "wait", "wait", "wait", "wait", "wait"],
];

export const PHASES: readonly (readonly ReactNode[])[] = [
  [
    <Codes key="0" items={["none", "done", "failed", "aborted"]} />,
    <To key="1" href="#fn-landOrIdle">
      landOrIdle
    </To>,
    <>
      Land <C>steer</C>, then <C>next</C>.
    </>,
    <C key="3">respond</C>,
  ],
  [
    <C key="0">respond</C>,
    <To key="1" href="#fn-respond">
      respond
    </To>,
    <>
      Land <C>steer</C> at the boundary, reserve a response, call <C>turn.respond</C>. Resolving
      config or landing a checkpoint keeps the phase.
    </>,
    <Codes key="3" items={["respond", "tools", "done", "retry", "failed", "aborted"]} />,
  ],
  [
    <C key="0">tools</C>,
    <To key="1" href="#fn-tools">
      tools
    </To>,
    <>
      <C>turn.tools</C>, one effect ref per call.
    </>,
    <Codes key="3" items={["respond", "waiting", "failed"]} />,
  ],
  [
    <C key="0">waiting</C>,
    <To key="1" href="#fn-advance">
      advance
    </To>,
    "Wake on a reply, an expiry, a full batch of results, a stop, or a passed deadline.",
    <C key="3">tools</C>,
  ],
  [
    <C key="0">retry</C>,
    <To key="1" href="#fn-advance">
      advance
    </To>,
    <>
      Sleep until <C>phase.at</C>. A stop skips the wait.
    </>,
    <C key="3">respond</C>,
  ],
];

interface Constant {
  readonly name: string;
  readonly value: string;
  readonly governs: string;
  readonly path: string;
  readonly line: number;
  readonly root?: string;
}

export const CONSTANTS: readonly Constant[] = [
  {
    name: "DEFAULT_TTL_MS",
    value: "30_000",
    governs: "Head lease TTL for `drive` and `step`.",
    path: "step.ts",
    line: 37,
  },
  {
    name: "ttlMs / 3",
    value: "10_000",
    governs: "How often `withLeaseRenewal` renews during a provider or tool call.",
    path: "lease.ts",
    line: 31,
  },
  {
    name: "fence",
    value: "1, +1",
    governs:
      "A fresh acquire writes 1; each expired takeover adds 1. Release deletes the row, so the next acquire starts at 1 again.",
    path: "sqlite.ts",
    line: 766,
  },
  {
    name: "FLUSH_INTERVAL_MS",
    value: "25",
    governs: "How long the outbox batches deltas and progress before `events.append`.",
    path: "outbox.ts",
    line: 4,
  },
  {
    name: "MAX_BATCH_SIZE",
    value: "64",
    governs: "Events per append. A full buffer makes `emit` wait.",
    path: "outbox.ts",
    line: 6,
  },
  {
    name: "MAX_SUBMIT_ATTEMPTS",
    value: "1_000",
    governs: "CAS attempts for `submit`, `cancel` and `redeliver` before they throw.",
    path: "queue.ts",
    line: 18,
  },
  {
    name: "DEFAULT_RETRY_POLICY",
    value: "3 · 1_000",
    governs:
      "`maxRetries` and `baseDelayMs`. Delays of 1 s, 2 s and 4 s, or `retryAfterMs` when longer.",
    path: "turn.ts",
    line: 92,
  },
  {
    name: "reserveTokens",
    value: "16_384",
    governs: "Checkpoint when the context passes `contextWindow − 16_384`.",
    path: "compaction.ts",
    line: 69,
  },
  {
    name: "keepRecentTokens",
    value: "20_000",
    governs: "Recent context a checkpoint keeps verbatim.",
    path: "compaction.ts",
    line: 70,
  },
  {
    name: "PAGE_SIZE",
    value: "64",
    governs: "Commits per `objects.chain` query in a history walk.",
    path: "graph.ts",
    line: 10,
  },
  {
    name: "MAX_WALK",
    value: "10_000",
    governs:
      "Commits walked to project a forward head move as commit events. Past it, or off the ancestry, a bare `head_moved`.",
    path: "sdk/events.ts",
    line: 21,
  },
  {
    name: "effect.at + 1",
    value: "1 ms",
    governs: "Keeps each re-park a distinct oid.",
    path: "effects.ts",
    line: 131,
  },
  {
    name: "RUNNER_RESTART_DELAY_MS",
    value: "1_000",
    governs: "Pause before restarting a runner loop that ended on a fault.",
    path: "sdk/runner.ts",
    line: 37,
  },
  {
    name: "MAX_TIMER_DELAY_MS",
    value: "2_147_483_647",
    governs: "The `setTimeout` ceiling, 2³¹ − 1. `driveAt` re-arms past it.",
    path: "sdk/runner.ts",
    line: 39,
  },
  {
    name: "untilLeaseReleased",
    value: "5 ms",
    governs: "Lease poll interval in `runs.wait`.",
    path: "sdk/wait.ts",
    line: 23,
  },
  { name: "LEASE_MS", value: "15_000", governs: "Job lease TTL.", path: "sdk/jobs.ts", line: 33 },
  {
    name: "PLUGIN_CALL_BUDGET_MS",
    value: "5_000",
    governs: "Budget for a plugin command or event listener.",
    path: "sdk/activation.ts",
    line: 62,
  },
  {
    name: "HOOK_BUDGETS_MS",
    value: "5_000",
    governs:
      "Budget per hook handler. `before_compaction` gets 300_000, the room one provider request takes.",
    path: "hooks.ts",
    line: 201,
    root: "core/src/plugins",
  },
  {
    name: "budgetMs",
    value: "5_000",
    governs: "Budget for a plugin's `session()` factory and for each disposer.",
    path: "host.ts",
    line: 102,
    root: "core/src/plugins",
  },
  {
    name: "drain",
    value: '"one"',
    governs: "Default batch: through the first user change.",
    path: "sdk/nyte.ts",
    line: 134,
  },
  {
    name: "delivery",
    value: '"next"',
    governs: "Default for `messages.send`.",
    path: "sdk/nyte.ts",
    line: 380,
  },
  {
    name: "replay",
    value: '"never"',
    governs: "Default when a tool declares none.",
    path: "turn.ts",
    line: 720,
  },
  {
    name: "steps",
    value: "undefined",
    governs: "No response ceiling unless the agent sets `steps`.",
    path: "step.ts",
    line: 706,
  },
];

interface Term {
  readonly id: string;
  readonly path: string;
  readonly line: number;
  readonly does: string;
}

export const FUNCTION_GROUPS: readonly {
  readonly title: string;
  readonly terms: readonly Term[];
}[] = [
  {
    title: "Runner",
    terms: [
      {
        id: "loop",
        path: "sdk/runner.ts",
        line: 532,
        does: "One per attached session per host. Wakes every head once, then watches ref events.",
      },
      {
        id: "handleRef",
        path: "sdk/runner.ts",
        line: 497,
        does: "Maps a ref name to a head (heads, inbox, runs, effects) and calls `wake`.",
      },
      {
        id: "wake",
        path: "sdk/runner.ts",
        line: 389,
        does: "Marks the head dirty. Without a drive in progress, drives while it stays dirty.",
      },
      {
        id: "driveAt",
        path: "sdk/runner.ts",
        line: 445,
        does: "A timer for a parked deadline. Fires `wake`.",
      },
      {
        id: "reconcileRunner",
        path: "sdk/runner.ts",
        line: 619,
        does: "Starts, keeps, or stops a session's runner. Serialized per session.",
      },
      {
        id: "requestAbortAtRef",
        path: "sdk/runner.ts",
        line: 667,
        does: "Writes the run with `abortRequested` and revokes its delegations in one CAS, then aborts the local drive.",
      },
      {
        id: "advanceStep",
        path: "sdk/advance.ts",
        line: 10,
        does: "`nyte.advance`. One step, watching for a stop of its own run.",
      },
    ],
  },
  {
    title: "Step",
    terms: [
      {
        id: "drive",
        path: "step.ts",
        line: 1124,
        does: "Takes the head lease once, then renews and steps until the outcome is not `continue` or `retry`.",
      },
      {
        id: "step",
        path: "step.ts",
        line: 1065,
        does: "One leased unit of work. Takes a lease only when none is passed.",
      },
      {
        id: "runStep",
        path: "step.ts",
        line: 975,
        does: "`beforeStep`, `finishCompaction`, reads the tip, the run and `refs/deleted`, then `advance`.",
      },
      {
        id: "advance",
        path: "step.ts",
        line: 1017,
        does: "Switches on the run's phase. Decides `waiting` and `retry` inline.",
      },
      {
        id: "landOrIdle",
        path: "step.ts",
        line: 386,
        does: "Tries `land` on `steer`, then `next`. Idle when both wait.",
      },
      {
        id: "land",
        path: "step.ts",
        line: 256,
        does: "`join`, `settle` and `start` commit the batch and publish head, base and run. `wait` publishes nothing; `handoff` ends the run and leaves the batch.",
      },
      {
        id: "respond",
        path: "step.ts",
        line: 667,
        does: "Lands `steer`, checks the stop and the ceiling, reserves a response, calls `turn.respond`, publishes the message.",
      },
      {
        id: "tools",
        path: "step.ts",
        line: 888,
        does: "Calls `turn.tools` on the tip's assistant message, then publishes the results or parks the run.",
      },
      {
        id: "publish",
        path: "step.ts",
        line: 117,
        does: "`refs.update` with the lease and an assertion that `refs/deleted` is absent.",
      },
      {
        id: "callTurn",
        path: "step.ts",
        line: 429,
        does: "Wraps a turn call in an abort controller, the outbox and lease renewal. `LeaseLost` becomes `fenced`.",
      },
      {
        id: "afterConflict",
        path: "step.ts",
        line: 486,
        does: "Reads what a lost CAS lost to and ends, keeps or continues the run.",
      },
      {
        id: "endingPhase",
        path: "step.ts",
        line: 142,
        does: "A flagged run's terminal phase is always `aborted`.",
      },
    ],
  },
  {
    title: "Admission and queue",
    terms: [
      {
        id: "headFor",
        path: "admission.ts",
        line: 44,
        does: "`Run` to `fresh`, `idle`, `live` or `settling`.",
      },
      {
        id: "leadFor",
        path: "admission.ts",
        line: 194,
        does: "The first non-passive change: `user`, `report`, or `answer`, authorized or not. All passive is `passive`.",
      },
      {
        id: "decide",
        path: "admission.ts",
        line: 52,
        does: "Head, lead and agent change to `wait`, `join`, `handoff`, `settle` or `start`.",
      },
      {
        id: "nextBatch",
        path: "admission.ts",
        line: 168,
        does: 'With `drain: "one"`, the changes through the first user change.',
      },
      {
        id: "landsNow",
        path: "admission.ts",
        line: 247,
        does: "`decide` without writing, for `runs.wait` and relocation.",
      },
      {
        id: "submit",
        path: "queue.ts",
        line: 199,
        does: "Writes a `Change` and moves the inbox tip, with the key ref when given. Retries a lost tip race.",
      },
    ],
  },
  {
    title: "Turn",
    terms: [
      {
        id: "bindTurn",
        path: "turn.ts",
        line: 202,
        does: "Builds `Turn { respond, tools }` over the agent loop and durable effects.",
      },
      {
        id: "runTools",
        path: "turn.ts",
        line: 439,
        does: "Runs `executeToolCalls` over durable tools. Answers `complete`, `waiting`, `failed`, `fenced` or `conflict`.",
      },
      {
        id: "durableTools",
        path: "turn.ts",
        line: 700,
        does: "Each `tool.execute` becomes `openEffect`, then execute, park, wake or reuse by `decideRecovery`.",
      },
      {
        id: "decideRecovery",
        path: "effects.ts",
        line: 389,
        does: "Effect state to `execute`, `interrupted`, `blocked`, `wake` or `reuse`.",
      },
      {
        id: "generateAssistant",
        path: "loop/agent-loop.ts",
        line: 30,
        does: "Streams one assistant message from the provider.",
      },
      {
        id: "executeToolCalls",
        path: "loop/agent-loop.ts",
        line: 137,
        does: "Prepares calls in order, runs them concurrently, returns results in source order.",
      },
      {
        id: "withLeaseRenewal",
        path: "lease.ts",
        line: 13,
        does: "Renews every `ttlMs / 3` while a call runs. A failed renew aborts the call.",
      },
      {
        id: "createOutbox",
        path: "outbox.ts",
        line: 22,
        does: "Buffers deltas and progress, appends them with the lease, aborts the call when fenced.",
      },
    ],
  },
  {
    title: "Clients",
    terms: [
      {
        id: "waitForHead",
        path: "sdk/wait.ts",
        line: 33,
        does: "`runs.wait`. Resolves `idle` or `waiting` once the lease is released and no event moved.",
      },
      {
        id: "watchSession",
        path: "sdk/watch.ts",
        line: 56,
        does: "`nyte.watch`. Replays from `afterSeq`, projects each event, sends `synced` at the target seq.",
      },
      {
        id: "projectEvent",
        path: "sdk/events.ts",
        line: 342,
        does: "One kernel event to zero or more `SessionEvent`s.",
      },
    ],
  },
];
