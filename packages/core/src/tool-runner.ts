import { ToolOutcomeType, asId, isJson, withJson } from "@nyte-ai/schema";
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
  ToolInfo,
  ToolOutcome,
  ToolPartState,
  ToolResult,
} from "@nyte-ai/schema";
import { Compile } from "typebox/compile";
import { settling } from "./transcript.ts";
import { isParked, runStep } from "./durable.ts";
import type { StepEnd } from "./durable.ts";
import { dev } from "./dev-log.ts";
import { createInvocation } from "./invocation.ts";
import type { Kernel } from "./kernel.ts";
import { sessionOfPart } from "./part-handle.ts";
import type { PluginRuntime } from "./plugin-runtime.ts";
import { definePart, tool } from "./parts.ts";
import type { ActionContext, ActionOutput } from "./parts.ts";
import type { ConnectionContext } from "./principals.ts";
import { decodeChangesRecord, decodePartRecord, decodeRunRecord } from "./records.ts";
import type { CallRecord, PartRecord } from "./records.ts";
import { changesRef, partRef, runRef } from "./refs.ts";
import { unfenced } from "./runs.ts";
import {
  STALE,
  attempt,
  changeCall,
  commit,
  expectOf,
  isJsonObject,
  load,
  put,
  readCall,
  readCalls,
  readTip,
  requireSession,
} from "./session-state.ts";
import type { Durable, ToolDefinition } from "./tools.ts";

/** Resolves the tools a session can call in one run: what `executeCall` looks up and an invocation's `tools` lists and activates; `kernel.tools(runtime, run)` fills it from a runtime's registries. */
export interface ToolSource {
  /** Returns the tool a name resolves to with the plugin that contributed it, or undefined when the session has none by that name. */
  get(name: string): { readonly definition: ToolDefinition; readonly owner: string } | undefined;
  /** Returns the session's tools with output schemas and exposure, deferred ones marked. */
  list(): readonly ToolInfo[];
  /** Brings deferred tools into the declared set for the rest of the run. */
  activate(names: readonly string[]): Promise<void>;
}

/** Returns what a tool call's step records as its intent before `execute`: the tool's name, its arguments, and the principal the call runs as. */
export type ToolIntent = {
  readonly name: string;
  readonly args: Json;
  readonly principal: PrincipalId;
};

/** Returns what a call does once its definition, `before_tool` and arguments are settled: execute the tool, or settle at once with an outcome decided before it ran. */
type Plan = { readonly args: Json; readonly class: ToolClass } & (
  | { readonly kind: "execute"; readonly definition: ToolDefinition; readonly input: unknown }
  | { readonly kind: "settle"; readonly outcome: ToolOutcome }
);

/** Returns what a call settles with: its outcome after `after_tool`, the line counts and paths it changed, and the files for the session's `changes`. */
interface Settled {
  readonly outcome: ToolOutcome;
  readonly changes: {
    readonly added: number;
    readonly removed: number;
    readonly paths: readonly string[];
  } | null;
  readonly files: readonly FileChange[];
  /** The snapshot after the call, the run's next diff base; null when the call did not diff. */
  readonly snapshot: SnapshotId | null;
}

type ToolActions = (typeof tool)["actions"];

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

const outcomes = Compile(withJson(ToolOutcomeType));

/** Returns the tool intent a call record's `intent` holds, or null when it holds another shape. */
export function decodeToolIntent(value: Json): ToolIntent | null {
  if (!isJsonObject(value) || !("args" in value)) return null;
  const { name, args, principal } = value;

  return typeof name === "string" && typeof principal === "string"
    ? { name, args, principal: asId<"principal">(principal) }
    : null;
}

/**
 * Runs one tool call to its outcome, or parks it: `before_tool` through `kernel.beforeTool` (§35a),
 * the arguments validated, the tool part opened with `call intent`, then `execute` as a durable step
 * of kind `tool` that settles the part, the head commit and the session's `changes` in one set. The
 * tool resolves on `runtime`, the one the call's request holds (§63). The call runs
 * under its own abort controller, so the part's `stop` aborts it alone.
 */
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

/** Runs a nested `tools.execute` from the step `call` as the call `<call>:<key>`, its outcome recorded in and replayed from the parent's `nested[key]`. */
export async function executeNested(
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

/** Returns a run's tool calls that have not settled, read from their step records: each with its intent and whether it is parked (its step, its `before_tool` hook or a call nested under it waits). A nested call is its parent's to re-run. */
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

  const ids = [...new Set(records.map(callOf))];

  return ids.flatMap((id) => {
    if (ids.some((other) => id.startsWith(`${other}:`))) return [];
    const own = records.filter((record) => callOf(record) === id);
    const step = own.find((record) => record.kind === "tool");

    if (step !== undefined && step.result !== null) return [];
    const intent = decodeToolIntent((step ?? own[0]).intent);

    if (intent === null) return [];

    const parked = records.some(
      (record) =>
        record.waiting !== null &&
        record.result === null &&
        (callOf(record) === id || callOf(record).startsWith(`${id}:`)),
    );

    return [{ call: asId<"call">(id), intent, parked }];
  });
}

