import { create, props } from "@stylexjs/stylex";
import { useState, type ReactNode } from "react";
import { color } from "./tokens/color.stylex";

const REVISION = "8995cb24fcbd526d0a74111f6c33848a1af21b69";

const styles = create({
  page: {
    maxWidth: "92ch",
    marginInline: "auto",
    paddingBlock: "3em",
    paddingInline: "1.25em",
    color: color.textPrimary,
    backgroundColor: color.surfacePage,
    fontSize: "14px",
    lineHeight: 1.6,
  },
  title: { fontSize: "22px", fontWeight: color.weightSemibold, marginBlock: "0 0.25em" },
  lede: { color: color.textSecondary, marginBlock: 0 },
  section: { marginBlockStart: "3em" },
  h2: { fontSize: "16px", fontWeight: color.weightSemibold, marginBlock: "0 0.75em" },
  h3: { fontSize: "14px", fontWeight: color.weightSemibold, marginBlock: "1.75em 0.5em" },
  nav: { display: "flex", flexWrap: "wrap", gap: "0.25em 1em", marginBlockStart: "1.5em" },
  navLink: { color: color.textSecondary, textDecoration: "none" },
  pre: {
    fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace",
    fontSize: "12.5px",
    lineHeight: 1.55,
    padding: "1em",
    borderRadius: "8px",
    backgroundColor: color.surfaceWash,
    overflowX: "auto",
    whiteSpace: "pre",
  },
  code: { fontFamily: "ui-monospace, SFMono-Regular, Menlo, monospace", fontSize: "0.92em" },
  table: { borderCollapse: "collapse", width: "100%", display: "block", overflowX: "auto" },
  th: {
    textAlign: "start",
    fontWeight: color.weightMedium,
    color: color.textSecondary,
    padding: "0.4em 0.75em 0.4em 0",
    borderBlockEnd: `1px solid ${color.strokePrimary}`,
    whiteSpace: "nowrap",
  },
  td: {
    padding: "0.4em 0.75em 0.4em 0",
    borderBlockEnd: `1px solid ${color.strokeSecondary}`,
    verticalAlign: "top",
  },
  src: { color: color.textTertiary, fontSize: "12px", whiteSpace: "nowrap" },
  list: { paddingInlineStart: "1.25em", marginBlock: "0.5em" },
  term: { scrollMarginBlockStart: "1em" },
  quiz: { display: "grid", gap: "1.5em", marginBlockStart: "1em" },
  score: { color: color.textSecondary, fontVariantNumeric: "tabular-nums" },
  prompt: { marginBlock: "0 0.5em", fontWeight: color.weightMedium },
  choices: { display: "grid", gap: "0.375em" },
  choice: {
    textAlign: "start",
    padding: "0.5em 0.75em",
    minHeight: "2.5em",
    borderRadius: "6px",
    border: `1px solid ${color.strokeSecondary}`,
    backgroundColor: { default: "transparent", ":hover": color.stateHover },
    cursor: "pointer",
  },
  right: { borderColor: color.green500, backgroundColor: color.green30 },
  wrong: { borderColor: color.red500, backgroundColor: color.red30 },
  settled: { cursor: "default", backgroundColor: "transparent" },
  why: { marginBlock: "0.5em 0", color: color.textSecondary },
});

function Src(input: { readonly path: string; readonly line?: number; readonly end?: number }) {
  const name = input.path.split("/").at(-1) ?? input.path;
  const range = input.end === undefined ? "" : `-L${input.end}`;
  const anchor = input.line === undefined ? "" : `#L${input.line}${range}`;
  const label = input.line === undefined ? name : `${name}:${input.line}`;

  return (
    <a
      {...props(styles.src)}
      href={`https://github.com/interfaces-lab/nyte/blob/${REVISION}/packages/${input.path}${anchor}`}
    >
      {label}
    </a>
  );
}

function C(input: { readonly children: ReactNode }) {
  return <code {...props(styles.code)}>{input.children}</code>;
}

function Code(input: { readonly label: string; readonly children: string }) {
  return (
    <pre aria-label={input.label} {...props(styles.pre)}>
      {input.children}
    </pre>
  );
}

function Section(input: {
  readonly id: string;
  readonly title: string;
  readonly children: ReactNode;
}) {
  return (
    <section id={input.id} {...props(styles.section)}>
      <h2 {...props(styles.h2)}>{input.title}</h2>
      {input.children}
    </section>
  );
}

function Table(input: {
  readonly head: readonly string[];
  readonly rows: readonly (readonly ReactNode[])[];
}) {
  return (
    <table {...props(styles.table)}>
      <thead>
        <tr>
          {input.head.map((cell) => (
            <th key={cell} {...props(styles.th)}>
              {cell}
            </th>
          ))}
        </tr>
      </thead>
      <tbody>
        {input.rows.map((row, index) => (
          <tr key={index}>
            {row.map((cell, column) => (
              <td key={column} {...props(styles.td)}>
                {cell}
              </td>
            ))}
          </tr>
        ))}
      </tbody>
    </table>
  );
}

const K = "core/src/kernel";

const SECTIONS = [
  ["store", "Store"],
  ["refs", "Refs"],
  ["objects", "Objects"],
  ["loop", "The loop"],
  ["phases", "Phases"],
  ["admission", "Admission"],
  ["send", "One send"],
  ["respond", "respond"],
  ["tools", "tools"],
  ["stop", "Stop"],
  ["events", "Events out"],
  ["constants", "Constants"],
  ["functions", "Functions"],
  ["improve", "Not implemented"],
  ["quiz", "Quiz"],
] as const;

