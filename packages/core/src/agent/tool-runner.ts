import { Type } from "typebox";
import type { Static } from "typebox";
import {
  asId,
  compile,
  idSchema,
  isJson,
  JsonType,
  ToolOutcomeType,
  withJson,
} from "@nyte-ai/schema";
import type {
  Awaitable,
  CallId,
  ChangeSet,
  Decision,
  DurableEvent,
  FileChange,
  HeadName,
  Infer,
  Json,
  Placement,
  RefUpdate,
  RunId,
  Seq,
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
import { decodePartRecord, decodeRunRecord } from "../contract/records.ts";
import type { CallRecord, PartRecord } from "../contract/records.ts";
import type { Durable, ToolDefinition, ToolInvocation } from "../contract/tools.ts";
import type { ExecutionEnv } from "../contract/workspace.ts";
import { anotherChatLive, ownedChanges, readAttributedPaths } from "../env/session-changes.ts";
import { signalsPark, parkStep, runStep } from "../engine/durable.ts";
import { publishPatch } from "../engine/runs.ts";
import { hiddenOwners, missingCapabilities } from "../engine/surface.ts";
import { toolSource } from "../extend/registry.ts";
import { commit } from "../fold/commit.ts";
import { settling } from "../store/parts.ts";
import { partRef, runRef } from "../store/refs.ts";
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
import { check } from "../util/json-schema.ts";
import type { StoreConnection } from "../contract/store.ts";

const ToolCallerType = Type.Object({
  principal: idSchema<"principal">(),
  argumentsError: Type.Optional(Type.String()),
});

type ToolCaller = Static<typeof ToolCallerType>;

const ToolInputType = Type.Object({
  ...ToolCallerType.properties,
  name: Type.String(),
  args: JsonType,
});

type ToolInput = Static<typeof ToolInputType>;

const ToolIntentType = Type.Object({ ...ToolInputType.properties, position: Type.Number() });

export type ToolIntent = Static<typeof ToolIntentType>;

export interface OwedCall {
  readonly record: CallRecord;
  readonly parked: boolean;
}

const toolCallers = compile(withJson(ToolCallerType));

const toolIntents = compile(withJson(ToolIntentType));

type Plan = { readonly args: Json; readonly class: ToolClass } & (
  | { readonly kind: "execute"; readonly definition: ToolDefinition; readonly input: unknown }
  | { readonly kind: "settle"; readonly outcome: ToolOutcome }
);

interface Settled {
  readonly outcome: ToolOutcome;
  readonly files: readonly FileChange[] | null;
  /** The session's own files as they now differ from its first snapshot, or null when this call changed nothing. */
  readonly thread: readonly FileChange[] | null;

  readonly snapshot: SnapshotId | null;
  /** The workspace file the call edits, its changes kept to it; null when it names none. */
  readonly path: string | null;
  /** Files changed while another chat shared the folder and the call named none, so none were charged to it. */
  readonly unattributed: boolean;
}

type ToolBaseline = {
  readonly snapshot: SnapshotId;
  readonly seq: Seq;
  /** Whether another session in the workspace had a live run as the call started. */
  readonly contended: boolean;
};

interface Where {
  readonly session: SessionId;
  readonly head: HeadName;
  readonly run: RunId;
  readonly call: CallId;
  readonly name: string;
  readonly context: ConnectionContext;
  readonly signal: AbortSignal;
  readonly argumentsError?: string;
  readonly covered?: boolean;
}

const HOOK = "hook:before_tool:";

const STEP: Placement = { kind: "transcript", role: "step" };

const PARKED = { kind: "parked" } as const;

const STOPPED: ToolOutcome = { kind: "stopped" };

const INTERRUPTED: ToolOutcome = { kind: "interrupted" };

const CONTINUE: Decision<ToolCall> = { action: "continue" };

const outcomes = compile(withJson(ToolOutcomeType));

const liveCalls = new WeakMap<Kernel, Map<string, Set<AbortController>>>();

function runningCalls(kernel: Kernel): Map<string, Set<AbortController>> {
  const found = liveCalls.get(kernel);

  if (found !== undefined) return found;
  const calls = new Map<string, Set<AbortController>>();
  liveCalls.set(kernel, calls);

  return calls;
}

export async function executeCall(
  kernel: Kernel,
  input: Where & { readonly args: Json; readonly runtime: PluginRuntime },
): Promise<ToolOutcome | typeof PARKED> {
  const { session, call } = input;
  const controller = new AbortController();
  const live = runningCalls(kernel);
  const controllers = live.get(call) ?? new Set<AbortController>();
  controllers.add(controller);
  live.set(call, controllers);

  const steps = await Promise.all([
    readCall(kernel.store, session, call),
    readCall(kernel.store, session, asId<"call">(`${HOOK}${call}`)),
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

export async function owedCalls(
  store: StoreConnection,
  session: SessionId,
  run: RunId,
): Promise<readonly OwedCall[]> {
  const records = (await readCalls(store, session)).filter(
    (record) => record.run === run && record.kind !== "action",
  );

  const ids = new Set(records.map(stripHookPrefix));
  const parked = new Set<string>();

  for (const record of records)
    if (record.waiting !== null && record.result === null)
      for (const id of [stripHookPrefix(record), ...enclosingCalls(stripHookPrefix(record))])
        parked.add(id);

  const owes = (record: CallRecord): boolean =>
    record.result === null && !enclosingCalls(record.id).some((id) => ids.has(id));

  const opened = records.filter((record) => record.kind === "tool" && owes(record));

  const unopened = records
    .flatMap((record) =>
      record.kind === "intent" && owes(record) && toolIntents.Check(record.intent)
        ? [{ record, position: record.intent.position }]
        : [],
    )
    .toSorted((left, right) => left.position - right.position);

  return [...opened, ...unopened.map((entry) => entry.record)].map((record) => ({
    record,
    parked: parked.has(record.id),
  }));
}

export async function readToolInput(
  store: StoreConnection,
  session: SessionId,
  record: CallRecord,
): Promise<ToolInput | null> {
  if (record.kind === "intent") {
    if (!toolIntents.Check(record.intent)) return null;
    const { position: _position, ...input } = record.intent;

    return input;
  }

  if (record.part === null || !toolCallers.Check(record.intent)) return null;
  const caller: ToolCaller = record.intent;

  const found = await load(
    store,
    await store.refs.get(partRef(session, record.part)),
    decodePartRecord,
  );

  const checked = found === null ? null : await check(tool.state, found.record.state);

  return checked === null || checked.kind === "invalid"
    ? null
    : { ...caller, name: checked.value.name, args: checked.value.args };
}

function enclosingCalls(id: string): readonly string[] {
  const segments = id.split(":");

  return segments.slice(1).map((_segment, at) => segments.slice(0, at + 1).join(":"));
}

export function stoppableTool(kernel: Kernel): typeof tool {
  const actions: {
    readonly [A in keyof typeof tool.actions]: (
      input: Infer<(typeof tool.actions)[A]["input"]>,
      context: ActionContext<PartState<typeof tool>, typeof tool.actions>,
    ) => Awaitable<ActionOutput<(typeof tool.actions)[A]>>;
  } = {
    async stop(_input, context) {
      const running = runningCalls(kernel).get(context.part.id);

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

  const intent: ToolCaller = {
    principal: where.context.principal,
    ...(where.argumentsError !== undefined && { argumentsError: where.argumentsError }),
  };

  dev("tool", "call", { session, run, call, tool: where.name });
  const planned = await plan(kernel, where, intent);

  if (planned.kind === "parked") return PARKED;
  let concluded: Promise<Settled> | undefined;
  let before: ToolBaseline | null = null;

  const snapshotted =
    planned.kind === "execute" && where.covered !== true && planned.definition.effects !== "none";

  const step = await runStep<ToolOutcome>(kernel, {
    session,
    head,
    run,
    call,
    kind: "tool",
    replay: planned.kind === "execute" ? planned.definition.replay : "safe",
    intent,
    opening: { updates: () => partOpening(kernel.store, where, planned), fenced: STOPPED },
    part: asId<"part">(call),
    signal,
    body:
      planned.kind === "execute"
        ? async (durable) => {
            const executed = await execute(kernel, where, planned, durable, snapshotted);
            before = executed.before;

            return executed.outcome;
          }
        : async () => planned.outcome,
    async settle(ended) {
      concluded ??= conclude(kernel, where, ended, before, planned.class);
      const settled = await concluded;

      return {
        result: settled.outcome,
        updates: await settlement(kernel.store, where, planned, settled, before),
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
  intent: ToolCaller,
): Promise<Plan | typeof PARKED> {
  const { session, head, run, call, name } = where;
  const custom: ToolClass = { kind: "custom", label: name };
  const found = toolSource(where.runtime).get(name);
  const hidden = await hiddenOwners(kernel, session, run);
  const definition = found === undefined || hidden.has(found.owner) ? undefined : found.definition;

  if (definition === undefined) {
    const missing = found === undefined ? await missingCapabilities(kernel, session, run) : [];

    return {
      kind: "settle",
      outcome: failed(
        missing.length === 0
          ? `No tool is named ${name}.`
          : `${name} isn't available here: this chat uses ${missing.join(", ")}, which only Nyte.app has. Open Nyte.app to continue.`,
      ),
      args: where.args,
      class: custom,
    };
  }

  if (where.argumentsError !== undefined)
    return {
      kind: "settle",
      outcome: failed(`Invalid arguments for ${name}: ${where.argumentsError}`),
      args: where.args,
      class: custom,
    };

  const proposed: ToolCall = {
    call,
    name,
    args: where.args,
    class: classifyToolCall(definition, where.args, call) ?? custom,
  };

  const gated = await where.runtime.hooks.decide(
    "before_tool",
    proposed,
    { session, head, run, principal: intent.principal },
    { call: asId<"call">(`${HOOK}${call}`), run, head, part: null, signal: where.signal },
  );

  if (gated.kind === "parked") return PARKED;
  const gate = gated.kind === "done" ? gated.value : CONTINUE;

  if (where.signal.aborted && (await readCall(kernel.store, session, call))?.record.kind !== "tool")
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
  store: StoreConnection,
  where: Where,
  planned: Plan,
): Promise<readonly RefUpdate[]> {
  const { session, head, run, call } = where;
  const part = asId<"part">(call);
  const name = partRef(session, part);

  if ((await store.refs.get(name)) !== null) return [];
  const fields = { call, name: where.name, args: planned.args, class: planned.class };

  const record: PartRecord = {
    id: part,
    partKind: tool.kind,
    placement: STEP,
    state: { ...fields, phase: "running", progress: null },
    version: 2,
    owner: null,
    run,
    status: { kind: "live", run },
  };

  return [
    {
      name,
      target: await put(store, "part", record, Date.now()),
      expect: "absent",
      events: [
        {
          head,
          kind: "part",
          part,
          change: "created",
          partKind: tool.kind,
          placement: STEP,
          state: { ...fields, phase: "calling" },
          version: 1,
          run,
          owner: null,
        },
        {
          head,
          kind: "call",
          call,
          part,
          change: "intent",
        },
      ],
    },
  ];
}

async function execute(
  kernel: Kernel,
  where: Where & { readonly runtime: PluginRuntime },
  planned: Extract<Plan, { readonly kind: "execute" }>,
  durable: Durable,
  snapshotted: boolean,
): Promise<{ readonly outcome: ToolOutcome; readonly before: ToolBaseline | null }> {
  const { session, run, signal } = where;
  let before: ToolBaseline | null = null;

  try {
    if (snapshotted)
      before = await durable.memo("nyte:snapshot", () => baseline(kernel, session, run));

    const [env, found, hidden] = await Promise.all([
      kernel.environments.attach(session),
      requireSession(kernel.store, session),
      hiddenOwners(kernel, session, run),
    ]);

    const invocation = createInvocation(kernel, {
      hidden,
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
      covered: where.covered === true || snapshotted,
    });

    const result = await planned.definition.execute(planned.input, invocation);

    return {
      outcome: signal.aborted ? STOPPED : await validateToolResult(planned.definition, result),
      before,
    };
  } catch (error) {
    if (signalsPark(error)) throw error;

    return {
      outcome: signal.aborted
        ? STOPPED
        : failed(error instanceof Error ? error.message : String(error)),
      before,
    };
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
  before: ToolBaseline | null,
  toolClass: ToolClass,
): Promise<Settled> {
  const { session, head, run } = where;

  const outcome = await where.runtime.hooks.transform(
    "after_tool",
    ended.kind === "done" ? ended.value : INTERRUPTED,
    { session, head, run, principal: where.context.principal },
  );

  const snapshots =
    before !== null && ended.kind === "done" ? await kernel.environments.snapshots(session) : null;

  if (snapshots === null || before === null)
    return { outcome, files: null, thread: null, snapshot: null, path: null, unattributed: false };
  const to = await snapshots.after(run);
  const [changed, path] = await Promise.all([
    snapshots.diff(before.snapshot, to).then(fileChanges),
    editedPath(kernel, session, toolClass),
  ]);

  const unattributed =
    path === null &&
    changed.length > 0 &&
    (before.contended || (await anotherChatLive(kernel.store, session)));

  const files = unattributed
    ? []
    : changed.filter((file) => path === null || file.path === path || file.from === path);

  const thread =
    files.length === 0 && !unattributed
      ? null
      : fileChanges(
          await ownedChanges(
            kernel.store,
            snapshots,
            session,
            to,
            files.map((file) => file.path),
          ),
        );

  return { outcome, files, thread, snapshot: to, path, unattributed };
}

/** The workspace-relative file an edit names, or null when the call names none inside the workspace. */
async function editedPath(
  kernel: Kernel,
  session: SessionId,
  toolClass: ToolClass,
): Promise<string | null> {
  if (toolClass.kind !== "edit") return null;

  if (!/^(?:[\\/]|[A-Za-z]:)/.test(toolClass.path)) return toolClass.path.replace(/^\.\//, "");
  const root = (await kernel.environments.attach(session)).cwd.replace(/[\\/]+$/, "");

  return toolClass.path.startsWith(`${root}/`) || toolClass.path.startsWith(`${root}\\`)
    ? toolClass.path.slice(root.length + 1).replaceAll("\\", "/")
    : null;
}

function fileChanges(set: ChangeSet): readonly FileChange[] {
  return set.files.map((file): FileChange => {
    const change: FileChange = {
      path: file.path,
      status: file.status,
      added: file.stat.kind === "text" ? file.stat.added : 0,
      removed: file.stat.kind === "text" ? file.stat.removed : 0,
    };

    return file.from === undefined ? change : { ...change, from: file.from };
  });
}

async function settlement(
  store: StoreConnection,
  where: Where,
  planned: Plan,
  settled: Settled,
  before: ToolBaseline | null,
): Promise<readonly RefUpdate[]> {
  const { session, head, run, call } = where;
  const part = asId<"part">(call);
  const name = partRef(session, part);

  const [found, tip] = await Promise.all([
    store.refs.get(name).then((ref) => load(store, ref, decodePartRecord)),
    readTip(store, session, head),
  ]);

  if (found === null) return [];

  const counted =
    before === null || settled.path !== null
      ? new Set<string>()
      : await readAttributedPaths(
          store,
          session,
          before.seq,
          (event) => event.head === head && event.call !== call,
        );

  const files = settled.files?.filter((file) => !counted.has(file.path));

  const changes =
    files === undefined
      ? null
      : {
          added: files.reduce((sum, file) => sum + file.added, 0),
          removed: files.reduce((sum, file) => sum + file.removed, 0),
          paths: files.map((file) => file.path),
          ...(settled.unattributed && { unattributed: true as const }),
        };

  const at = Date.now();

  const state: Json = {
    call,
    name: where.name,
    args: planned.args,
    class: planned.class,
    phase: "settled",
    outcome: settled.outcome,
    changes,
  };

  const based =
    settled.snapshot === null ? [] : await nextBase(store, session, run, settled.snapshot);

  const record = { ...found.record, state, version: found.record.version + 1 };

  const logged: readonly DurableEvent[] = [
    {
      head,
      kind: "call",
      call,
      part,
      change: "settled",
      outcome: settled.outcome,
      changes,
    },
    ...(settled.thread === null
      ? []
      : [{ head: null, kind: "changes", files: settled.thread } as const]),
  ];

  if (found.record.status.kind === "failed" || found.record.status.kind === "settled")
    return [
      {
        name,
        target: await put(store, "part", record, at),
        expect: found.ref.revision,
        events: logged,
      },
      ...based,
    ];

  const landed = await settling(store, {
    session,
    head,
    run,
    parent: tip.id,
    expect: readRefExpectation(tip.ref),
    record,
    revision: found.ref.revision,
    logged,
    body: { kind: "part", part },
    at,
  });

  return [...landed.updates, ...based];
}

async function baseline(
  kernel: Kernel,
  session: SessionId,
  run: RunId,
): Promise<ToolBaseline | null> {
  const snapshots = await kernel.environments.snapshots(session);

  if (snapshots === null) return null;
  const seq = await kernel.store.refs.tail(session);
  const [before, contended] = await Promise.all([
    snapshots.after(run),
    anotherChatLive(kernel.store, session),
  ]);

  await attempt(`Recording run ${run}'s snapshot`, async () => {
    const found = await load(
      kernel.store,
      await kernel.store.refs.get(runRef(session, run)),
      decodeRunRecord,
    );

    if (found === null || found.record.snapshot !== null) return undefined;

    const outcome = await commit(kernel, [
      {
        name: found.ref.name,
        target: await put(kernel.store, "run", { ...found.record, snapshot: before }),
        expect: found.ref.revision,
      },
    ]);

    return outcome.kind === "set" ? undefined : STALE;
  });

  return { snapshot: before, seq, contended };
}

async function nextBase(
  store: StoreConnection,
  session: SessionId,
  run: RunId,
  to: SnapshotId,
): Promise<readonly RefUpdate[]> {
  const found = await load(store, await store.refs.get(runRef(session, run)), decodeRunRecord);

  if (found === null || found.record.lastSnapshot === to) return [];

  return [
    {
      name: found.ref.name,
      target: await put(store, "run", { ...found.record, lastSnapshot: to }),
      expect: found.ref.revision,
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
    readonly covered: boolean;
    readonly hidden?: ReadonlySet<string>;
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

  const source = toolSource(input.runtime);
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

        const outcome = await executeCall(kernel, {
          session,
          head,
          run,
          call: asId<"call">(`${call}:${key}`),
          name,
          args,
          context: input.context,
          runtime: input.runtime,
          covered: input.covered,
          signal:
            options?.signal === undefined ? signal : AbortSignal.any([signal, options.signal]),
        });

        return outcome.kind === "parked" ? parkStep(durable) : outcome;
      },
      list: () => source.list().filter((info) => input.hidden?.has(info.owner) !== true),
    },
    wait: (target) => durable.wait(target),
    memo: (name, compute) => durable.memo(name, compute),
    now: () => durable.now(),
  };
}
