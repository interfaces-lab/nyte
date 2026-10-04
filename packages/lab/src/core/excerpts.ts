/**
 * Verbatim source, read at `REVISION` in `source.ts`. Line numbers are that
 * commit's; re-read an excerpt whenever the revision moves. Common leading
 * indentation is removed.
 */
export interface Excerpt {
  readonly path: string;
  readonly line: number;
  readonly code: string;
}

export const EXCERPTS = {
  publish: {
    path: "core/src/kernel/step.ts",
    line: 117,
    code: `async function publish(
  session: Session,
  options: {
    readonly lease: Lease;
    readonly updates: readonly RefUpdate[];
    readonly reason: string;
  },
): Promise<PublishOutcome> {
  const outcome = await session.refs.update(
    [...options.updates, { name: DELETED_REF, from: null, to: null }],
    { lease: options.lease, reason: options.reason },
  );

  return outcome.ok ? "ok" : outcome.reason;
}`,
  },
  endingPhase: {
    path: "core/src/kernel/step.ts",
    line: 133,
    code: `function withPhase(run: Run, phase: RunPhase, attempts = run.attempts): Run {
  return { ...run, phase: endingPhase(run, phase), attempts };
}

/**
 * A stop is one-way: a flagged run can end only \`aborted\`, whatever its last
 * step found, so the queue never reads a stopped run as open. Every phase a
 * step publishes passes through here.
 */
function endingPhase(run: Run, phase: RunPhase): RunPhase {
  return run.abortRequested === true && isTerminalPhase(phase) ? { kind: "aborted" } : phase;
}`,
  },
  drive: {
    path: "core/src/kernel/step.ts",
    line: 1119,
    code: `/**
 * Steps until the head rests. A cancelled drive answers \`continue\` as soon as
 * its step does: the signal that cancelled one call must not cancel the calls
 * of the work that follows, so the runner drives again with a fresh one.
 */
export async function drive(
  session: Session,
  turn: Turn,
  options: Omit<StepOptions, "lease">,
): Promise<StepOutcome> {
  const ttlMs = options.ttlMs ?? DEFAULT_TTL_MS;
  const acquired = await session.leases.acquire(headRef(options.head), ttlMs);

  if (!acquired.ok) return { kind: "busy", holder: acquired.holder };
  const lease = acquired.lease;

  try {
    for (;;) {
      if (!(await session.leases.renew(lease, ttlMs))) return { kind: "fenced" };
      const outcome = await step(session, turn, { ...options, lease });

      if (outcome.kind === "continue") {
        if (options.signal?.aborted === true) return outcome;
        continue;
      }

      if (outcome.kind === "retry") {
        if (!(await waitUntil(outcome.at, options.now ?? Date.now, options.signal))) return outcome;
        continue;
      }

      return outcome;
    }
  } finally {
    await session.leases.release(lease);
  }
}`,
  },
  advance: {
    path: "core/src/kernel/step.ts",
    line: 1017,
    code: `async function advance(base: Omit<StepContext, "run">, run: Run | undefined): Promise<StepOutcome> {
  if (run === undefined) return landOrIdle(base, run);
  const context: StepContext = { ...base, run };

  switch (run.phase.kind) {
    case "done":
    case "failed":
    case "aborted":
      return landOrIdle(base, run);
    case "respond":
      return respond(context);
    case "tools":
      return tools(context);
    case "waiting": {
      const views = await listEffects(context.session, run.id);
      const now = context.now();

      const deadlines = views.flatMap((view) =>
        view.effect.state === "waiting" && view.effect.until !== undefined
          ? [view.effect.until]
          : [],
      );

      const wake =
        run.abortRequested === true ||
        waitingBatchReady(views) ||
        deadlines.some((until) => until <= now);

      if (wake) return tools(context);

      return deadlines.length === 0
        ? { kind: "waiting", run }
        : { kind: "waiting", run, until: Math.min(...deadlines) };
    }

    case "retry":
      // A stop does not wait out the backoff; the boundary ends the run at once.
      return run.abortRequested !== true && context.now() < run.phase.at
        ? { kind: "retry", run, at: run.phase.at }
        : respond(context);
    default: {
      const _exhaustive: never = run.phase;

      return _exhaustive;
    }
  }
}`,
  },
  refs: {
    path: "core/src/kernel/store.ts",
    line: 70,
    code: `export interface Refs {
  /** \`null\` when the ref does not exist. */
  read(name: RefName): Promise<Oid | null>;
  /** Every ref whose name starts with \`prefix\`, sorted by name. */
  list(prefix: string): Promise<readonly { readonly name: RefName; readonly oid: Oid }[]>;
  /**
   * All updates apply or none do. A \`to\` of \`null\` deletes the ref. An update
   * whose \`to\` equals \`from\` is an assertion: it must hold, and it writes no
   * row and no event.
   */
  update(updates: readonly RefUpdate[], options: RefUpdateOptions): Promise<RefUpdateOutcome>;
}

export interface Leases {
  /** Takes the name if free or expired; a takeover increments the fence. Losing is a value. */
  acquire(name: string, ttlMs: number): Promise<LeaseOutcome>;
  /** Extends only this holder's lease, matched on owner and fence, ignoring expiry. */
  renew(lease: Lease, ttlMs: number): Promise<boolean>;
  /** Releases only this holder's lease. A successor's row never matches. */
  release(lease: Lease): Promise<boolean>;
  /** The live, unexpired lease on a name, if any. */
  read(name: string): Promise<Lease | undefined>;
}`,
  },
  objects: {
    path: "core/src/kernel/model.ts",
    line: 68,
    code: `/** A submission waiting to land: a commit body without a parent yet. */
export interface Change {
  readonly type: "change";
  readonly kind: "user" | "answer" | "passive" | "report";
  readonly delivery: Delivery;
  /** The change submitted before this one in the same delivery; null starts the chain. */
  readonly previous: Oid | null;
  /** The change this one replaced when its delivery changed. Keeps the copy's id distinct from the original's. */
  readonly supersedes?: Oid;
  readonly body: ChangeBody;
  readonly at: number;
  readonly author?: Actor;
  /**
   * The idempotency key the submission carried. \`refs/keys/<key>\` answers a
   * retry; this copy follows the change into its commit so the sender can
   * recognize its own message by identity after the fact. Correlation only.
   */
  readonly key?: string;
}

export type RunConfig = BranchConfig;

/** One head being advanced. The run ref holds the current phase; every phase is a new object. */
export interface Run {
  readonly kind: "run";
  readonly id: RunId;
  /** Branch name, not ref name. */
  readonly head: string;
  readonly origin: RunOrigin;
  readonly root: RunId;
  readonly phase: RunPhase;
  readonly startedAt: number;
  /** Assistant responses attempted so far: the step ceiling and the delta key. */
  readonly attempts: number;
  /** Branch inputs with the runner's resolved model and thinking defaults captured at start. */
  readonly config: RunConfig;
  /** Set by a participant; the runner honors it at its next publish. */
  readonly abortRequested?: true;
}`,
  },
  toolWait: {
    path: "core/src/kernel/loop/types.ts",
    line: 278,
    code: `export type ToolWaitOptions =
  | { readonly selection: Selection; readonly until?: number }
  | { readonly selection?: Selection; readonly until: number };

const BACKGROUND_WAIT: unique symbol = Symbol("nyte.toolWait.background");

/** Kernel-only: a wait with nothing to ask and no deadline, woken by the runner itself. */
export interface BackgroundWait {
  readonly [BACKGROUND_WAIT]: true;
}

export const backgroundWait: BackgroundWait = { [BACKGROUND_WAIT]: true };

type WaitOptions = ToolWaitOptions | BackgroundWait;`,
  },
  hookBudgets: {
    path: "core/src/plugins/hooks.ts",
    line: 195,
    code: `/**
 * Wall-clock budget per handler. Compaction is a provider request and gets
 * the room one takes; the rest are process-local decisions.
 */
export type HookBudgets = Readonly<Record<HookName, number>>;

export const HOOK_BUDGETS_MS: HookBudgets = {
  transform_context: 5_000,
  before_compaction: 300_000,
  before_request: 5_000,
  before_tool: 5_000,
  after_tool: 5_000,
};`,
  },
  runPhase: {
    path: "protocol/src/kernel.ts",
    line: 236,
    code: `export type RunPhase =
  | { readonly kind: "respond" }
  | { readonly kind: "tools" }
  | { readonly kind: "waiting" }
  | {
      readonly kind: "retry";
      readonly at: number;
      readonly retries: number;
      readonly failure: Failure;
    }
  | { readonly kind: "done" }
  | { readonly kind: "aborted" }
  | { readonly kind: "failed"; readonly failure: Failure };`,
  },
  requestAbortAtRef: {
    path: "core/src/kernel/sdk/runner.ts",
    line: 667,
    code: `const requestAbortAtRef = async (
  pooled: Pooled,
  name: RefName,
  expectedRunId?: string,
): Promise<string | undefined> => {
  const { session } = pooled;

  for (;;) {
    const oid = await session.refs.read(name);

    if (oid === null) return undefined;
    const run = await runAtRef(session, oid);

    if (
      run === undefined ||
      (expectedRunId !== undefined && run.id !== expectedRunId) ||
      isTerminalPhase(run.phase)
    )
      return undefined;
    const head = headFromRunRef(name);

    if (run.abortRequested === true) {
      if (head !== undefined) abortLocalDrive(pooled, head, run.id);

      return run.id;
    }

    const next: Run = { ...run, abortRequested: true };
    const written = (await session.objects.put([next]))[0];

    if (written === undefined) throw new Error(\`Writing abort for \${name} returned no oid\`);

    const outcome = await session.refs.update(
      [...(await revokeDelegations(session, run.id)), { name, from: oid, to: written }],
      attributed({ reason: "abort" }, options.actor),
    );

    if (outcome.ok) {
      if (head !== undefined) abortLocalDrive(pooled, head, run.id);

      return run.id;
    }

    switch (outcome.reason) {
      case "conflict":
        continue;
      case "fenced":
        throw new Error(\`Participant abort was unexpectedly fenced: \${name}\`);
      default: {
        const _exhaustive: never = outcome;

        return _exhaustive;
      }
    }
  }`,
  },
} satisfies Record<string, Excerpt>;