const REFS: readonly (readonly [string, string, string])[] = [
  ["refs/heads/<head>", "tip commit of a branch", "land, respond, tools, checkpoint, heads.move"],
  ["refs/runs/<head>", "current Run object", "land, every phase change, abort"],
  ["refs/inbox/<head>/<delivery>/tip", "newest submitted Change", "submit, redeliver"],
  ["refs/inbox/<head>/<delivery>/base", "last landed Change; pending = (base, tip]", "land"],
  ["refs/chains/<root>", "blob { attempts } shared by a delegated chain", "land (new), respond"],
  [
    "refs/effects/<run>/<call>",
    "one tool call's state",
    "openEffect … settleEffect, publishTools clears",
  ],
  ["refs/keys/<key>", "idempotency receipt → Change oid", "submit"],
  ["refs/cancelled/<change>", "tombstone for a pending Change", "cancel, redeliver"],
  ["refs/stacks/<head>", "parent head + base commit", "heads.create"],
  ["refs/compactions/<head>", "checkpoint work in progress", "startCompaction"],
  [
    "refs/delegations/<child>/<change>",
    "request sent to a child session",
    "delegation; land consumes it",
  ],
  ["refs/facts/<key>", "small session value", "facts, plugin storage"],
  ["refs/deleted", "session is being deleted", "sessions.delete"],
];

const PHASES: readonly (readonly ReactNode[])[] = [
  [
    <C key="p">none · done · failed · aborted</C>,
    <a key="f" href="#fn-landOrIdle">
      landOrIdle
    </a>,
    "land steer, then next",
    <C key="n">respond</C>,
  ],
  [
    <C key="p">respond</C>,
    <a key="f" href="#fn-respond">
      respond
    </a>,
    "land steer · reserve chain · turn.respond",
    <C key="n">tools · done · retry · failed · aborted</C>,
  ],
  [
    <C key="p">tools</C>,
    <a key="f" href="#fn-tools">
      tools
    </a>,
    "turn.tools → effects per call",
    <C key="n">respond · waiting · failed</C>,
  ],
  [
    <C key="p">waiting</C>,
    <a key="f" href="#fn-advance">
      advance
    </a>,
    "wake on signal, expiry, all results, abort, deadline",
    <C key="n">tools</C>,
  ],
  [
    <C key="p">retry</C>,
    <a key="f" href="#fn-advance">
      advance
    </a>,
    "sleep until phase.at (abort skips it)",
    <C key="n">respond</C>,
  ],
];

const ADMISSION: readonly (readonly string[])[] = [
  ["fresh", "wait", "start", "wait", "wait", "start (inherit)", "wait"],
  ["idle", "wait", "start", "settle", "wait", "start (inherit)", "wait"],
  ["live", "wait", "join*", "join*", "join*", "join*", "join*"],
  ["settling", "wait", "wait", "wait", "wait", "wait", "wait"],
];

const CONSTANTS: readonly (readonly ReactNode[])[] = [
  [
    <C key="c">DEFAULT_TTL_MS</C>,
    "30_000",
    "Head lease TTL for drive and step.",
    <Src key="s" path={`${K}/step.ts`} line={37} />,
  ],
  [
    <C key="c">ttlMs / 3</C>,
    "10_000",
    "withLeaseRenewal renews the lease during provider and tool calls.",
    <Src key="s" path={`${K}/lease.ts`} line={31} />,
  ],
  [
    <C key="c">fence</C>,
    "1, +1",
    "First acquire writes 1; each expired takeover adds 1. Release deletes the row, so the next acquire restarts at 1.",
    <Src key="s" path={`${K}/sqlite.ts`} line={766} />,
  ],
  [
    <C key="c">FLUSH_INTERVAL_MS</C>,
    "25",
    "Outbox batches deltas and progress before events.append.",
    <Src key="s" path={`${K}/outbox.ts`} line={4} />,
  ],
  [
    <C key="c">MAX_BATCH_SIZE</C>,
    "64",
    "Events per append. A full buffer makes emit await.",
    <Src key="s" path={`${K}/outbox.ts`} line={6} />,
  ],
  [
    <C key="c">MAX_SUBMIT_ATTEMPTS</C>,
    "1_000",
    "CAS retries for submit, cancel, and redeliver.",
    <Src key="s" path={`${K}/queue.ts`} line={18} />,
  ],
  [
    <C key="c">DEFAULT_RETRY_POLICY</C>,
    "3 · 1_000",
    "maxRetries, baseDelayMs. Delays 1 s, 2 s, 4 s, or retryAfterMs if larger.",
    <Src key="s" path={`${K}/turn.ts`} line={93} />,
  ],
  [
    <C key="c">reserveTokens</C>,
    "16_384",
    "Compact when context > contextWindow − 16_384.",
    <Src key="s" path={`${K}/compaction.ts`} line={69} />,
  ],
  [
    <C key="c">keepRecentTokens</C>,
    "20_000",
    "Recent context kept verbatim after a checkpoint.",
    <Src key="s" path={`${K}/compaction.ts`} line={70} />,
  ],
  [
    <C key="c">PAGE_SIZE</C>,
    "64",
    "Commits per objects.chain query in history walks.",
    <Src key="s" path={`${K}/graph.ts`} line={10} />,
  ],
  [
    <C key="c">MAX_WALK</C>,
    "10_000",
    "Commits walked to project a forward head move as commit events. Past it, or off the ancestry, a bare head_moved.",
    <Src key="s" path={`${K}/sdk/events.ts`} line={21} />,
  ],
  [
    <C key="c">effect.at + 1</C>,
    "1 ms",
    "Keeps each re-park a distinct oid.",
    <Src key="s" path={`${K}/effects.ts`} line={131} />,
  ],
  [
    <C key="c">RUNNER_RESTART_DELAY_MS</C>,
    "1_000",
    "Pause before restarting a runner loop that ended on a fault.",
    <Src key="s" path={`${K}/sdk/runner.ts`} line={37} />,
  ],
  [
    <C key="c">MAX_TIMER_DELAY_MS</C>,
    "2_147_483_647",
    "setTimeout ceiling (2³¹ − 1). driveAt re-arms past it.",
    <Src key="s" path={`${K}/sdk/runner.ts`} line={39} />,
  ],
  [
    <C key="c">untilLeaseReleased</C>,
    "5 ms",
    "Lease poll interval in runs.wait.",
    <Src key="s" path={`${K}/sdk/wait.ts`} line={23} />,
  ],
  [
    <C key="c">LEASE_MS</C>,
    "15_000",
    "Job lease TTL.",
    <Src key="s" path={`${K}/sdk/jobs.ts`} line={33} />,
  ],
  [
    <C key="c">drain</C>,
    '"one"',
    "Default batch.",
    <Src key="s" path={`${K}/sdk/nyte.ts`} line={134} />,
  ],
  [
    <C key="c">delivery</C>,
    '"next"',
    "Default for messages.send.",
    <Src key="s" path={`${K}/sdk/nyte.ts`} line={380} />,
  ],
  [
    <C key="c">replay</C>,
    '"never"',
    "Default when a tool declares none.",
    <Src key="s" path={`${K}/turn.ts`} line={721} />,
  ],
  [
    <C key="c">steps</C>,
    "undefined",
    "No step ceiling unless the agent sets steps.",
    <Src key="s" path={`${K}/step.ts`} line={706} />,
  ],
];

