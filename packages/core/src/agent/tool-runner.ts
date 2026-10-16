import { asId, compile, isJson, ToolOutcomeType, withJson } from "@nyte-ai/schema";
import type {
  Awaitable,
  CallId,
  Decision,
  FileChange,
  HeadName,
  Infer,
  Json,
  ObjectId,
  Placement,
  PrincipalId,
  RefUpdate,
  RunId,
  SessionId,
  SnapshotId,
  ToolCall,
  ToolClass,
  ToolOutcome,
  ToolResult,
  WorkspaceId,
} from "@nyte-ai/schema";
import { PARTICIPANT_AUTHORITY } from "../contract/host.ts";
import type { ConnectionContext } from "../contract/host.ts";
import type { Kernel, PluginRuntime, StepEnd } from "../contract/kernel.ts";
import { definePart, tool } from "../contract/parts.ts";
import type { ActionContext, ActionOutput, PartState } from "../contract/parts.ts";
import { decodeChangesRecord, decodePartRecord, decodeRunRecord } from "../contract/records.ts";
import type { CallRecord, PartRecord } from "../contract/records.ts";
import type { Durable, ToolDefinition, ToolInvocation } from "../contract/tools.ts";
import type { ExecutionEnv } from "../contract/workspace.ts";
import { isParked, parkStep, runStep } from "../engine/durable.ts";
import { abortHere, FENCED, unfenced } from "../engine/fence.ts";
import { publishPatch } from "../engine/runs.ts";
import { changeCall, commit } from "../fold/commit.ts";
import { settling } from "../store/parts.ts";
import { changesRef, partRef, runRef } from "../store/refs.ts";
import {
  attempt,
  load,
  put,
  readCall,
  readCalls,
  readRefExpectation,
  readTip,
  requireSession,
  STALE,
} from "../store/session.ts";
import { dev } from "../util/dev-log.ts";
import { isJsonObject } from "../util/json-schema.ts";

type ToolIntent = {
  readonly name: string;
  readonly args: Json;
  readonly principal: PrincipalId;
};

type Plan = { readonly args: Json; readonly class: ToolClass } & (
  | { readonly kind: "execute"; readonly definition: ToolDefinition; readonly input: unknown }
  | { readonly kind: "settle"; readonly outcome: ToolOutcome }
);

interface Settled {
  readonly outcome: ToolOutcome;
  readonly changes: {
    readonly added: number;
    readonly removed: number;
    readonly paths: readonly string[];
  } | null;
  readonly files: readonly FileChange[];

  readonly snapshot: SnapshotId | null;
}

interface Where {
  readonly session: SessionId;
  readonly head: HeadName;
  readonly run: RunId;
  readonly call: CallId;
  readonly name: string;
  readonly context: ConnectionContext;
  readonly signal: AbortSignal;
}

const HOOK = "hook:before_tool:";

const STEP: Placement = { kind: "transcript", role: "step" };

const PARKED = { kind: "parked" } as const;

const STOPPED: ToolOutcome = { kind: "stopped" };

const INTERRUPTED: ToolOutcome = { kind: "interrupted" };

const CONTINUE: Decision<ToolCall> = { action: "continue" };

const outcomes = compile(withJson(ToolOutcomeType));

function decodeToolIntent(value: Json): ToolIntent | null {
  if (!isJsonObject(value) || !("args" in value)) return null;
  const { name, args, principal } = value;

  return typeof name === "string" && typeof principal === "string"
    ? { name, args, principal: asId<"principal">(principal) }
    : null;
}

export async function executeCall(
  kernel: Kernel,
  input: Where & { readonly args: Json; readonly runtime: PluginRuntime },
): Promise<ToolOutcome | typeof PARKED> {
  const { session, call } = input;
  const controller = new AbortController();
  const live = kernel.calls;
  const controllers = live.get(call) ?? new Set<AbortController>();
  controllers.add(controller);
  live.set(call, controllers);

  const steps = await Promise.all([
    readCall(kernel, session, call),
    readCall(kernel, session, asId<"call">(`${HOOK}${call}`)),
  ]);

  if (steps.some((found) => found?.record.waits.some((outcome) => outcome.kind === "stopped")))
    controller.abort();

  try {
    return await perform(kernel, {
      ...input,
      signal: AbortSignal.any([input.signal, controller.signal]),
    });
  } finally {
    controllers.delete(controller);

    if (controllers.size === 0 && live.get(call) === controllers) live.delete(call);
  }
}