/** Returns the `tool` built-in with its `stop` action wired, for the kernel's part definitions to hold in place of the plain one: stopping a tool part aborts that call's signal when it runs in this process, or else wakes the wait it, its `before_tool` hook or a call nested under it is parked on with `stopped`; either way the call settles `stopped`. */
export function stoppableTool(kernel: Kernel): typeof tool {
  const actions: {
    readonly [A in keyof ToolActions]: (
      input: Infer<ToolActions[A]["input"]>,
      context: ActionContext<ToolPartState, ToolActions>,
    ) => Awaitable<ActionOutput<ToolActions[A]>>;
  } = {
    async stop(_input, context) {
      const running = kernel.calls.get(context.part.id);

      if (running !== undefined && running.size > 0) {
        for (const controller of running) controller.abort();

        return undefined;
      }

      const session = sessionOfPart(context.part);

      if (session === undefined) return undefined;

      for (const call of [context.part.id, `${HOOK}${context.part.id}`])
        await kernel.waits.callStopped(session, asId<"call">(call));

      return undefined;
    },
  };

  return definePart({
    ...tool,
    onAction: (action, input, context) => actions[action](input, context),
  });
}

/** Plans the call, opens its part with `call intent`, and runs or settles it as a durable step of kind `tool`; returns the recorded outcome. */
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

/** Resolves the definition, runs `before_tool` through `kernel.beforeTool`, and validates the arguments it leaves; parked when the hook parks. */
async function plan(
  kernel: Kernel,
  where: Where & { readonly args: Json; readonly runtime: PluginRuntime },
  intent: ToolIntent,
): Promise<Plan | typeof PARKED> {
  const { session, head, run, call, name } = where;
  const custom: ToolClass = { kind: "custom", label: name };
  const definition = kernel.tools(where.runtime, run).get(name)?.definition;

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
    class: classOf(definition, where.args, call) ?? custom,
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
  const known = classOf(definition, checked.value, call);

  if (known === null)
    return {
      kind: "settle",
      outcome: failed(`${name} could not classify its call.`),
      args,
      class: custom,
    };

  return { kind: "execute", definition, input: checked.value, args, class: known };
}

/** Returns the updates writing the tool part, phase `calling`, and its `call intent` (phase `running`), expecting its run unfenced (§61); none when the part exists or the run is stopping. They land with the step's record. */
async function partOpening(
  kernel: Kernel,
  where: Where,
  planned: Plan,
): Promise<readonly RefUpdate[]> {
  const { session, head, run, call } = where;
  const part = asId<"part">(call);
  const name = partRef(session, part);

  const [existing, held] = await Promise.all([
    kernel.store.refs.get(name),
    unfenced(kernel, session, run),
  ]);

  if (existing !== null || held === null) return [];
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

  return [
    held,
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
}

/** Runs the tool's `execute` with its invocation, a call that may write taking the run's first snapshot first, and returns the outcome: output validated, throws as `failed`, an aborted signal as `stopped`. */
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

    return signal.aborted ? STOPPED : await outcomeOf(planned.definition, result);
  } catch (error) {
    if (isParked(error)) throw error;

    return signal.aborted ? STOPPED : failed(messageOf(error));
  }
}

/** Returns a returned result as an outcome: `ok` with its content, output and parts, or `failed` when its output fails the definition's output schema. */
async function outcomeOf(
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

/** Returns what a call settles with: `after_tool` over its outcome, and the changes a call that may write made since the run's last snapshot. */
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

/** Returns the updates that settle a call's part: its settled state with `call settled`, then, unless its run's stop fence failed it, `part settled` and the head commit, plus the run's next diff base and the session's merged `changes` when files changed. */
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

  if (found.record.status.kind === "failed") {
    const target = await put(kernel, "part", record, at);

    return [opened(target), ...based, ...merged];
  }

  const landed = await settling(kernel, {
    session,
    head,
    run,
    parent: tip.id,
    expect: expectOf(tip.ref),
    record,
    body: { kind: "part", part },
    at,
  });

  return [opened(landed.target), ...landed.updates, ...based, ...merged];
}

/** Takes the run's first snapshot before a call that may write, once per run, into `RunRecord.snapshot`. */
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

/** Returns the snapshot a run's next write-class call diffs from, as its record keeps it: its last such call's, else its first; null before the first. */
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

/** Returns the update that makes `to` the run's diff base, or none once the run ended or when it is already. */
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

/** Returns the update merging `files` into the session's changes record, latest per path in first-seen order, with `changes` carrying the whole list; it expects the record as read, so a concurrent merge makes the settlement read and merge again. */
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
      expect: expectOf(ref),
      event: { head: null, kind: "changes", files: merged },
    },
  ];
}

/** Returns what a tool's class says about its call, or null when the class function throws. */
function classOf(definition: ToolDefinition, args: unknown, call: CallId): ToolClass | null {
  try {
    return definition.class(args, { call });
  } catch {
    return null;
  }
}

/** Returns whether a call of this class may change files, so its changes are diffed. */
function writes(klass: ToolClass): boolean {
  return klass.kind !== "read" && klass.kind !== "list";
}

/** Returns the tool call a step record belongs to: a `before_tool` hook's call, else its own id. */
function callOf(record: CallRecord): string {
  return record.kind === "hook" && record.id.startsWith(HOOK)
    ? record.id.slice(HOOK.length)
    : record.id;
}

/** Returns a failed outcome. */
function failed(message: string): ToolOutcome {
  return { kind: "failed", message };
}

/** Returns an error's message, or the thrown value as text. */
function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