interface Improvement {
  readonly name: string;
  readonly path: string;
  readonly line: number;
  readonly why: string;
  readonly demo: string;
}

const IMPROVEMENTS: readonly Improvement[] = [
  {
    name: "wake",
    path: "sdk/runner.ts",
    line: 414,
    why: "If a host restarts within 30 s of a crash, drive returns busy on the dead owner's lease. Lease expiry writes no event, and wake has already cleared the parked deadline, so the run stays stuck.",
    demo: `- if (outcome.kind === "busy") return;
+ if (outcome.kind === "busy") {
+   driveAt(head, outcome.holder.expiresAt);
+   return;
+ }`,
  },
  {
    name: "advanceStep",
    path: "sdk/advance.ts",
    line: 85,
    why: "nyte.advance parks on a child that already answered. Only the runner calls delegation.recheck, so no signal follows.",
    demo: `- await input.recheckJobs(outcome.run.id);
+ await input.recheck(outcome.run.id);   // jobs + delegation, shared with wake`,
  },
  {
    name: "respond",
    path: "step.ts",
    line: 728,
    why: "Any lost CAS on chains/<root> fails the run as step ceiling, even at 3 of 50 attempts.",
    demo: `  if (reservation === "conflict") {
-   return endRun(context, { kind: "failed", failure: runnerFailure("step ceiling") }, "fail");
+   return { kind: "continue" };   // next step re-reads the chain
  }`,
  },
  {
    name: "executeToolCalls",
    path: "loop/agent-loop.ts",
    line: 188,
    why: "Dispose or relocation aborts the signal without abortRequested. Unstarted calls get no result, the batch publishes as complete, and those calls never run.",
    demo: `// runTools, turn.ts
+ if (messages.length < toolCalls.length && input.run.abortRequested !== true) {
+   return { kind: "conflict" };   // publish nothing; next step resumes
+ }`,
  },
  {
    name: "tools",
    path: "step.ts",
    line: 958,
    why: "The first park returns no until. advance.ts recomputes it; the runner arms driveAt only after one extra drive, triggered by its own run-ref event.",
    demo: `- return { kind: "waiting", run: next };
+ return waitingOutcome(next, await listEffects(context.session, next.id));`,
  },
  {
    name: "retrySchedule",
    path: "turn.ts",
    line: 698,
    why: "phase.at uses Date.now, but advance compares it against the step's injected now.",
    demo: `- return { at: Date.now() + delay, retries };
+ return { at: options.now + delay, retries };   // caller passes input.now`,
  },
  {
    name: "untilLeaseReleased",
    path: "sdk/wait.ts",
    line: 23,
    why: "A crashed holder costs ~6_000 lease reads before its 30 s TTL ends.",
    demo: `- const timer = setTimeout(finish, 5);
+ const timer = setTimeout(finish, Math.min(backoff *= 2, lease.expiresAt - Date.now()));`,
  },
  {
    name: "cancelledSet",
    path: "queue.ts",
    line: 290,
    why: "refs/cancelled/* is never deleted. Every land lists every tombstone in the session.",
    demo: `// land publish, step.ts:378
- ...changes.map((item) => ({ name: cancelledRef(item.oid), from: null, to: null })),
+ ...tombstones.map(({ name, oid }) => ({ name, from: oid, to: null })),
// cancel() then reports those as landed; decide that first`,
  },
  {
    name: "decide",
    path: "admission.ts",
    line: 52,
    why: "fresh and idle repeat ~40 lines. They differ only on passive.",
    demo: `if (head.kind === "settling") return WAIT;
if (head.kind === "live") return lead.kind === "none" ? WAIT : joinOrHandoff(head.run);
switch (lead.kind) {
  case "passive": return head.kind === "idle" ? { kind: "settle", run: head.last } : WAIT;
  case "user":    return START_USER;
  case "answer":  return startContinuation(lead.authorization);
  default:        return WAIT;
}`,
  },
  {
    name: "headFromRunRef",
    path: "sdk/runner.ts",
    line: 50,
    why: "refs/runs/ and refs/effects/ are redefined and parsed by hand in runner.ts, events.ts, and session-pool.ts.",
    demo: `// names.ts
+ export function parseRunRef(name: RefName): string | undefined
+ export function parseEffectRef(name: RefName): { runId: string; callId: string } | undefined`,
  },
  {
    name: "projectRef",
    path: "sdk/events.ts",
    line: 336,
    why: "Dead branch: it returns the same [] as the fallthrough.",
    demo: `- if (event.name.startsWith(KEY_PREFIX)) return [];
  return [];`,
  },
  {
    name: "clearEffects",
    path: "effects.ts",
    line: 366,
    why: "No production callers. Same for nextToLand, NextChange, and CHAIN_PREFIX.",
    demo: `- export async function clearEffects(…)     effects.ts:366
- export async function nextToLand(…)       queue.ts:523
- export interface NextChange               queue.ts:41
- export const CHAIN_PREFIX = CHAINS;       names.ts:193`,
  },
  {
    name: "Run.attempts",
    path: "model.ts",
    line: 100,
    why: "Documented as the step ceiling. The ceiling reads refs/chains/<root>; attempts keys deltas.",
    demo: `- /** Assistant responses attempted so far: the step ceiling and the delta key. */
+ /** Assistant responses attempted by this run. Keys deltas. The ceiling is refs/chains/<root>. */`,
  },
];

