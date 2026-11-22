import { Type } from "typebox";
import type { Static } from "typebox";
import {
  asId,
  compile,
  idSchema,
  isJson,
  JsonType,
  SdkError,
  ModelRefType,
  ToolOutcomeType,
  withJson,
} from "@nyte-ai/schema";
import type {
  Awaitable,
  CallId,
  Decision,
  DurableEvent,
  HeadName,
  Infer,
  Json,
  ModelRef,
  Placement,
  RefUpdate,
  RunId,
  SessionId,
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
import { decodePartRecord } from "../contract/records.ts";
import type { CallRecord, PartRecord } from "../contract/records.ts";
import type { Durable, ToolDefinition, ToolInvocation } from "../contract/tools.ts";
import type { ExecutionEnv } from "../contract/workspace.ts";
import { readAttributedPaths } from "../env/session-changes.ts";
import { callPhase } from "../engine/call-phase.ts";
import { signalsPark, parkStep, runStep } from "../engine/durable.ts";
import { startJob } from "../engine/jobs.ts";
import { publishPatch } from "../engine/runs.ts";
import { hiddenOwners, missingCapabilities, onlyNyteAppHas } from "./capabilities.ts";
import { baseline, nextBase, NO_CHANGES, toolChanges } from "./tool-snapshots.ts";
import type { ToolBaseline, ToolChanges } from "./tool-snapshots.ts";
import { loadedTools } from "./transcript.ts";
import { stepPluginApi } from "../extend/plugin-api.ts";
import { offeredTools, toolSource } from "../extend/registry.ts";
import { changesEvents } from "../fold/changes.ts";
import { withFold } from "../watch/reads.ts";
import { settling } from "../store/parts.ts";
import { partRef, runRef } from "../store/refs.ts";
import {
  load,
  put,
  readCall,
  readCalls,
  readRefExpectation,
  readTip,
  requireSession,
} from "../store/session.ts";
import { CLIP_CHARS, clipText } from "../util/clip.ts";
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
  model: Type.Optional(ModelRefType),
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
  | {
      readonly kind: "execute";
      readonly definition: ToolDefinition;
      readonly owner: string;
      readonly input: unknown;
    }
  | { readonly kind: "settle"; readonly outcome: ToolOutcome }
);

export type Settled = { readonly outcome: ToolOutcome } & ToolChanges;

interface Where {
  readonly session: SessionId;
  readonly head: HeadName;
  readonly run: RunId;
  readonly call: CallId;
  readonly name: string;
  readonly context: ConnectionContext;
  readonly signal: AbortSignal;
  readonly released?: AbortSignal;
  readonly argumentsError?: string;
  readonly covered?: boolean;
  readonly model?: ModelRef;
}

interface LiveCall {
  readonly stop: AbortController;
  readonly move: AbortController;
}

const HOOK = "hook:before_tool:";

const RUN_PREFIX = /^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}:/u;

const STEP: Placement = { kind: "transcript", role: "step" };

const PARKED = { kind: "parked" } as const;

const STOPPED: ToolOutcome = { kind: "stopped" };

const INTERRUPTED: ToolOutcome = { kind: "interrupted" };

const CONTINUE: Decision<ToolCall> = { action: "continue" };

const outcomes = compile(withJson(ToolOutcomeType));

const liveCalls = new WeakMap<Kernel, Map<string, Set<LiveCall>>>();

function runningCalls(kernel: Kernel): Map<string, Set<LiveCall>> {
  const found = liveCalls.get(kernel);

  if (found !== undefined) return found;
  const calls = new Map<string, Set<LiveCall>>();
  liveCalls.set(kernel, calls);

  return calls;
}

export async function executeCall(
  kernel: Kernel,
  input: Where & { readonly args: Json; readonly runtime: PluginRuntime },
): Promise<ToolOutcome | typeof PARKED> {
  const { session, call } = input;
  const controller = new AbortController();
  const running: LiveCall = { stop: controller, move: new AbortController() };
  const live = runningCalls(kernel);
  const controllers = live.get(call) ?? new Set<LiveCall>();
  controllers.add(running);
  live.set(call, controllers);

  const steps = await Promise.all([
    readCall(kernel.store, session, call),
    readCall(kernel.store, session, asId<"call">(`${HOOK}${call}`)),
  ]);

  if (steps.some((found) => found?.record.waits.some((outcome) => outcome.kind === "stopped"))) {
    controller.abort();
  }

  try {
    return await perform(kernel, {
      ...input,
      signal: AbortSignal.any([input.signal, controller.signal]),
      released: running.move.signal,
    });
  } finally {
    controllers.delete(running);

    if (controllers.size === 0 && live.get(call) === controllers) live.delete(call);
  }
}