async function executeNested(
  kernel: Kernel,
  input: Where & { readonly args: Json; readonly key: string; readonly runtime: PluginRuntime },
): Promise<ToolOutcome | typeof PARKED> {
  const { session, call, key } = input;
  const nested = (await readCall(kernel, session, call))?.record.nested;

  if (nested !== undefined && Object.hasOwn(nested, key)) return nested[key];
  const outcome = await executeCall(kernel, { ...input, call: asId<"call">(`${call}:${key}`) });

  if (outcome.kind === "parked") return outcome;

  await changeCall(kernel, session, call, async (current) =>
    current === null || Object.hasOwn(current.nested, key)
      ? null
      : { record: { ...current, nested: { ...current.nested, [key]: outcome } } },
  );

  return outcome;
}

export async function owedCalls(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
): Promise<
  readonly { readonly call: CallId; readonly intent: ToolIntent; readonly parked: boolean }[]
> {
  const records = (await readCalls(kernel, session)).filter(
    (record) => record.run === run && record.kind !== "action",
  );

  const ids = [...new Set(records.map(stripHookPrefix))];

  return ids.flatMap((id) => {
    if (ids.some((other) => id.startsWith(`${other}:`))) return [];
    const own = records.filter((record) => stripHookPrefix(record) === id);
    const step = own.find((record) => record.kind === "tool");

    if (step !== undefined && step.result !== null) return [];
    const intent = decodeToolIntent((step ?? own[0]).intent);

    if (intent === null) return [];

    const parked = records.some(
      (record) =>
        record.waiting !== null &&
        record.result === null &&
        (stripHookPrefix(record) === id || stripHookPrefix(record).startsWith(`${id}:`)),
    );

    return [{ call: asId<"call">(id), intent, parked }];
  });
}

export function stoppableTool(kernel: Kernel): typeof tool {
  const actions: {
    readonly [A in keyof typeof tool.actions]: (
      input: Infer<(typeof tool.actions)[A]["input"]>,
      context: ActionContext<PartState<typeof tool>, typeof tool.actions>,
    ) => Awaitable<ActionOutput<(typeof tool.actions)[A]>>;
  } = {
    async stop(_input, context) {
      const running = kernel.calls.get(context.part.id);

      if (running !== undefined && running.size > 0) {
        for (const controller of running) controller.abort();

        return undefined;
      }

      for (const call of [context.part.id, `${HOOK}${context.part.id}`])
        await kernel.waits.callStopped(context.session, asId<"call">(call));

      return undefined;
    },
  };

  return definePart({
    ...tool,
    onAction: (action, input, context) => actions[action](input, context),
  });
}

async function perform(
  kernel: Kernel,
  where: Where & { readonly args: Json; readonly runtime: PluginRuntime },
): Promise<ToolOutcome | typeof PARKED> {
  const { session, head, run, call, signal } = where;

  const intent: ToolIntent = {
    name: where.name,
    args: where.args,
    principal: where.context.principal,
  };

  dev("tool", "call", { session, run, call, tool: where.name });
  const planned = await plan(kernel, where, intent);

  if (planned.kind === "parked") return PARKED;
  let concluded: Promise<Settled> | undefined;

  const step = await runStep<ToolOutcome>(kernel, {
    session,
    head,
    run,
    call,
    kind: "tool",
    replay: planned.kind === "execute" ? planned.definition.replay : "safe",
    intent,
    opening: () => partOpening(kernel, where, planned),
    part: asId<"part">(call),
    signal,
    body:
      planned.kind === "execute"
        ? (durable) => execute(kernel, where, planned, durable)
        : async () => planned.outcome,
    async settle(ended) {
      concluded ??= conclude(
        kernel,
        where,
        ended,
        planned.kind === "execute" && writes(planned.class),
      );
      const settled = await concluded;

      return {
        result: settled.outcome,
        updates: await settlement(kernel, where, planned, settled),
      };
    },
    decode: (value) => (outcomes.Check(value) ? outcomes.Decode(value) : null),
  });

  dev("tool", step.kind, { session, run, call });

  if (step.kind === "parked") return PARKED;

  return step.value;
}