interface Term {
  readonly id: string;
  readonly path: string;
  readonly line: number;
  readonly does: ReactNode;
}

const FUNCTIONS: readonly Term[] = [
  {
    id: "loop",
    path: "sdk/runner.ts",
    line: 532,
    does: "One per session per host.",
  },
  {
    id: "handleRef",
    path: "sdk/runner.ts",
    line: 497,
    does: "Maps a ref name to a head (heads, inbox, runs, effects) and calls wake(head).",
  },
  {
    id: "wake",
    path: "sdk/runner.ts",
    line: 389,
    does: "Sets state.dirty. If no drive runs for the head, loops while dirty: drive once per pass.",
  },
  {
    id: "driveAt",
    path: "sdk/runner.ts",
    line: 445,
    does: "Timer for a parked deadline. Fires wake(head).",
  },
  {
    id: "reconcileRunner",
    path: "sdk/runner.ts",
    line: 619,
    does: "Starts, keeps, or stops the runner for a session. Serialized per session.",
  },
  {
    id: "requestAbortAtRef",
    path: "sdk/runner.ts",
    line: 667,
    does: "Writes a Run copy with abortRequested and revokes delegations in one CAS. Aborts the local drive.",
  },
  {
    id: "drive",
    path: "step.ts",
    line: 1124,
    does: "Acquires the head lease once, then renew → step until the outcome is not continue or retry.",
  },
  {
    id: "step",
    path: "step.ts",
    line: 1065,
    does: "One leased unit of work. Acquires a lease only when none is passed.",
  },
  {
    id: "runStep",
    path: "step.ts",
    line: 975,
    does: "beforeStep, finishCompaction, reads tip, run, and deleted, then advance.",
  },
  {
    id: "advance",
    path: "step.ts",
    line: 1017,
    does: "switch on run.phase.kind. Handles waiting and retry inline.",
  },
  {
    id: "landOrIdle",
    path: "step.ts",
    line: 386,
    does: "Tries land on steer, then next. Idle if both wait.",
  },
  {
    id: "land",
    path: "step.ts",
    line: 256,
    does: "Pending changes → batch → decide → commits → one publish of head, inbox base, run.",
  },
  {
    id: "respond",
    path: "step.ts",
    line: 667,
    does: "Lands steer, checks abort and ceiling, reserves the chain counter, calls turn.respond, publishes the assistant commit.",
  },
  {
    id: "tools",
    path: "step.ts",
    line: 888,
    does: "Calls turn.tools on the tip assistant message, then publishTools or parks the run.",
  },
  {
    id: "publish",
    path: "step.ts",
    line: 117,
    does: "refs.update with the lease plus an assertion that refs/deleted is absent.",
  },
  {
    id: "callTurn",
    path: "step.ts",
    line: 429,
    does: "Wraps a turn call: abort controller, outbox, withLeaseRenewal. LeaseLost → fenced.",
  },
  {
    id: "afterConflict",
    path: "step.ts",
    line: 486,
    does: 'A lost CAS: another run → fenced; abort raced → aborted, or tools · waiting kept ("interrupt"); tip moved → aborted ("superseded").',
  },
  {
    id: "endingPhase",
    path: "step.ts",
    line: 142,
    does: "Terminal phase of a flagged run is always aborted.",
  },
  { id: "headFor", path: "admission.ts", line: 44, does: "Run → fresh | idle | live | settling." },
  {
    id: "leadFor",
    path: "admission.ts",
    line: 194,
    does: "First non-passive change → user | report | answer (authorized or not). All passive → passive.",
  },
  {
    id: "decide",
    path: "admission.ts",
    line: 52,
    does: "Head × lead × agentChanged → wait | join | handoff | settle | start.",
  },
  {
    id: "nextBatch",
    path: "admission.ts",
    line: 168,
    does: 'drain "one": changes through the first user change.',
  },
  {
    id: "landsNow",
    path: "admission.ts",
    line: 247,
    does: "decide without writing. Used by runs.wait and relocation.",
  },
  {
    id: "submit",
    path: "queue.ts",
    line: 199,
    does: "Writes a Change, CASes the inbox tip and optional key ref. Retries on tip conflict.",
  },
  {
    id: "withLeaseRenewal",
    path: "lease.ts",
    line: 13,
    does: "Renews every ttlMs / 3 while the call runs. A failed renew aborts the call.",
  },
  {
    id: "createOutbox",
    path: "outbox.ts",
    line: 22,
    does: "Buffers deltas and progress; appends with the lease; a fenced append aborts the call.",
  },
  {
    id: "bindTurn",
    path: "turn.ts",
    line: 203,
    does: "Builds Turn { respond, tools } over agent-loop and durable effects.",
  },
  {
    id: "runTools",
    path: "turn.ts",
    line: 440,
    does: "Wraps tools in durableTools, runs executeToolCalls, returns complete | waiting | failed | fenced | conflict.",
  },
  {
    id: "durableTools",
    path: "turn.ts",
    line: 701,
    does: "Each tool.execute becomes openEffect → decideRecovery → execute | park | wake | reuse.",
  },
  {
    id: "decideRecovery",
    path: "effects.ts",
    line: 389,
    does: "Effect state → execute | interrupted | blocked | wake | reuse.",
  },
  {
    id: "generateAssistant",
    path: "loop/agent-loop.ts",
    line: 30,
    does: "Streams one assistant message from streamFn. Emits message_start, update, end.",
  },
  {
    id: "executeToolCalls",
    path: "loop/agent-loop.ts",
    line: 137,
    does: "Prepares calls in order, runs them concurrently, returns results in source order.",
  },
  {
    id: "advanceStep",
    path: "sdk/advance.ts",
    line: 10,
    does: "nyte.advance: one step with a watch that cancels on abort of its own run.",
  },
  {
    id: "waitForHead",
    path: "sdk/wait.ts",
    line: 33,
    does: "runs.wait: resolves idle or waiting once the lease is released and no event moved.",
  },
  {
    id: "watchSession",
    path: "sdk/watch.ts",
    line: 56,
    does: "nyte.watch: replays from afterSeq, projects each event, emits synced at the target seq.",
  },
  {
    id: "projectEvent",
    path: "sdk/events.ts",
    line: 342,
    does: "Kernel Event → SessionEvent[] (head_moved, text_delta, tool_progress, …).",
  },
];

