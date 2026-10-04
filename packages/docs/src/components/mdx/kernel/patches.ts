export interface Patch {
  readonly path: string;
  readonly patch: string;
  readonly preludes: readonly { readonly before: string; readonly after: string }[];
}

export const PATCHES = {
  advanceStep: [
    {
      path: "core/src/kernel/sdk/advance.ts",
      patch: `@@ -12,7 +12,8 @@ export async function advanceStep(input: {
   readonly turn: Turn;
   readonly options: StepOptions;
   readonly readRun: () => Promise<Run | undefined>;
-  readonly recheckJobs: (runId: string) => Promise<void>;
+  /** Jobs and delegations, as the runner's wake rechecks them after a park. */
+  readonly recheck: (runId: string) => Promise<void>;
   readonly onRef: (event: Extract<Event, { readonly kind: "ref" }>) => Promise<void>;
 }): Promise<AdvanceOutcome> {
   input.options.signal?.throwIfAborted();
@@ -82,7 +83,7 @@ export async function advanceStep(input: {
       case "retry":
         return { kind: "retry", at: outcome.at };
       case "waiting": {
-        await input.recheckJobs(outcome.run.id);
+        await input.recheck(outcome.run.id);
         const effects = await listEffects(input.session, outcome.run.id);
         const current = await input.readRun();
 `,
      preludes: [
        {
          before: `export async function advanceStep(input: {
  readonly session: Session;`,
          after: `export async function advanceStep(input: {
  readonly session: Session;`,
        },
        {
          before: `export async function advanceStep(input: {
  readonly session: Session;
  readonly turn: Turn;
  readonly options: StepOptions;
  readonly readRun: () => Promise<Run | undefined>;
  readonly recheckJobs: (runId: string) => Promise<void>;
  readonly onRef: (event: Extract<Event, { readonly kind: "ref" }>) => Promise<void>;
}): Promise<AdvanceOutcome> {
  input.options.signal?.throwIfAborted();
  const controller = new AbortController();
  const stopWatching = new AbortController();

  const signal =
    input.options.signal === undefined
      ? controller.signal
      : AbortSignal.any([controller.signal, input.options.signal]);

  const watchSignal = AbortSignal.any([signal, stopWatching.signal]);
  let runId: string | undefined;
  let watchFailure: unknown;

  const inspect = async (): Promise<void> => {
    if (runId === undefined) return;
    const current = await input.readRun();

    if (current?.id === runId && current.abortRequested === true) controller.abort();
  };

  const afterSeq = await input.session.events.last();

  const watching = (async () => {
    for await (const event of input.session.events.watch({ afterSeq, signal: watchSignal })) {
      if (event.kind !== "ref") continue;
      await input.onRef(event);

      if (event.name === runRef(input.options.head)) await inspect();
    }
  })().catch((cause: unknown) => {
    if (watchSignal.aborted) return;
    watchFailure = cause;
    controller.abort();
  });

  const turn: Turn = {
    respond: async (invocation) => {
      runId = invocation.run.id;
      // A stop can arrive between the step's read and entering the turn.
      await inspect();

      return input.turn.respond(invocation);
    },
    tools: async (invocation) => {
      runId = invocation.run.id;
      await inspect();

      return input.turn.tools(invocation);
    },
  };

  try {
    const outcome = await step(input.session, turn, { ...input.options, signal });

    if (watchFailure !== undefined) throw watchFailure;

    switch (outcome.kind) {
      case "idle":
      case "continue":
      case "finished":
      case "fenced":
        return { kind: outcome.kind };
      case "busy":
        return { kind: "busy", until: outcome.holder.expiresAt };`,
          after: `export async function advanceStep(input: {
  readonly session: Session;
  readonly turn: Turn;
  readonly options: StepOptions;
  readonly readRun: () => Promise<Run | undefined>;
  /** Jobs and delegations, as the runner's wake rechecks them after a park. */
  readonly recheck: (runId: string) => Promise<void>;
  readonly onRef: (event: Extract<Event, { readonly kind: "ref" }>) => Promise<void>;
}): Promise<AdvanceOutcome> {
  input.options.signal?.throwIfAborted();
  const controller = new AbortController();
  const stopWatching = new AbortController();

  const signal =
    input.options.signal === undefined
      ? controller.signal
      : AbortSignal.any([controller.signal, input.options.signal]);

  const watchSignal = AbortSignal.any([signal, stopWatching.signal]);
  let runId: string | undefined;
  let watchFailure: unknown;

  const inspect = async (): Promise<void> => {
    if (runId === undefined) return;
    const current = await input.readRun();

    if (current?.id === runId && current.abortRequested === true) controller.abort();
  };

  const afterSeq = await input.session.events.last();

  const watching = (async () => {
    for await (const event of input.session.events.watch({ afterSeq, signal: watchSignal })) {
      if (event.kind !== "ref") continue;
      await input.onRef(event);

      if (event.name === runRef(input.options.head)) await inspect();
    }
  })().catch((cause: unknown) => {
    if (watchSignal.aborted) return;
    watchFailure = cause;
    controller.abort();
  });

  const turn: Turn = {
    respond: async (invocation) => {
      runId = invocation.run.id;
      // A stop can arrive between the step's read and entering the turn.
      await inspect();

      return input.turn.respond(invocation);
    },
    tools: async (invocation) => {
      runId = invocation.run.id;
      await inspect();

      return input.turn.tools(invocation);
    },
  };

  try {
    const outcome = await step(input.session, turn, { ...input.options, signal });

    if (watchFailure !== undefined) throw watchFailure;

    switch (outcome.kind) {
      case "idle":
      case "continue":
      case "finished":
      case "fenced":
        return { kind: outcome.kind };
      case "busy":
        return { kind: "busy", until: outcome.holder.expiresAt };`,
        },
      ],
    },
    {
      path: "core/src/kernel/sdk/runner.ts",
      patch: `@@ -339,7 +339,10 @@ export function createRunners(input: {
           turn: prepared.turn,
           options: prepared.optionsFor(head, signal),
           readRun: async () => (await pool.readRun(pooled.session, head))?.run,
-          recheckJobs: (runId) => input.jobsFor(request.sessionId, pooled).recheck(runId),
+          recheck: async (runId) => {
+            await input.jobsFor(request.sessionId, pooled).recheck(runId);
+            await input.delegation.recheck(request.sessionId, pooled, runId);
+          },
           onRef: async (event) => {
             await handleSessionRef(request.sessionId, pooled, event);
           },`,
      preludes: [
        {
          before: `  const advance: Nyte["advance"] = async (request) => {
    pool.alive();
    const head = request.head ?? MAIN;
    validateHeadName(head);
    const controller = new AbortController();

    const signal = AbortSignal.any([
      controller.signal,
      stopAdvances.signal,
      ...(request.signal === undefined ? [] : [request.signal]),
    ]);

    const { promise: done, resolve: finish } = Promise.withResolvers<void>();

    const task = (async () => {
      signal.throwIfAborted();
      const pooled = await pool.open(request.sessionId);
      const activation = await pool.activationFor(request.sessionId, pooled);

      if (activation === undefined) throw new Error("Session is not active in this host");

      if (pooled.parent !== undefined) {
        const parent = await pool.open(pooled.parent.sessionId);
        await input.jobsFor(pooled.parent.sessionId, parent).recover();
        await input.delegation.childRunChanged(request.sessionId, pooled);
      }

      await input.jobsFor(request.sessionId, pooled).recover();
      signal.throwIfAborted();
      const active = advances.get(pooled) ?? new Set<ActiveAdvance>();
      advances.set(pooled, active);
      const execution = { controller, done };
      active.add(execution);
      pooled.runnerTasks.add(done);

      try {
        const prepared = prepareExecution(request.sessionId, pooled, activation);

        return await advanceStep({
          session: pooled.session,`,
          after: `  const advance: Nyte["advance"] = async (request) => {
    pool.alive();
    const head = request.head ?? MAIN;
    validateHeadName(head);
    const controller = new AbortController();

    const signal = AbortSignal.any([
      controller.signal,
      stopAdvances.signal,
      ...(request.signal === undefined ? [] : [request.signal]),
    ]);

    const { promise: done, resolve: finish } = Promise.withResolvers<void>();

    const task = (async () => {
      signal.throwIfAborted();
      const pooled = await pool.open(request.sessionId);
      const activation = await pool.activationFor(request.sessionId, pooled);

      if (activation === undefined) throw new Error("Session is not active in this host");

      if (pooled.parent !== undefined) {
        const parent = await pool.open(pooled.parent.sessionId);
        await input.jobsFor(pooled.parent.sessionId, parent).recover();
        await input.delegation.childRunChanged(request.sessionId, pooled);
      }

      await input.jobsFor(request.sessionId, pooled).recover();
      signal.throwIfAborted();
      const active = advances.get(pooled) ?? new Set<ActiveAdvance>();
      advances.set(pooled, active);
      const execution = { controller, done };
      active.add(execution);
      pooled.runnerTasks.add(done);

      try {
        const prepared = prepareExecution(request.sessionId, pooled, activation);

        return await advanceStep({
          session: pooled.session,`,
        },
      ],
    },
  ],
  respond: [
    {
      path: "core/src/kernel/step.ts",
      patch: `@@ -725,9 +725,9 @@ async function respond(context: StepContext): Promise<StepOutcome> {
 
   if (reservation === "fenced") return { kind: "fenced" };
 
-  if (reservation === "conflict") {
-    return endRun(context, { kind: "failed", failure: runnerFailure("step ceiling") }, "fail");
-  }
+  // Another continuation of the chain moved the counter. The next step
+  // re-reads it and applies the ceiling to the real count.
+  if (reservation === "conflict") return { kind: "continue" };
 
   const called = await callTurn(context, false, (emit, signal) =>
     context.turn.respond({`,
      preludes: [
        {
          before: `async function respond(context: StepContext): Promise<StepOutcome> {
  const answering = context.options.drain === "one" && (await awaitingAnswer(context));

  const landed = await land(context, {
    delivery: "steer",
    run: context.run,
    boundary: { awaitingAnswer: answering },
  });

  if (landed.kind !== "idle") return landed;

  if (context.run.abortRequested === true) {
    return endRun(context, { kind: "aborted" }, "abort");
  }

  const commits = await contextCommits(context.session.objects, context.tip);
  const messages = contextMessages(commits.map((entry) => entry.commit));
  const last = messages[messages.length - 1];

  if (last === undefined || (last.role !== "user" && last.role !== "toolResult")) {
    return endRun(context, { kind: "done" }, "done");
  }

  // Older runs have only declared inputs. A successor may also lack the
  // recorded model. Publish the inputs this host will actually use first.
  const config = context.options.resolveConfig?.(context.run.config);

  if (config !== undefined) {
    const resolved = { ...context.run, config };

    if (hashObject(resolved) !== context.runOid) {
      const outcome = await storeRun(context, resolved, "resolve config");

      return outcome.kind === "finished" ? { kind: "continue" } : outcome;
    }
  }

  const chain = await readChain(context.session, context.run.root);

  const ceiling = isStepCeilingResolver(context.options.steps)
    ? context.options.steps(context.run)
    : context.options.steps;

  if (ceiling !== undefined && chain.attempts >= ceiling) {
    return endRun(context, { kind: "failed", failure: runnerFailure("step ceiling") }, "fail");
  }

  const [counter] = await context.session.objects.put([
    { kind: "blob", value: { attempts: chain.attempts + 1 } },
  ]);

  if (counter === undefined) throw new Error("Chain counter write returned no object");

  const reservation = await publish(context.session, {
    lease: context.lease,
    updates: [{ name: chainRef(context.run.root), from: chain.oid, to: counter }],
    reason: "reserve response",
  });`,
          after: `async function respond(context: StepContext): Promise<StepOutcome> {
  const answering = context.options.drain === "one" && (await awaitingAnswer(context));

  const landed = await land(context, {
    delivery: "steer",
    run: context.run,
    boundary: { awaitingAnswer: answering },
  });

  if (landed.kind !== "idle") return landed;

  if (context.run.abortRequested === true) {
    return endRun(context, { kind: "aborted" }, "abort");
  }

  const commits = await contextCommits(context.session.objects, context.tip);
  const messages = contextMessages(commits.map((entry) => entry.commit));
  const last = messages[messages.length - 1];

  if (last === undefined || (last.role !== "user" && last.role !== "toolResult")) {
    return endRun(context, { kind: "done" }, "done");
  }

  // Older runs have only declared inputs. A successor may also lack the
  // recorded model. Publish the inputs this host will actually use first.
  const config = context.options.resolveConfig?.(context.run.config);

  if (config !== undefined) {
    const resolved = { ...context.run, config };

    if (hashObject(resolved) !== context.runOid) {
      const outcome = await storeRun(context, resolved, "resolve config");

      return outcome.kind === "finished" ? { kind: "continue" } : outcome;
    }
  }

  const chain = await readChain(context.session, context.run.root);

  const ceiling = isStepCeilingResolver(context.options.steps)
    ? context.options.steps(context.run)
    : context.options.steps;

  if (ceiling !== undefined && chain.attempts >= ceiling) {
    return endRun(context, { kind: "failed", failure: runnerFailure("step ceiling") }, "fail");
  }

  const [counter] = await context.session.objects.put([
    { kind: "blob", value: { attempts: chain.attempts + 1 } },
  ]);

  if (counter === undefined) throw new Error("Chain counter write returned no object");

  const reservation = await publish(context.session, {
    lease: context.lease,
    updates: [{ name: chainRef(context.run.root), from: chain.oid, to: counter }],
    reason: "reserve response",
  });`,
        },
      ],
    },
  ],
  tools: [
    {
      path: "core/src/kernel/step.ts",
      patch: `@@ -955,7 +955,15 @@ async function tools(context: StepContext): Promise<StepOutcome> {
         return afterConflict(context, { next, outputUpdates: [] });
       }
 
-      return { kind: "waiting", run: next };
+      const deadlines = (await listEffects(context.session, next.id)).flatMap((view) =>
+        view.effect.state === "waiting" && view.effect.until !== undefined
+          ? [view.effect.until]
+          : [],
+      );
+
+      return deadlines.length === 0
+        ? { kind: "waiting", run: next }
+        : { kind: "waiting", run: next, until: Math.min(...deadlines) };
     }
 
     case "failed":`,
      preludes: [
        {
          before: `async function tools(context: StepContext): Promise<StepOutcome> {
  if (context.tip === null) {
    return endRun(
      context,
      { kind: "failed", failure: runnerFailure("tools phase has no assistant message") },
      "fail",
    );
  }

  const object = await context.session.objects.get(context.tip);

  if (
    object === undefined ||
    !isCommit(object) ||
    object.body.kind !== "message" ||
    object.body.message.role !== "assistant"
  ) {
    return endRun(
      context,
      { kind: "failed", failure: runnerFailure("tools phase has no assistant message") },
      "fail",
    );
  }

  const assistant = object.body.message;
  const commits = await contextCommits(context.session.objects, context.tip);

  const called = await callTurn(context, context.run.abortRequested === true, (emit, signal) =>
    context.turn.tools({
      session: context.session,
      telemetry: context.telemetry,
      lease: context.lease,
      run: context.run,
      now: context.now(),
      attempt: context.run.attempts,
      commits,
      assistant,
      emit,
      signal,
    }),
  );

  if (called.kind === "fenced") return { kind: "fenced" };
  const outcome = called.outcome;

  switch (outcome.kind) {
    case "fenced":
      return { kind: "fenced" };
    case "conflict":
      return { kind: "continue" };
    case "complete":
      return publishTools(context, { outcome, phase: { kind: "respond" }, reason: "tools" });
    case "waiting": {
      const next = withPhase(context.run, { kind: "waiting" });
      await context.session.objects.put([next]);

      const published = await publish(context.session, {
        lease: context.lease,
        updates: [
          { name: runRef(context.options.head), from: context.runOid, to: hashObject(next) },
        ],
        reason: "wait",
      });

      if (published === "fenced") return { kind: "fenced" };

      if (published === "conflict") {`,
          after: `async function tools(context: StepContext): Promise<StepOutcome> {
  if (context.tip === null) {
    return endRun(
      context,
      { kind: "failed", failure: runnerFailure("tools phase has no assistant message") },
      "fail",
    );
  }

  const object = await context.session.objects.get(context.tip);

  if (
    object === undefined ||
    !isCommit(object) ||
    object.body.kind !== "message" ||
    object.body.message.role !== "assistant"
  ) {
    return endRun(
      context,
      { kind: "failed", failure: runnerFailure("tools phase has no assistant message") },
      "fail",
    );
  }

  const assistant = object.body.message;
  const commits = await contextCommits(context.session.objects, context.tip);

  const called = await callTurn(context, context.run.abortRequested === true, (emit, signal) =>
    context.turn.tools({
      session: context.session,
      telemetry: context.telemetry,
      lease: context.lease,
      run: context.run,
      now: context.now(),
      attempt: context.run.attempts,
      commits,
      assistant,
      emit,
      signal,
    }),
  );

  if (called.kind === "fenced") return { kind: "fenced" };
  const outcome = called.outcome;

  switch (outcome.kind) {
    case "fenced":
      return { kind: "fenced" };
    case "conflict":
      return { kind: "continue" };
    case "complete":
      return publishTools(context, { outcome, phase: { kind: "respond" }, reason: "tools" });
    case "waiting": {
      const next = withPhase(context.run, { kind: "waiting" });
      await context.session.objects.put([next]);

      const published = await publish(context.session, {
        lease: context.lease,
        updates: [
          { name: runRef(context.options.head), from: context.runOid, to: hashObject(next) },
        ],
        reason: "wait",
      });

      if (published === "fenced") return { kind: "fenced" };

      if (published === "conflict") {`,
        },
      ],
    },
  ],
  retrySchedule: [
    {
      path: "core/src/kernel/turn.ts",
      patch: `@@ -309,6 +309,7 @@ async function respond(options: TurnOptions, input: TurnInput): Promise<RespondO
         policy: options.retry ?? DEFAULT_RETRY_POLICY,
         run: input.run,
         failure,
+        now: input.now,
       });
 
       return retry === undefined
@@ -685,6 +686,7 @@ function retrySchedule(options: {
   readonly policy: RetryPolicy;
   readonly run: Run;
   readonly failure: Failure;
+  readonly now: number;
 }): { readonly at: number; readonly retries: number } | undefined {
   const previousRetries = options.run.phase.kind === "retry" ? options.run.phase.retries : 0;
 
@@ -694,7 +696,7 @@ function retrySchedule(options: {
   const retries = previousRetries + 1;
   const delay = Math.max(retryDelayMs(options.policy, retries), options.failure.retryAfterMs ?? 0);
 
-  return { at: Date.now() + delay, retries };
+  return { at: options.now + delay, retries };
 }
 
 function durableTools(options: {`,
      preludes: [
        {
          before: `async function respond(options: TurnOptions, input: TurnInput): Promise<RespondOutcome> {
  const settings = options.compaction ?? DEFAULT_COMPACTION_SETTINGS;
  const usage = newestAssistantUsage(input.commits);
  const checkpoint = input.commits[0]?.commit.body;

  const contextTokens =
    checkpoint?.kind === "checkpoint" && checkpoint.material !== undefined
      ? estimateModelContextTokens(
          input.commits.map((entry) => entry.commit),
          { provider: options.model.provider, api: options.model.api, model: options.model.id },
        ).tokens
      : usage === undefined
        ? undefined
        : usageTokens(usage);

  if (
    !input.signal.aborted &&
    !newestIsRunCheckpoint(input) &&
    contextTokens !== undefined &&
    (options.compactAt === undefined
      ? shouldCompact(contextTokens, options.model.contextWindow, settings)
      : settings.enabled && contextTokens >= options.compactAt)
  ) {
    const checkpoint = await checkpointOutcome(options, input, settings, "threshold");

    if (checkpoint !== undefined) return checkpoint;
  }

  const context = agentContext({ options, input, tools: [...options.tools] });

  const message = await generateAssistant(
    context,
    agentConfig(options, input.telemetry),
    input.signal,
    (event) => emitAssistantDelta(input, event),
    options.streamFn,
  );

  switch (message.stopReason) {
    case "aborted":
      return { kind: "aborted", message, failure: classifyAssistantFailure(message) };
    case "error": {
      const failure = classifyAssistantFailure(message, options.model);

      if (settings.enabled && isOverflow(message, options.model) && !newestIsRunCheckpoint(input)) {
        const checkpoint = await checkpointOutcome(options, input, settings, "overflow");

        if (checkpoint !== undefined) {
          // Recovery replaces this response with a checkpoint. Keep the original
          // model spend without adding the failed response to the branch context.
          await input.session.objects.put([
            {
              kind: "commit",
              parent: input.commits.at(-1)?.oid ?? null,
              body: { kind: "message", message },
              calls: {},
              outcome: { kind: "failed", failure },
              run: input.run.id,
              at: Date.now(),
            },
          ]);

          return checkpoint;
        }
      }

      const retry = retrySchedule({`,
          after: `async function respond(options: TurnOptions, input: TurnInput): Promise<RespondOutcome> {
  const settings = options.compaction ?? DEFAULT_COMPACTION_SETTINGS;
  const usage = newestAssistantUsage(input.commits);
  const checkpoint = input.commits[0]?.commit.body;

  const contextTokens =
    checkpoint?.kind === "checkpoint" && checkpoint.material !== undefined
      ? estimateModelContextTokens(
          input.commits.map((entry) => entry.commit),
          { provider: options.model.provider, api: options.model.api, model: options.model.id },
        ).tokens
      : usage === undefined
        ? undefined
        : usageTokens(usage);

  if (
    !input.signal.aborted &&
    !newestIsRunCheckpoint(input) &&
    contextTokens !== undefined &&
    (options.compactAt === undefined
      ? shouldCompact(contextTokens, options.model.contextWindow, settings)
      : settings.enabled && contextTokens >= options.compactAt)
  ) {
    const checkpoint = await checkpointOutcome(options, input, settings, "threshold");

    if (checkpoint !== undefined) return checkpoint;
  }

  const context = agentContext({ options, input, tools: [...options.tools] });

  const message = await generateAssistant(
    context,
    agentConfig(options, input.telemetry),
    input.signal,
    (event) => emitAssistantDelta(input, event),
    options.streamFn,
  );

  switch (message.stopReason) {
    case "aborted":
      return { kind: "aborted", message, failure: classifyAssistantFailure(message) };
    case "error": {
      const failure = classifyAssistantFailure(message, options.model);

      if (settings.enabled && isOverflow(message, options.model) && !newestIsRunCheckpoint(input)) {
        const checkpoint = await checkpointOutcome(options, input, settings, "overflow");

        if (checkpoint !== undefined) {
          // Recovery replaces this response with a checkpoint. Keep the original
          // model spend without adding the failed response to the branch context.
          await input.session.objects.put([
            {
              kind: "commit",
              parent: input.commits.at(-1)?.oid ?? null,
              body: { kind: "message", message },
              calls: {},
              outcome: { kind: "failed", failure },
              run: input.run.id,
              at: Date.now(),
            },
          ]);

          return checkpoint;
        }
      }

      const retry = retrySchedule({`,
        },
        { before: `function retrySchedule(options: {`, after: `function retrySchedule(options: {` },
        {
          before: `function retrySchedule(options: {
  readonly policy: RetryPolicy;
  readonly run: Run;
  readonly failure: Failure;
}): { readonly at: number; readonly retries: number } | undefined {
  const previousRetries = options.run.phase.kind === "retry" ? options.run.phase.retries : 0;

  if (!options.policy.enabled || previousRetries >= options.policy.maxRetries) return undefined;

  if (!isRetryableFailureClass(options.failure.class)) return undefined;`,
          after: `function retrySchedule(options: {
  readonly policy: RetryPolicy;
  readonly run: Run;
  readonly failure: Failure;
  readonly now: number;
}): { readonly at: number; readonly retries: number } | undefined {
  const previousRetries = options.run.phase.kind === "retry" ? options.run.phase.retries : 0;

  if (!options.policy.enabled || previousRetries >= options.policy.maxRetries) return undefined;

  if (!isRetryableFailureClass(options.failure.class)) return undefined;`,
        },
      ],
    },
  ],
  untilLeaseReleased: [
    {
      path: "core/src/kernel/sdk/wait.ts",
      patch: `@@ -11,8 +11,15 @@ async function untilLeaseReleased(
   name: string,
   signal: AbortSignal,
 ): Promise<void> {
+  let delay = 5;
+
   while (!signal.aborted) {
-    if ((await session.leases.read(name)) === undefined || signal.aborted) return;
+    const lease = await session.leases.read(name);
+
+    if (lease === undefined || signal.aborted) return;
+    // Back off while the holder keeps renewing; never sleep past its expiry.
+    const wait = Math.max(1, Math.min(delay, lease.expiresAt - Date.now()));
+    delay = Math.min(delay * 2, 1_000);
     await new Promise<void>((resolve) => {
       const finish = (): void => {
         clearTimeout(timer);
@@ -20,7 +27,7 @@ async function untilLeaseReleased(
         resolve();
       };
 
-      const timer = setTimeout(finish, 5);
+      const timer = setTimeout(finish, wait);
       signal.addEventListener("abort", finish, { once: true });
     });
   }`,
      preludes: [
        {
          before: `async function untilLeaseReleased(
  session: Session,`,
          after: `async function untilLeaseReleased(
  session: Session,`,
        },
        {
          before: `async function untilLeaseReleased(
  session: Session,
  name: string,
  signal: AbortSignal,
): Promise<void> {
  while (!signal.aborted) {
    if ((await session.leases.read(name)) === undefined || signal.aborted) return;
    await new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(timer);
        signal.removeEventListener("abort", finish);`,
          after: `async function untilLeaseReleased(
  session: Session,
  name: string,
  signal: AbortSignal,
): Promise<void> {
  let delay = 5;

  while (!signal.aborted) {
    const lease = await session.leases.read(name);

    if (lease === undefined || signal.aborted) return;
    // Back off while the holder keeps renewing; never sleep past its expiry.
    const wait = Math.max(1, Math.min(delay, lease.expiresAt - Date.now()));
    delay = Math.min(delay * 2, 1_000);
    await new Promise<void>((resolve) => {
      const finish = (): void => {
        clearTimeout(timer);
        signal.removeEventListener("abort", finish);`,
        },
      ],
    },
  ],
  headFromRunRef: [
    {
      path: "core/src/kernel/names.ts",
      patch: `@@ -99,6 +99,14 @@ export function runRef(head: string): RefName {
   return RUNS + head;
 }
 
+/** The head a run ref names; the inverse of \`runRef\`. */
+export function parseRunRef(name: RefName): string | undefined {
+  if (!name.startsWith(RUNS)) return undefined;
+  const head = name.slice(RUNS.length);
+
+  return isHeadName(head) ? head : undefined;
+}
+
 export function chainRef(root: string): RefName {
   return CHAINS + root;
 }
@@ -123,6 +131,16 @@ export function effectPrefix(runId: string): string {
   return \`\${EFFECTS}\${runId}/\`;
 }
 
+/** The run and call an effect ref names; the inverse of \`effectRef\`. */
+export function parseEffectRef(
+  name: RefName,
+): { readonly runId: string; readonly callId: string } | undefined {
+  if (!name.startsWith(EFFECTS)) return undefined;
+  const [runId, callId, ...rest] = name.slice(EFFECTS.length).split("/");
+
+  return runId && callId && rest.length === 0 ? { runId, callId } : undefined;
+}
+
 export function keyRef(key: string): RefName {
   return KEYS + key;
 }`,
      preludes: [
        {
          before: `export function runRef(head: string): RefName {`,
          after: `export function runRef(head: string): RefName {`,
        },
        {
          before: `export function effectPrefix(runId: string): string {`,
          after: `export function effectPrefix(runId: string): string {`,
        },
      ],
    },
  ],
  projectRef: [
    {
      path: "core/src/kernel/sdk/events.ts",
      patch: `@@ -24,8 +24,6 @@ const RUN_PREFIX = "refs/runs/";
 
 const EFFECT_PREFIX = "refs/effects/";
 
-const KEY_PREFIX = "refs/keys/";
-
 type ReadObject = Pick<Objects, "get" | "chain">;
 
 type CommitItem = { readonly oid: Oid; readonly commit: Commit };
@@ -333,8 +331,6 @@ async function projectRef(
     return event.to === null ? [] : [{ seq: event.seq, kind: "deleted" }];
   }
 
-  if (event.name.startsWith(KEY_PREFIX)) return [];
-
   return [];
 }
 `,
      preludes: [
        { before: `const RUN_PREFIX = "refs/runs/";`, after: `const RUN_PREFIX = "refs/runs/";` },
        {
          before: `async function projectRef(
  event: Extract<Event, { readonly kind: "ref" }>,
  read: ReadObject,
): Promise<readonly SessionEvent[]> {
  if (event.name.startsWith(JOB_PREFIX) && event.to !== null) {
    const blob = await read.get(event.to);

    if (blob?.kind !== "blob") throw new Error(\`Corrupt job ref at \${event.to}\`);

    return [{ seq: event.seq, kind: "job", job: parseJobRecord(blob.value).info }];
  }

  const head = suffix(event.name, HEAD_PREFIX);

  if (head !== undefined && !head.includes("/")) return projectHeadRef(event, head, read);

  const queue = parseInboxRef(event.name);

  if (queue !== undefined) return projectQueueRef(event, queue, read);

  const cancelled = suffix(event.name, CANCELLED_PREFIX);

  if (cancelled !== undefined && event.to !== null) {
    return [{ seq: event.seq, kind: "queue_cancelled", change: cancelled }];
  }

  if (hasEffectParts(event.name)) return projectEffectRef(event, read);

  const runHead = suffix(event.name, RUN_PREFIX);

  if (runHead !== undefined && !runHead.includes("/")) {
    if (event.to === null) return [];
    const run = await read.get(event.to);

    if (run?.kind !== "run") throw new Error(\`Corrupt run ref at \${event.to}\`);

    return [{ seq: event.seq, kind: "run", head: runHead, run: runInfo(run) }];
  }

  const compactionHead = parseCompactionRef(event.name);

  if (compactionHead !== undefined) {
    return [
      {
        seq: event.seq,
        kind: "compaction",
        head: compactionHead,
        compaction:
          event.to === null ? null : compactionInfoFromObject(await read.get(event.to), event.name),
      },
    ];
  }

  const stackHead = suffix(event.name, STACK_PREFIX);

  if (stackHead !== undefined && !stackHead.includes("/")) {
    if (event.to === null) return [];
    const stack = await read.get(event.to);

    if (stack?.kind !== "stack") throw new Error(\`Corrupt stack ref at \${event.to}\`);

    return [
      {
        seq: event.seq,
        kind: "stack",
        head: stackHead,
        parent: stack.parent,
        base: stack.base,
      },
    ];
  }

  const factRefKey = suffix(event.name, FACT_PREFIX);

  if (factRefKey !== undefined) {
    // Plugin storage escapes its keys; clients and plugins see the key they wrote.
    const key = decodeFactKey(factRefKey);

    if (event.to === null) {
      return [{ seq: event.seq, kind: "fact", key, value: undefined }];
    }

    const fact = await read.get(event.to);

    if (fact?.kind !== "blob") throw new Error(\`Corrupt fact ref at \${event.to}\`);

    return [{ seq: event.seq, kind: "fact", key, value: fact.value }];
  }

  if (event.name === DELETED_REF) {`,
          after: `async function projectRef(
  event: Extract<Event, { readonly kind: "ref" }>,
  read: ReadObject,
): Promise<readonly SessionEvent[]> {
  if (event.name.startsWith(JOB_PREFIX) && event.to !== null) {
    const blob = await read.get(event.to);

    if (blob?.kind !== "blob") throw new Error(\`Corrupt job ref at \${event.to}\`);

    return [{ seq: event.seq, kind: "job", job: parseJobRecord(blob.value).info }];
  }

  const head = suffix(event.name, HEAD_PREFIX);

  if (head !== undefined && !head.includes("/")) return projectHeadRef(event, head, read);

  const queue = parseInboxRef(event.name);

  if (queue !== undefined) return projectQueueRef(event, queue, read);

  const cancelled = suffix(event.name, CANCELLED_PREFIX);

  if (cancelled !== undefined && event.to !== null) {
    return [{ seq: event.seq, kind: "queue_cancelled", change: cancelled }];
  }

  if (hasEffectParts(event.name)) return projectEffectRef(event, read);

  const runHead = suffix(event.name, RUN_PREFIX);

  if (runHead !== undefined && !runHead.includes("/")) {
    if (event.to === null) return [];
    const run = await read.get(event.to);

    if (run?.kind !== "run") throw new Error(\`Corrupt run ref at \${event.to}\`);

    return [{ seq: event.seq, kind: "run", head: runHead, run: runInfo(run) }];
  }

  const compactionHead = parseCompactionRef(event.name);

  if (compactionHead !== undefined) {
    return [
      {
        seq: event.seq,
        kind: "compaction",
        head: compactionHead,
        compaction:
          event.to === null ? null : compactionInfoFromObject(await read.get(event.to), event.name),
      },
    ];
  }

  const stackHead = suffix(event.name, STACK_PREFIX);

  if (stackHead !== undefined && !stackHead.includes("/")) {
    if (event.to === null) return [];
    const stack = await read.get(event.to);

    if (stack?.kind !== "stack") throw new Error(\`Corrupt stack ref at \${event.to}\`);

    return [
      {
        seq: event.seq,
        kind: "stack",
        head: stackHead,
        parent: stack.parent,
        base: stack.base,
      },
    ];
  }

  const factRefKey = suffix(event.name, FACT_PREFIX);

  if (factRefKey !== undefined) {
    // Plugin storage escapes its keys; clients and plugins see the key they wrote.
    const key = decodeFactKey(factRefKey);

    if (event.to === null) {
      return [{ seq: event.seq, kind: "fact", key, value: undefined }];
    }

    const fact = await read.get(event.to);

    if (fact?.kind !== "blob") throw new Error(\`Corrupt fact ref at \${event.to}\`);

    return [{ seq: event.seq, kind: "fact", key, value: fact.value }];
  }

  if (event.name === DELETED_REF) {`,
        },
      ],
    },
  ],
  attempts: [
    {
      path: "core/src/kernel/model.ts",
      patch: `@@ -97,7 +97,7 @@ export interface Run {
   readonly root: RunId;
   readonly phase: RunPhase;
   readonly startedAt: number;
-  /** Assistant responses attempted so far: the step ceiling and the delta key. */
+  /** Assistant responses this run attempted. Keys deltas; the ceiling reads \`refs/chains/<root>\`. */
   readonly attempts: number;
   /** Branch inputs with the runner's resolved model and thinking defaults captured at start. */
   readonly config: RunConfig;`,
      preludes: [
        {
          before: `export interface Run {
  readonly kind: "run";
  readonly id: RunId;
  /** Branch name, not ref name. */
  readonly head: string;
  readonly origin: RunOrigin;`,
          after: `export interface Run {
  readonly kind: "run";
  readonly id: RunId;
  /** Branch name, not ref name. */
  readonly head: string;
  readonly origin: RunOrigin;`,
        },
      ],
    },
  ],
} satisfies Record<string, readonly Patch[]>;