export async function owedCalls(
  store: StoreConnection,
  session: SessionId,
  run: RunId,
): Promise<readonly OwedCall[]> {
  const records = (
    await readCalls(store, session, (id) => {
      const call = id.startsWith(HOOK) ? id.slice(HOOK.length) : id;

      return !RUN_PREFIX.test(call) || call.startsWith(`${run}:`);
    })
  )
    .filter((record) => record.run === run && record.kind !== "action")
    .map((record) => ({ record, phase: callPhase(record) }));

  const ids = new Set(records.map((entry) => stripHookPrefix(entry.record)));

  const parked = new Set(
    records.flatMap((entry) => {
      const id = stripHookPrefix(entry.record);

      return entry.phase.kind === "parked" ? [id, ...enclosingCalls(id)] : [];
    }),
  );

  const owed = records.filter(
    (entry) =>
      entry.phase.kind !== "settled" && !enclosingCalls(entry.record.id).some((id) => ids.has(id)),
  );

  const intended = owed
    .flatMap((entry) =>
      entry.phase.kind === "intended" && toolIntents.Check(entry.record.intent)
        ? [{ record: entry.record, position: entry.record.intent.position }]
        : [],
    )
    .toSorted((left, right) => left.position - right.position);

  return [
    ...owed.flatMap((entry) => (entry.record.kind === "tool" ? [entry.record] : [])),
    ...intended.map((entry) => entry.record),
  ].map((record) => ({ record, parked: parked.has(record.id) }));
}