interface Question {
  readonly prompt: ReactNode;
  readonly choices: readonly string[];
  readonly answer: number;
  readonly why: ReactNode;
}

const QUESTIONS: readonly Question[] = [
  {
    prompt: <>messages.send returns {'{ kind: "queued" }'}. What is published?</>,
    choices: [
      "A user commit at refs/heads/main",
      "A Change at refs/inbox/main/next/tip",
      "A Run at refs/runs/main",
      "Only an event",
    ],
    answer: 1,
    why: <>submit only moves the inbox tip. Commits and the run appear later, in land.</>,
  },
  {
    prompt: "Where does an idle runner wait for work?",
    choices: [
      "setInterval polling the run ref",
      "for await over session.events.watch in loop()",
      "The for (;;) in drive",
      "waitForHead",
    ],
    answer: 1,
    why: <>drive returns when the head is idle. The store wakes the watch after each ref commit.</>,
  },
  {
    prompt: 'A run is in respond. A message arrives with delivery "next". When does it land?',
    choices: [
      "Immediately, joining the run",
      "At the next respond boundary",
      "After the run is terminal, via landOrIdle",
      "Never; next is for idle sessions only",
    ],
    answer: 2,
    why: (
      <>
        respond lands only steer. landOrIdle, reached only with no run or a terminal run, tries
        steer then next.
      </>
    ),
  },
  {
    prompt: 'Same run, delivery "steer", same agent. What does decide return at the boundary?',
    choices: ["wait", "join", "handoff", "start"],
    answer: 1,
    why: (
      <>
        live × user → join. With a different agent it is handoff: the run ends done and the next
        step starts a new run.
      </>
    ),
  },
  {
    prompt: "drive returns finished. What makes the runner step again to land a queued message?",
    choices: [
      "drive loops on finished",
      "Its own run-ref event set state.dirty, so wake's while loop drives again",
      "A 1 s timer",
      "The client calls nyte.advance",
    ],
    answer: 1,
    why: <>handleRef sees refs/runs/main and calls wake while the drive is running.</>,
  },
  {
    prompt:
      "Host A's head lease expires mid-stream. Host B acquires it. A finishes and publishes. Result?",
    choices: ["ok, last writer wins", "conflict", "fenced", "A's write merges with B's"],
    answer: 2,
    why: (
      <>
        B holds fence + 1. refs.update matches owner and fence before any from, so A gets fenced and
        writes nothing.
      </>
    ),
  },
  {
    prompt: 'Why does every kernel publish include { name: "refs/deleted", from: null, to: null }?',
    choices: [
      "It clears a stale delete",
      "It asserts the session is not being deleted",
      "It bumps the event seq",
      "It releases the lease",
    ],
    answer: 1,
    why: (
      <>
        to === from is an assertion. Once sessions.delete writes refs/deleted, every runner publish
        conflicts.
      </>
    ),
  },
  {
    prompt:
      "The head is idle. A model change (passive config) is queued with no user message. decide returns?",
    choices: ["wait", "start", "settle", "join"],
    answer: 2,
    why: (
      <>
        idle × passive → settle. The config commit lands on the last run's id. No response is
        requested.
      </>
    ),
  },
  {
    prompt:
      "A tool without replay crashes between intent and result. The next step finds the intent. What happens?",
    choices: [
      "It runs again",
      "The call settles with an interrupted error",
      "The run parks",
      "The stored result is reused",
    ],
    answer: 1,
    why: (
      <>
        replay defaults to "never". decideRecovery(intent, never) → interrupted. Only "safe"
        executes again.
      </>
    ),
  },
  {
    prompt: "A run fails with rate_limit while phase.retries is already 3. Next phase?",
    choices: ["retry with 8 s delay", "retry with 4 s delay", "failed", "aborted"],
    answer: 2,
    why: <>maxRetries is 3. The three retries waited 1 s, 2 s, 4 s: baseDelayMs × 2^(n−1).</>,
  },
  {
    prompt: "A stop arrives during a retry backoff. What does advance do?",
    choices: [
      "Waits out phase.at, then aborts",
      "Calls respond now, which ends the run aborted",
      "Deletes the run ref",
      "Nothing until the lease expires",
    ],
    answer: 1,
    why: (
      <>
        abortLocalDrive cuts drive's sleep. The next advance sees abortRequested and calls respond,
        which ends the run aborted.
      </>
    ),
  },
  {
    prompt: "The run is flagged abortRequested, and turn.respond returns failed. Published phase?",
    choices: ["failed", "aborted, with the failure as a notice", "done", "retry"],
    answer: 1,
    why: (
      <>
        The flag moved refs/runs, so the respond publish conflicts. afterConflict stores aborted;
        noteOverriddenFailure appends the failure as an error notice.
      </>
    ),
  },
  {
    prompt:
      "contextWindow 200_000, context 190_000 tokens, default settings. Does respond compact first?",
    choices: [
      "No",
      "Yes: 190_000 > 183_616",
      "Only after an overflow error",
      "Only if keepRecentTokens is exceeded",
    ],
    answer: 1,
    why: <>shouldCompact: tokens &gt; contextWindow − reserveTokens (16_384).</>,
  },
  {
    prompt: "How many assistant responses can one run make by default?",
    choices: ["25", "50", "No ceiling unless the agent sets steps", "maxRetries + 1"],
    answer: 2,
    why: (
      <>
        steps resolves to agent.steps. Undefined skips the check. The counter lives in
        refs/chains/&lt;root&gt; so delegated continuations share it.
      </>
    ),
  },
  {
    prompt: "A host crashes mid-run and restarts 10 s later. What drives the run again today?",
    choices: [
      "The runner retries at the old lease's expiresAt",
      "Nothing until another ref event on that head",
      "runs.wait",
      "The 1 s runner restart delay",
    ],
    answer: 1,
    why: (
      <>
        The startup wake gets busy from the unexpired lease and returns. Lease expiry writes no
        event. See Improvements → wake.
      </>
    ),
  },
  {
    prompt:
      "Deltas stream during respond, then the final publish loses its CAS. Are the deltas in the log?",
    choices: [
      "No, the outbox discards them",
      "Yes; they are events keyed by runId and attempt, but no commit lands",
      "Yes, and they become a commit",
      "Only if the lease is still held",
    ],
    answer: 1,
    why: (
      <>
        Deltas go through events.append, separate from the respond publish. Clients must treat them
        as provisional until head_moved shows the commit.
      </>
    ),
  },
];