async function plan(
  kernel: Kernel,
  where: Where & { readonly args: Json; readonly runtime: PluginRuntime },
  intent: ToolIntent,
): Promise<Plan | typeof PARKED> {
  const { session, head, run, call, name } = where;
  const custom: ToolClass = { kind: "custom", label: name };
  const definition = kernel.tools(where.runtime).get(name)?.definition;

  if (definition === undefined)
    return {
      kind: "settle",
      outcome: failed(`No tool is named ${name}.`),
      args: where.args,
      class: custom,
    };

  const proposed: ToolCall = {
    call,
    name,
    args: where.args,
    class: classifyToolCall(definition, where.args, call) ?? custom,
  };

  const gated = await kernel.beforeTool(proposed, {
    session,
    head,
    run,
    principal: intent.principal,
    signal: where.signal,
    runtime: where.runtime,
  });

  if (gated.kind === "parked") return PARKED;
  const gate = gated.kind === "done" ? gated.value : CONTINUE;

  if (where.signal.aborted && (await readCall(kernel, session, call)) === null)
    return { kind: "settle", outcome: STOPPED, args: where.args, class: proposed.class };

  if (gate.action === "reject")
    return {
      kind: "settle",
      outcome: { kind: "rejected", reason: gate.reason },
      args: where.args,
      class: proposed.class,
    };

  if (gate.action === "error")
    return {
      kind: "settle",
      outcome: failed(gate.message),
      args: where.args,
      class: proposed.class,
    };
  const args = gate.action === "modify" ? gate.value.args : where.args;
  const checked = await definition.parameters["~standard"].validate(args);

  if (checked.issues !== undefined)
    return {
      kind: "settle",
      outcome: failed(
        `Invalid arguments for ${name}: ${checked.issues.map((issue) => issue.message).join("; ")}`,
      ),
      args,
      class: custom,
    };
  const known = classifyToolCall(definition, checked.value, call);

  if (known === null)
    return {
      kind: "settle",
      outcome: failed(`${name} could not classify its call.`),
      args,
      class: custom,
    };

  return { kind: "execute", definition, input: checked.value, args, class: known };
}

async function partOpening(
  kernel: Kernel,
  where: Where,
  planned: Plan,
): Promise<{ readonly updates: readonly RefUpdate[]; readonly result: Json | null }> {
  const { session, head, run, call } = where;
  const part = asId<"part">(call);
  const name = partRef(session, part);

  const [existing, held] = await Promise.all([
    kernel.store.refs.get(name),
    unfenced(kernel, session, run),
  ]);

  if (existing !== null) return { updates: [], result: null };
  const at = Date.now();
  const fields = { call, name: where.name, args: planned.args, class: planned.class };
  const calling: Json = { ...fields, phase: "calling" };

  const record = (state: Json, version: number): PartRecord => ({
    id: part,
    partKind: tool.kind,
    placement: STEP,
    state,
    version,
    owner: null,
    run,
    status: { kind: "live", run },
  });

  const opened: RefUpdate[] = [
    {
      name,
      target: await put(kernel, "part", record(calling, 1), at),
      expect: "absent",
      event: {
        head,
        kind: "part",
        part,
        change: "created",
        partKind: tool.kind,
        placement: STEP,
        state: calling,
        version: 1,
        run,
        owner: null,
      },
    },
    {
      name,
      target: await put(
        kernel,
        "part",
        record({ ...fields, phase: "running", progress: null }, 2),
        at,
      ),
      event: {
        head,
        kind: "call",
        call,
        part,
        change: "intent",
        name: where.name,
        args: planned.args,
        class: planned.class,
      },
    },
  ];

  if (held !== null) return { updates: [held, ...opened], result: null };
  abortHere(kernel, run);
  const settled = record({ ...fields, phase: "settled", outcome: STOPPED, changes: null }, 3);
  const status = { kind: "failed", run, failure: FENCED } as const;

  return {
    updates: [
      ...opened,
      {
        name,
        target: await put(kernel, "part", settled, at),
        event: {
          head,
          kind: "call",
          call,
          part,
          change: "settled",
          outcome: STOPPED,
          changes: null,
        },
      },
      {
        name,
        target: await put(kernel, "part", { ...settled, status }, at),
        event: { head, kind: "part", part, change: "failed", failure: FENCED },
      },
    ],
    result: STOPPED,
  };
}