export async function readToolInput(
  store: StoreConnection,
  session: SessionId,
  record: CallRecord,
): Promise<ToolInput | null> {
  if (callPhase(record).kind === "intended") {
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
        for (const live of running) live.stop.abort();

        return undefined;
      }

      for (const call of [context.part.id, `${HOOK}${context.part.id}`]) {
        await kernel.waits.callStopped(context.session, asId<"call">(call));
      }

      return undefined;
    },
    background(_input, context) {
      if (!kernel.jobs.release(context.session, asId<"call">(context.part.id))) return undefined;

      for (const live of runningCalls(kernel).get(context.part.id) ?? []) live.move.abort();

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
    planned.kind === "execute" && where.covered !== true && planned.definition.changes !== "none";

  const step = await runStep<ToolOutcome>(kernel, {
    session,
    head,
    run,
    call,
    kind: "tool",
    replay: planned.kind === "execute" ? planned.definition.rerun : "safe",
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
      if ((await kernel.store.refs.get(runRef(session, run))) === null) {
        return { result: STOPPED, updates: [] };
      }
      concluded ??= conclude(kernel, where, ended, before, planned.class);
      const settled = await concluded;

      return {
        result: settled.outcome,
        updates: await settlement(kernel, where, planned, settled, before),
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
  const shown = found === undefined || hidden.has(found.owner) ? undefined : found;

  if (shown === undefined) {
    const missing = found === undefined ? await missingCapabilities(kernel, session, run) : [];

    return {
      kind: "settle",
      outcome: failed(
        missing.length === 0 ? `No tool is named ${name}.` : onlyNyteAppHas(name, missing),
      ),
      args: where.args,
      class: custom,
    };
  }

  const definition = shown.definition;

  if (where.argumentsError !== undefined) {
    return {
      kind: "settle",
      outcome: failed(`Invalid arguments for ${name}: ${where.argumentsError}`),
      args: where.args,
      class: custom,
    };
  }

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

  if (where.signal.aborted) {
    const found = await readCall(kernel.store, session, call);

    if (found === null || callPhase(found.record).kind === "intended") {
      return { kind: "settle", outcome: STOPPED, args: where.args, class: proposed.class };
    }
  }

  if (gate.action === "reject") {
    return {
      kind: "settle",
      outcome: { kind: "rejected", reason: gate.reason },
      args: where.args,
      class: proposed.class,
    };
  }

  if (gate.action === "error") {
    return {
      kind: "settle",
      outcome: failed(gate.message),
      args: where.args,
      class: proposed.class,
    };
  }
  const args = gate.action === "modify" ? gate.value.args : where.args;
  const checked = await definition.parameters["~standard"].validate(args);

  if (checked.issues !== undefined) {
    return {
      kind: "settle",
      outcome: failed(
        `Invalid arguments for ${name}: ${checked.issues.map((issue) => issue.message).join("; ")}`,
      ),
      args,
      class: custom,
    };
  }
  const known = classifyToolCall(definition, checked.value, call);

  if (known === null) {
    return {
      kind: "settle",
      outcome: failed(`${name} could not classify its call.`),
      args,
      class: custom,
    };
  }

  return {
    kind: "execute",
    definition,
    owner: shown.owner,
    input: checked.value,
    args,
    class: known,
  };
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
    model: where.model,
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
          model: where.model,
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
    if (snapshotted) {
      before = await durable.memo("nyte:snapshot", () =>
        baseline(kernel, session, run, planned.class),
      );
    }

    const [env, found, hidden] = await Promise.all([
      kernel.environments.attach(session),
      requireSession(kernel.store, session),
      hiddenOwners(kernel, session, run),
    ]);

    const invocation = createInvocation(kernel, {
      hidden,
      owner: planned.owner,
      session,
      head: where.head,
      run,
      call: where.call,
      context: where.context,
      signal,
      released: where.released,
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

  if (definition.output === undefined) {
    return {
      kind: "ok",
      content: result.content,
      output: isJson(result.output) ? result.output : null,
      parts,
    };
  }

  const checked = await definition.output["~standard"].validate(result.output);

  if (checked.issues !== undefined) {
    return failed(`${definition.name} returned output its schema rejects.`);
  }

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

  const outcome = clipOutcome(
    await where.runtime.hooks.transform(
      "after_tool",
      ended.kind === "done" ? ended.value : INTERRUPTED,
      { session, head, run, principal: where.context.principal },
    ),
  );

  return before === null || ended.kind !== "done"
    ? { outcome, ...NO_CHANGES }
    : { outcome, ...(await toolChanges(kernel, session, before, toolClass)) };
}

function clipOutcome(outcome: ToolOutcome): ToolOutcome {
  if (outcome.kind === "failed") return { ...outcome, message: clipText(outcome.message, "ends") };

  if (outcome.kind === "rejected") return { ...outcome, reason: clipText(outcome.reason, "ends") };

  if (outcome.kind !== "ok") return outcome;

  if (outcome.content.length === 0) {
    const json = JSON.stringify(outcome.output);

    return json.length <= CLIP_CHARS
      ? outcome
      : { ...outcome, content: [{ kind: "text", text: clipText(json, "head") }] };
  }

  const texts = outcome.content.flatMap((item) => (item.kind === "text" ? [item.text] : []));

  if (texts.reduce((total, text) => total + text.length, 0) <= CLIP_CHARS) return outcome;

  return {
    ...outcome,
    content: [
      { kind: "text", text: clipText(texts.join("\n"), "ends") },
      ...outcome.content.filter((item) => item.kind !== "text"),
    ],
  };
}

export async function settlement(
  kernel: Kernel,
  where: Pick<Where, "session" | "head" | "run" | "call" | "name">,
  planned: Pick<Plan, "args" | "class">,
  settled: Settled,
  before: ToolBaseline | null,
): Promise<readonly RefUpdate[]> {
  const { session, head, run, call } = where;
  const store = kernel.store;
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
      : changesEvents(await withFold(kernel, session, (state) => state.changes), settled.thread)),
  ];

  if (found.record.status.kind === "failed" || found.record.status.kind === "settled") {
    return [
      {
        name,
        target: await put(store, "part", record, at),
        expect: found.ref.revision,
        events: logged,
      },
      ...based,
    ];
  }

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
    readonly released?: AbortSignal;
    readonly workspace: WorkspaceId;
    readonly env: ExecutionEnv;
    readonly durable: Durable;
    readonly runtime: PluginRuntime;
    readonly owner: string;
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
    host: sdk,
    get api() {
      const own = input.runtime.api(input.owner);

      if (own === undefined) {
        throw new SdkError(
          "unavailable",
          `Plugin ${input.owner} is no longer active in session ${session}.`,
        );
      }

      return stepPluginApi(kernel, own, context, session);
    },
    workspace: sdk.workspace(input.workspace),
    env: input.env,
    progress(update) {
      publishPatch(kernel, session, run, {
        kind: "patch",
        part: asId<"part">(call),
        progress: update,
      });
    },
    foreground: {
      start: (job) =>
        signal.aborted
          ? Promise.reject(new SdkError("unavailable", `Call ${call} was stopped.`))
          : startJob(kernel, context.origin, input.workspace, { ...job, session }, true),
      release: () => kernel.jobs.release(session, call),
      released: input.released ?? new AbortController().signal,
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
      list: () =>
        offeredTools(
          input.runtime,
          source.list().filter((info) => input.hidden?.has(info.owner) !== true),
          { session, head, run, principal: input.context.principal },
          signal,
        ),
      loaded: () => loadedTools(kernel, source, { session, head, run }),
    },
    wait: (target) => durable.wait(target),
    memo: (name, compute) => durable.memo(name, compute),
    now: () => durable.now(),
  };
}