function Quiz() {
  const [picked, setPicked] = useState<ReadonlyMap<number, number>>(new Map());

  const correct = [...picked].filter(
    ([question, choice]) => QUESTIONS[question]?.answer === choice,
  ).length;

  return (
    <>
      <p {...props(styles.score)}>
        {correct} / {QUESTIONS.length}
      </p>
      <ol {...props(styles.quiz, styles.list)}>
        {QUESTIONS.map((question, index) => {
          const choice = picked.get(index);

          return (
            <li key={index}>
              <p {...props(styles.prompt)}>{question.prompt}</p>
              <div {...props(styles.choices)}>
                {question.choices.map((label, option) => (
                  <button
                    key={label}
                    type="button"
                    disabled={choice !== undefined}
                    onClick={() => setPicked(new Map(picked).set(index, option))}
                    {...props(
                      styles.choice,
                      choice !== undefined && styles.settled,
                      choice !== undefined && option === question.answer && styles.right,
                      choice === option && option !== question.answer && styles.wrong,
                    )}
                  >
                    {label}
                  </button>
                ))}
              </div>
              {choice === undefined ? null : <p {...props(styles.why)}>{question.why}</p>}
            </li>
          );
        })}
      </ol>
    </>
  );
}

export function CoreGuide() {
  return (
    <main {...props(styles.page)}>
      <h1 {...props(styles.title)}>Nyte core</h1>
      <p {...props(styles.lede)}>
        Each session is a git-like repository. Per head, one leased loop reads the run ref, runs one
        phase, and publishes it by CAS.
      </p>
      <nav aria-label="Contents" {...props(styles.nav)}>
        {SECTIONS.map(([id, title]) => (
          <a key={id} href={`#${id}`} {...props(styles.navLink)}>
            {title}
          </a>
        ))}
      </nav>

      <Section id="store" title="Store">
        <p>
          A session stores four things. Objects hold the data. Refs say which objects are current.
          Leases say which runner may write. Events record every change in order.{" "}
          <Src path={`${K}/store.ts`} />
        </p>
        <h3 {...props(styles.h3)}>One publish</h3>
        <ol {...props(styles.list)}>
          <li>
            The runner puts new objects. Each gets an oid from its content. No ref names them yet,
            so no reader sees them. <Src path={`${K}/hash.ts`} />
          </li>
          <li>
            It calls <C>refs.update</C> with its lease. A stale lease returns <C>fenced</C> before
            any ref is read. <Src path={`${K}/sqlite.ts`} line={653} />
          </li>
          <li>
            Every ref must still hold its <C>from</C>. One mismatch returns <C>conflict</C> and
            writes nothing.
          </li>
          <li>
            Each moved ref appends a <C>ref</C> event in the same transaction. Runners and clients
            watching the log wake on it.
          </li>
        </ol>
        <h3 {...props(styles.h3)}>Terms</h3>
        <Table
          head={["Term", "Meaning"]}
          rows={[
            ["object", "An immutable JSON value: commit, change, run, effect, stack, or blob."],
            [
              "oid",
              "An object's id: the SHA-256 hex of its body. Changing any field makes a new object.",
            ],
            [
              "body",
              "An object's stored JSON, with keys sorted and no whitespace (RFC 8785). Equal values produce equal bytes, so they hash alike.",
            ],
            ["ref", "A named pointer to an oid. Refs are the only state that changes."],
            [
              "CAS",
              <>
                Compare-and-swap. A ref moves to <C>to</C> only if it still holds <C>from</C>.
              </>,
            ],
            [
              "assertion",
              <>
                An update with <C>to === from</C>. It must match, and it writes nothing. Every
                runner publish asserts that <C>refs/deleted</C> is absent.
              </>,
            ],
            [
              "publish",
              <>
                A runner&apos;s <C>refs.update</C> that moves head or run refs. See{" "}
                <a href="#fn-publish">publish</a>.
              </>,
            ],
            ["lease", "An expiring lock on a head name. Only its holder runs that head."],
            [
              "fence",
              <>
                A counter raised on every lease takeover. Writes carrying an older fence return{" "}
                <C>fenced</C>.
              </>,
            ],
            ["seq", "An event's position in the session log, starting at 1."],
            [
              "cursor",
              <>
                The last seq a reader has seen, passed as <C>afterSeq</C>. Reads return events after
                it.
              </>,
            ],
            [
              "floor",
              <>
                The highest trimmed seq. A cursor below it throws <C>CursorExpired</C>.
              </>,
            ],
          ]}
        />
        <Code label="Session interface">{`Session                                                      store.ts
  objects  put(objects) → oids
  refs     update([{ name, from, to }], { reason, lease?, events? })
             → { ok, seq } | { conflict, name, actual } | { fenced }
  leases   acquire(name, ttlMs) → { ok, lease } | { holder } · renew · release
  events   append · read({ afterSeq }) · watch({ afterSeq }) · last · floor · trim`}</Code>
      </Section>

      <Section id="refs" title="Refs">
        <Table
          head={["Ref", "Holds", "Written by"]}
          rows={REFS.map(([name, holds, writer]) => [<C key="n">{name}</C>, holds, writer])}
        />
        <p>
          <C>&lt;delivery&gt;</C> is <C>steer</C> or <C>next</C>. The default head is <C>main</C>.{" "}
          <Src path={`${K}/names.ts`} />
        </p>
      </Section>

      <Section id="objects" title="Objects">
        <Code label="Object shapes">{`Change  { type: "change", kind: user | answer | passive | report,
          delivery: steer | next, previous: Oid | null, body, key?, author? }
Commit  { kind: "commit", parent, body: message | config | completion | checkpoint,
          run, change?, start?, calls?, outcome? }
Run     { kind: "run", id: "run_<12>", head, root, origin, phase,
          attempts, config, abortRequested?: true }
Effect  { kind: "effect", state: intent | waiting | expired | signal | result, … }

RunPhase  respond | tools | waiting | retry { at, retries, failure }
          | done | failed { failure } | aborted
terminal  done | failed | aborted                     isTerminalPhase`}</Code>
      </Section>

      <Section id="loop" title="The loop">
        <Code label="Runner loop nesting">{`loop()                                                  sdk/runner.ts:532
  for await (event of session.events.watch({ afterSeq: last }))
    handleRef(event) → wake(head)                         runner.ts:497

wake(head)                                              runner.ts:389
  state.dirty = true
  if state.running: return          ← the running pass will see dirty
  while (state.dirty)
    state.dirty = false
    outcome = drive(session, turn, optionsFor(head, signal))
    waiting + until → driveAt(head, until)              timer → wake

drive()                                                 step.ts:1124
  lease = leases.acquire("refs/heads/<head>", 30_000)   held → busy
  for (;;)
    leases.renew(lease)                                 lost → fenced
    outcome = step({ lease })
    continue → next pass
    retry    → sleep until outcome.at, next pass
    else     → return idle | waiting | finished | fenced
  finally leases.release(lease)

step() → runStep() → advance(run)                       step.ts:1065, 975, 1017
  switch run.phase.kind
    (none) done failed aborted → landOrIdle
    respond                    → respond
    tools                      → tools
    waiting                    → tools if woken, else waiting { until }
    retry                      → respond once phase.at ≤ now`}</Code>
        <h3 {...props(styles.h3)}>Two drivers</h3>
        <Table
          head={["Driver", "Used by", "Loop"]}
          rows={[
            [
              <a key="d" href="#fn-wake">
                runner
              </a>,
              "Desktop, TUI: a host that attaches a session",
              "events.watch → wake → drive until rest",
            ],
            [
              <a key="d" href="#fn-advanceStep">
                nyte.advance
              </a>,
              "Serverless workflows",
              "One step. Returns idle | continue | finished | fenced | retry { at } | waiting { until } | busy { until }. The caller schedules the next.",
            ],
          ]}
        />
      </Section>

      <Section id="phases" title="Phases">
        <Table head={["Phase", "Handler", "Work", "Next"]} rows={PHASES} />
        <p>
          Run and head writes go through <a href="#fn-publish">publish</a>. Effect writes call
          refs.update with the lease only.
        </p>
      </Section>

      <Section id="admission" title="Admission">
        <Code label="Admission pipeline">{`land(delivery)                                          step.ts:256
  queued   = pendingIn(head, delivery)        (base, tip] minus refs/cancelled/*
  batch    = nextBatch(queued, drain)         "one": through the first user change
             boundaryBatch at respond          tip awaits an answer → cut at first
                                               change that is not answer or report
  decision = decide(headFor(run), leadFor(batch), agentChanged(run, batch))`}</Code>
        <Table
          head={["head \\ lead", "none", "user", "passive", "report", "answer ✓", "answer ✗"]}
          rows={ADMISSION}
        />
        <ul {...props(styles.list)}>
          <li>
            <C>fresh</C>: no run. <C>idle</C>: terminal run. <C>live</C>: running. <C>settling</C>:
            running with <C>abortRequested</C>.
          </li>
          <li>
            <C>join*</C>: <C>handoff</C> when the batch names another agent. Handoff ends the run{" "}
            <C>done</C>; the next pass starts a new one.
          </li>
          <li>
            <C>answer ✓</C>: a child's answer with a matching delegation. It starts a continuation
            that inherits the chain counter.
          </li>
          <li>
            <C>live</C> only occurs at a respond boundary, and that boundary lands only <C>steer</C>
            . <C>next</C> waits for an idle head.
          </li>
        </ul>
      </Section>

      <Section id="send" title="One send">
        <Code label="Message send trace">{`messages.send({ content })                               sdk/nyte.ts:375
  submit                                                  queue.ts:199
    put Change { kind: user, delivery: next, previous: tip }
    CAS  inbox/main/next/tip   tip → change
         keys/<key>            null → change              when key is set
  reconcileRunner              not awaited

ref event → handleRef → wake("main") → drive → step → landOrIdle
  land(next): decide(fresh, user) = start                 "land"
    CAS  heads/main            tip → user commit { start: run }
         inbox/main/next/base  base → change
         runs/main             null → Run { phase: respond, attempts: 0 }
         chains/<run>          null → { attempts: 0 }
         cancelled/<change>    null = null
         deleted               null = null
  → continue

step → respond
  CAS  chains/<run>            { 0 } → { 1 }              "reserve response"
  turn.respond                 deltas → outbox → events.append
  CAS  heads/main              → assistant commit         "respond"
       runs/main               → Run { phase: tools, attempts: 1 }

step → tools
  per call   effects/<run>/<call>   null → intent → result
  CAS  heads/main              → tool-result commits      "tools"
       runs/main               → Run { phase: respond }
       effects/<run>/*         → null

step → respond … stopReason "stop" → Run { phase: done } → finished
wake: dirty → drive → landOrIdle → idle`}</Code>
      </Section>

      <Section id="respond" title="respond">
        <Code label="respond steps">{`respond(context)                                         step.ts:667
  land(steer, boundary)            a joining message returns continue
  abortRequested                   → endRun(aborted)
  last message not user/toolResult → endRun(done)
  resolveConfig changed            → store Run, continue
  chain.attempts ≥ steps           → endRun(failed "step ceiling")
  CAS chains/<root> +1             conflict → failed "step ceiling"
  callTurn(turn.respond)           withLeaseRenewal + outbox
  checkpoint                       → publishCheckpoint, continue
  publish assistant commit + next phase`}</Code>
        <Table
          head={["stopReason", "Outcome", "Phase"]}
          rows={[
            [
              <C key="s">toolUse · stop · pending · deferred</C>,
              "tools if any toolCall, else complete",
              <C key="p">tools · done</C>,
            ],
            [
              <C key="s">length</C>,
              "tools if any toolCall, each failed as truncated; else complete",
              <C key="p">tools · done</C>,
            ],
            [
              <C key="s">error</C>,
              "overflow → checkpoint; retryable and retries < 3 → retry; else failed",
              <C key="p">retry · failed</C>,
            ],
            [<C key="s">aborted</C>, "", <C key="p">aborted</C>],
          ]}
        />
        <p>
          Retryable classes: <C>rate_limit</C>, <C>overloaded</C>, <C>network</C>.{" "}
          <Src path="ai/src/utils/failure.ts" line={265} />
        </p>
        <h3 {...props(styles.h3)}>Compaction</h3>
        <Code label="Compaction lifecycle">{`turn.respond                                             turn.ts:243
  threshold  tokens > contextWindow − 16_384  → checkpoint before generating
  overflow   error response is context overflow → checkpoint replaces it
  startCompaction      compactions/<head>  null → record
  step                 publishCheckpoint: heads → checkpoint commit, compaction cleared

runStep, and step's finally                              step.ts:983, 1086
  finishCompaction     clears a leftover record; false → fenced
contextCommits         reads back to the newest checkpoint only      graph.ts:80`}</Code>
      </Section>

      <Section id="tools" title="tools">
        <Code label="Durable tool execution">{`executeToolCalls                                   loop/agent-loop.ts:137
  prepare in source order: find tool, validate args, before_tool hook
  run prepared calls concurrently
  results in source order

durableTools.execute(call)                          turn.ts:701
  openEffect      effects/<run>/<call>  null → intent { tool, args, replay }
  decideRecovery  → execute | interrupted | blocked | wake | reuse
  execute         tool.execute; throws ToolWait → parkEffect → waiting
  settleEffect    intent|waiting|signal|expired → result

after a wake, tools runs every call again
  result → reuse · signal|expired → wake · waiting → blocked
  publishTools clears effects/<run>/* only when its CAS wins`}</Code>
        <Table
          head={["Effect state", "decideRecovery", "Meaning"]}
          rows={[
            [<C key="s">intent, safe</C>, "execute", ""],
            [<C key="s">intent, never</C>, "interrupted", "Settle as an error. May have run once."],
            [
              <C key="s">waiting</C>,
              "blocked",
              "Stay parked. Deadline passed → expireEffect → wake.",
            ],
            [<C key="s">signal · expired</C>, "wake", "tool.wake(call, { reply | expired })."],
            [<C key="s">result</C>, "reuse", "Return the stored result. Never runs twice."],
          ]}
        />
        <p>
          <C>runs.reply</C> calls <C>signalEffect</C> without a lease. <C>waitId</C> must equal the
          current waiting oid, so a stale reply cannot answer a re-park. The CAS on that oid gives
          racing replies one winner. <Src path={`${K}/effects.ts`} line={266} />
        </p>
      </Section>

      <Section id="stop" title="Stop">
        <Code label="Abort path">{`runs.abort({ runId? }) → { kind: "requested", runId }    sdk/nyte.ts:500
  requestAbortAtRef                                        runner.ts:667
    CAS  runs/<head>  Run → { …Run, abortRequested: true }   no lease
         + revokeDelegations(run)
    abortLocalDrive → controller.abort()
  jobs.interruptOwned(runId)

in-flight publish            conflicts: the flag moved runs/<head>
  afterConflict              → aborted, output kept          step.ts:486
                               tools · waiting keep phase ("interrupt")
later steps
  respond                    abortRequested → endRun(aborted)
  endingPhase                terminal phase → aborted       step.ts:142
  headFor                    live → settling; admission waits`}</Code>
        <p>
          The run is terminal once <C>refs/runs/&lt;head&gt;</C> shows <C>aborted</C>. A tool that
          ignores its signal keeps running; the lease keeps renewing until it returns.
        </p>
      </Section>

      <Section id="events" title="Events out">
        <Code label="Event path to clients">{`turn emit
  createOutbox        25 ms or 64 events per append; progress coalesces per call
  events.append({ lease })        fenced → abort the call
store commit → wake watchers

nyte.watch({ afterSeq })                                   sdk/watch.ts:56
  events.watch(afterSeq)
  projectEvent(event)             one kernel event → 0..n SessionEvents
  { kind: "synced" }              after the seq that was last at subscribe
client
  snapshot + fold events; CursorExpired → snapshot again`}</Code>
        <p>
          Every <C>nyte.watch</C> opens its own durable watch and projects independently.
        </p>
      </Section>

      <Section id="constants" title="Constants">
        <Table head={["Name", "Value", "Governs", "Source"]} rows={CONSTANTS} />
      </Section>

      <Section id="functions" title="Functions">
        <Table
          head={["Function", "Does", "Source"]}
          rows={FUNCTIONS.map((term) => [
            <span key="n" id={`fn-${term.id}`} {...props(styles.term)}>
              <C>{term.id}</C>
            </span>,
            term.does,
            <Src key="s" path={`${K}/${term.path}`} line={term.line} />,
          ])}
        />
      </Section>

      <Section id="improve" title="Not implemented">
        {IMPROVEMENTS.map((item) => (
          <div key={`${item.name}-${item.line}`}>
            <h3 {...props(styles.h3)}>
              <C>{item.name}</C> <Src path={`${K}/${item.path}`} line={item.line} />
            </h3>
            <p>{item.why}</p>
            <Code label={`${item.name} fix`}>{item.demo}</Code>
          </div>
        ))}
      </Section>

      <Section id="quiz" title="Quiz">
        <Quiz />
      </Section>
    </main>
  );
}