async function execute(
  kernel: Kernel,
  where: Where & { readonly runtime: PluginRuntime },
  planned: Extract<Plan, { readonly kind: "execute" }>,
  durable: Durable,
): Promise<ToolOutcome> {
  const { session, run, signal } = where;

  try {
    if (writes(planned.class)) await baseline(kernel, session, run);

    const [env, found] = await Promise.all([kernel.env(session), requireSession(kernel, session)]);

    const invocation = createInvocation(kernel, {
      session,
      head: where.head,
      run,
      call: where.call,
      context: where.context,
      signal,
      workspace: found.record.workspace,
      env,
      durable,
      runtime: where.runtime,
    });

    const result = await planned.definition.execute(planned.input, invocation);

    return signal.aborted ? STOPPED : await validateToolResult(planned.definition, result);
  } catch (error) {
    if (isParked(error)) throw error;

    return signal.aborted
      ? STOPPED
      : failed(error instanceof Error ? error.message : String(error));
  }
}

async function validateToolResult(
  definition: ToolDefinition,
  result: ToolResult<unknown>,
): Promise<ToolOutcome> {
  const parts = result.parts ?? [];

  if (definition.output === undefined)
    return {
      kind: "ok",
      content: result.content,
      output: isJson(result.output) ? result.output : null,
      parts,
    };

  const checked = await definition.output["~standard"].validate(result.output);

  if (checked.issues !== undefined)
    return failed(`${definition.name} returned output its schema rejects.`);

  return {
    kind: "ok",
    content: result.content,
    output: isJson(checked.value) ? checked.value : null,
    parts,
  };
}

async function conclude(
  kernel: Kernel,
  where: Where & { readonly runtime: PluginRuntime },
  ended: StepEnd<ToolOutcome>,
  wrote: boolean,
): Promise<Settled> {
  const { session, head, run, call } = where;

  const outcome = await kernel.afterTool(ended.kind === "done" ? ended.value : INTERRUPTED, {
    session,
    head,
    run,
    call,
    principal: where.context.principal,
    runtime: where.runtime,
  });

  const snapshots = wrote && ended.kind === "done" ? await kernel.snapshots(session) : null;

  if (snapshots === null) return { outcome, changes: null, files: [], snapshot: null };
  const from = (await diffBase(kernel, session, run)) ?? (await snapshots.before(run));
  const to = await snapshots.after(run);

  const files = (await snapshots.diff(from, to)).files.map((file): FileChange => {
    const change: FileChange = {
      path: file.path,
      status: file.status,
      added: file.stat.kind === "text" ? file.stat.added : 0,
      removed: file.stat.kind === "text" ? file.stat.removed : 0,
    };

    return file.from === undefined ? change : { ...change, from: file.from };
  });

  return {
    outcome,
    changes: {
      added: files.reduce((sum, file) => sum + file.added, 0),
      removed: files.reduce((sum, file) => sum + file.removed, 0),
      paths: files.map((file) => file.path),
    },
    files,
    snapshot: to,
  };
}

async function settlement(
  kernel: Kernel,
  where: Where,
  planned: Plan,
  settled: Settled,
): Promise<readonly RefUpdate[]> {
  const { session, head, run, call } = where;
  const part = asId<"part">(call);
  const name = partRef(session, part);

  const [found, tip] = await Promise.all([
    kernel.store.refs.get(name).then((ref) => load(kernel, ref, decodePartRecord)),
    readTip(kernel, session, head),
  ]);

  if (found === null) return [];
  const at = Date.now();

  const state: Json = {
    call,
    name: where.name,
    args: planned.args,
    class: planned.class,
    phase: "settled",
    outcome: settled.outcome,
    changes: settled.changes,
  };

  const merged =
    settled.files.length === 0 ? [] : await mergeChanges(kernel, session, settled.files);

  const based =
    settled.snapshot === null ? [] : await nextBase(kernel, session, run, settled.snapshot);

  const record = { ...found.record, state, version: found.record.version + 1 };

  const opened = (target: ObjectId): RefUpdate => ({
    name,
    target,
    expect: found.ref.revision,
    event: {
      head,
      kind: "call",
      call,
      part,
      change: "settled",
      outcome: settled.outcome,
      changes: settled.changes,
    },
  });

  if (found.record.status.kind === "failed" || found.record.status.kind === "settled") {
    const target = await put(kernel, "part", record, at);

    return [opened(target), ...based, ...merged];
  }

  const landed = await settling(kernel, {
    session,
    head,
    run,
    parent: tip.id,
    expect: readRefExpectation(tip.ref),
    record,
    body: { kind: "part", part },
    at,
  });

  return [opened(landed.target), ...landed.updates, ...based, ...merged];
}

async function baseline(kernel: Kernel, session: SessionId, run: RunId): Promise<void> {
  if ((await diffBase(kernel, session, run)) !== null) return;
  const snapshots = await kernel.snapshots(session);

  if (snapshots === null) return;
  const before = await snapshots.before(run);

  await attempt(`Recording run ${run}'s snapshot`, async () => {
    const found = await load(
      kernel,
      await kernel.store.refs.get(runRef(session, run)),
      decodeRunRecord,
    );

    if (found === null || found.record.snapshot !== null) return undefined;

    const outcome = await commit(kernel, [
      {
        name: found.ref.name,
        target: await put(kernel, "run", { ...found.record, snapshot: before }),
        expect: found.ref.revision,
      },
    ]);

    return outcome.kind === "set" ? undefined : STALE;
  });
}

async function diffBase(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
): Promise<SnapshotId | null> {
  const found = await load(
    kernel,
    await kernel.store.refs.get(runRef(session, run)),
    decodeRunRecord,
  );

  return found?.record.lastSnapshot ?? found?.record.snapshot ?? null;
}

async function nextBase(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
  to: SnapshotId,
): Promise<readonly RefUpdate[]> {
  const found = await load(
    kernel,
    await kernel.store.refs.get(runRef(session, run)),
    decodeRunRecord,
  );

  if (found === null || found.record.lastSnapshot === to) return [];

  return [
    {
      name: found.ref.name,
      target: await put(kernel, "run", { ...found.record, lastSnapshot: to }),
      expect: found.ref.revision,
    },
  ];
}

async function mergeChanges(
  kernel: Kernel,
  session: SessionId,
  files: readonly FileChange[],
): Promise<readonly RefUpdate[]> {
  const name = changesRef(session);
  const ref = await kernel.store.refs.get(name);
  const kept = (await load(kernel, ref, decodeChangesRecord))?.record.files ?? [];

  const merged = [
    ...kept.map((file) => files.find((next) => next.path === file.path) ?? file),
    ...files.filter((next) => !kept.some((file) => file.path === next.path)),
  ];

  return [
    {
      name,
      target: await put(kernel, "changes", { files: merged }),
      expect: readRefExpectation(ref),
      event: { head: null, kind: "changes", files: merged },
    },
  ];
}

function classifyToolCall(
  definition: ToolDefinition,
  args: unknown,
  call: CallId,
): ToolClass | null {
  try {
    return definition.class(args, { call });
  } catch {
    return null;
  }
}

function writes(klass: ToolClass): boolean {
  return klass.kind !== "read" && klass.kind !== "list";
}

function stripHookPrefix(record: CallRecord): string {
  return record.kind === "hook" && record.id.startsWith(HOOK)
    ? record.id.slice(HOOK.length)
    : record.id;
}

function failed(message: string): ToolOutcome {
  return { kind: "failed", message };
}

export function createInvocation(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly run: RunId;
    readonly call: CallId;
    readonly context: ConnectionContext;
    readonly signal: AbortSignal;
    readonly workspace: WorkspaceId;
    readonly env: ExecutionEnv;
    readonly durable: Durable;
    readonly runtime: PluginRuntime;
  },
): ToolInvocation {
  const { session, head, run, call, durable, signal } = input;
  let acquisitions = 0;
  let calls = 0;

  const context: ConnectionContext = {
    principal: input.context.principal,
    authority: PARTICIPANT_AUTHORITY,
    credential: input.context.credential,
    origin: {
      session,
      run,
      head,
      call,
      sequence: {
        next() {
          acquisitions += 1;

          return acquisitions - 1;
        },
      },
    },
  };

  const source = kernel.tools(input.runtime);
  const sdk = kernel.handles.connection(context);

  return {
    run,
    call,
    head,
    signal,
    session: kernel.handles.session(context, session),
    sdk,
    workspace: sdk.workspace(input.workspace),
    env: input.env,
    progress(update) {
      publishPatch(kernel, session, run, {
        kind: "patch",
        part: asId<"part">(call),
        progress: update,
      });
    },
    tools: {
      async execute(name, args, options) {
        const key = options?.key ?? `${calls}`;
        calls += 1;

        const outcome = await executeNested(kernel, {
          session,
          head,
          run,
          call,
          name,
          args,
          context: input.context,
          runtime: input.runtime,
          signal:
            options?.signal === undefined ? signal : AbortSignal.any([signal, options.signal]),
          key,
        });

        return outcome.kind === "parked" ? parkStep(durable) : outcome;
      },
      list: () => source.list(),
    },
    wait: (target) => durable.wait(target),
    memo: (name, compute) => durable.memo(name, compute),
    now: () => durable.now(),
  };
}
