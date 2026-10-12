import { ToolClassType, asId } from "@nyte-ai/schema";
import type {
  Awaitable,
  CallId,
  Decision,
  Disposer,
  HeadName,
  Json,
  PartId,
  PrincipalId,
  RunId,
  SessionId,
  Submission,
  ToolCall,
} from "@nyte-ai/schema";
import { Compile } from "typebox/compile";
import { isParked, runStep } from "./durable.ts";
import type { StepOutcome } from "./durable.ts";
import { dev } from "./dev-log.ts";
import { SdkError } from "./error.ts";
import type { AdmissionGate, Kernel } from "./kernel.ts";
import type { HookEntry, HookHandler, HookName, HookTable, PluginApi } from "./plugin.ts";
import { stepPluginApi } from "./plugin-api.ts";
import { CORE_CONTEXT } from "./principals.ts";
import type { ConnectionContext } from "./principals.ts";
import { callRef } from "./refs.ts";
import { commit, isJsonObject, readCall } from "./session-state.ts";
import type { Durable } from "./tools.ts";

/** Names the core hooks of one phase. */
export type CoreHook<Phase extends HookTable[keyof HookTable]["phase"]> = {
  [N in HookName<"core">]: HookTable[N & keyof HookTable]["phase"] extends Phase ? N : never;
}[HookName<"core">];

/** Returns what a core hook receives: for transform and decide, also the value it returns or modifies. */
export type HookEvent<N extends HookName<"core">> = HookTable[N & keyof HookTable]["event"];

/** Returns where an operation dispatches a hook: the session, the head and run it acts on, and the principal acting. Handlers see the session, head and run. */
export interface HookContext {
  readonly session: SessionId;
  readonly head: HeadName | null;
  readonly run: RunId | null;
  readonly principal: PrincipalId;
}

/** Returns the durable step a decide dispatch runs as: its call id, keyed by what it gates (§33k: `hook:before_tool:<call>`, `hook:before_send:<message>`), where it runs, and the signal that stops its waits. */
export interface HookStep {
  readonly call: CallId;
  readonly run: RunId | null;
  readonly head: HeadName | null;
  readonly part: PartId | null;
  readonly signal: AbortSignal;
}

/** Holds one session's hook handlers and dispatches them by phase. */
export interface HookDispatch {
  /** Adds a plugin's handler under a hook; the disposer removes it. A handler added while a dispatch runs joins the next one. */
  register<N extends HookName<"core">>(
    plugin: string,
    name: N,
    entry: HookEntry<"core", N>,
  ): Disposer;
  /** Runs every handler in order, each awaited by the dispatcher; the operation does not await the promise, which never rejects. A throw or an exceeded budget is reported as an issue against the handler's plugin, and the next handler runs. */
  observe<N extends CoreHook<"observe">>(
    name: N,
    event: HookEvent<N>,
    context: HookContext,
  ): Promise<void>;
  /** Chains the value through every handler in order, each seeing the previous result, and resolves the last; with none registered, `value` as given. A throw or an exceeded budget fails the operation: rejects `SdkError("internal")` naming the plugin. */
  transform<N extends CoreHook<"transform">>(
    name: N,
    value: HookEvent<N>,
    context: HookContext,
  ): Promise<HookEvent<N>>;
  /** Runs the handlers as one durable step of kind `hook` at `step.call`, replay safe, its intent the event with the context's principal (so a `before_tool` step decodes as a `ToolIntent`); each handler gets the step's `Durable`, and its plugin's api with `session` and `sdk` acting from the step (§35i: origin `{ session, run, head, call, sequence }`, one `sequence` per execution shared by the handlers in order), so a part or session a handler creates is the step's acquisition and comes back on a re-run, `before_send`'s included (its origin has no run or head). In order: `continue` passes on, `modify` replaces the value later handlers see, `reject` short-circuits, `error` fails; a throw or an exceeded budget is `error` naming the plugin, the budget covering compute, not the park. Resolves `done` with the recorded decision (`modify` with the last value when any handler modified, else `continue`), replayed on a re-run, or `parked` when a handler parked, for the caller to wait on the wake: the turn driver returns, admission waits in process as `runAction` does. With no handler registered and no step recorded at `step.call`, resolves `done` with `continue` and writes nothing. */
  decide<N extends CoreHook<"decide">>(
    name: N,
    value: HookEvent<N>,
    context: HookContext,
    step: HookStep,
  ): Promise<StepOutcome<Decision<HookEvent<N>>>>;
}

/** Returns what every handler's context carries besides a decide hook's `Durable`. */
type Base = {
  readonly api: PluginApi<"core">;
  readonly signal: AbortSignal;
  readonly session: SessionId | null;
  readonly head: HeadName | null;
  readonly run: RunId | null;
};

/** Returns one registered handler: its plugin, order and registration sequence. */
interface Handler<N extends HookName<"core">> {
  readonly plugin: string;
  readonly order: number;
  readonly sequence: number;
  readonly run: HookHandler<"core", N>;
}

/** Returns how one decide hook is dispatched and recorded: the handler call, the step's intent, and the decision read back from its record. */
interface Decider<N extends CoreHook<"decide">> {
  invoke(
    run: HookHandler<"core", N>,
    event: HookEvent<N>,
    context: Base & Durable,
  ): Awaitable<Decision<HookEvent<N>>>;
  intent(event: HookEvent<N>, principal: PrincipalId): Json;
  encode(decision: Decision<HookEvent<N>>): Json;
  decode(result: Json): Decision<HookEvent<N>> | null;
}

const CONTINUE = { action: "continue" } as const;

const NEVER = new AbortController().signal;

const classes = Compile(ToolClassType);

/** Calls each observe hook's handler with its context: one entry per hook, so a call indexed by a generic hook name is typed by that hook. */
type Observers = {
  readonly [N in CoreHook<"observe">]: (
    run: HookHandler<"core", N>,
    event: HookEvent<N>,
    context: Base,
  ) => Awaitable<void>;
};

/** Calls each transform hook's handler with its context and returns its result, typed by its hook as `Observers` is. */
type Transformers = {
  readonly [N in CoreHook<"transform">]: (
    run: HookHandler<"core", N>,
    value: HookEvent<N>,
    context: Base,
  ) => Awaitable<HookEvent<N>>;
};

/** Dispatches and records each decide hook, typed by its hook as `Observers` is. */
type Deciders = { readonly [N in CoreHook<"decide">]: Decider<N> };

/** Holds every core hook's registered handlers. */
type Handlers = { [N in HookName<"core">]: Handler<N>[] };

const observers: Observers = {
  session_activated: (run, event, context) => run(event, context),
  run_started: (run, event, context) => run(event, context),
  after_request: (run, event, context) => run(event, context),
  run_ended: (run, event, context) => run(event, context),
};

const transformers: Transformers = {
  transform_context: (run, value, context) => run(value, context),
  transform_transcript: (run, value, context) => run(value, context),
  before_compaction: (run, value, context) => run(value, context),
  before_request: (run, value, context) => run(value, context),
  after_tool: (run, value, context) => run(value, context),
};

const deciders: Deciders = {
  before_send: {
    invoke: (run, event, context) => run(event, context),
    intent: (event, principal) => ({ ...event, principal }),
    encode: (decision) => decision,
    decode: (result) => decodeDecision(result, (value) => (isSubmission(value) ? value : null)),
  },
  before_tool: {
    invoke: (run, event, context) => run(event, context),
    intent: (event, principal) => ({ ...event, principal }),
    encode: (decision) => decision,
    decode: (result) => decodeDecision(result, decodeToolCall),
  },
};

/** Returns a session's empty hook dispatch. Handlers run by ascending `order` (default 0), then registration sequence; each gets its plugin's api (`kernel.pluginsFor(session).api(plugin)`), the context's session, head and run, and a signal that fires at its budget (5 s; `before_compaction` 300 s) or when its plugin deactivates. */
export function createHookDispatch(kernel: Kernel, session: SessionId): HookDispatch {
  const handlers = emptyHandlers();
  let sequence = 0;

  const ordered = <N extends HookName<"core">>(name: N): readonly Handler<N>[] =>
    [...handlers[name]].sort(
      (left, right) => left.order - right.order || left.sequence - right.sequence,
    );

  const base = (api: PluginApi<"core">, signal: AbortSignal, context: HookContext): Base => ({
    api,
    signal,
    session: context.session,
    head: context.head,
    run: context.run,
  });

  const apiOf = (plugin: string): PluginApi<"core"> | undefined =>
    kernel.pluginsFor(session).api(plugin);

  return {
    register(plugin, name, entry) {
      const handler: Handler<typeof name> = {
        plugin,
        order: typeof entry === "function" ? 0 : (entry.order ?? 0),
        sequence,
        run: typeof entry === "function" ? entry : entry.run,
      };

      sequence += 1;
      handlers[name].push(handler);

      return () => {
        const list = handlers[name];
        const index = list.indexOf(handler);

        if (index >= 0) list.splice(index, 1);
      };
    },
    async observe(name, event, context) {
      dev("hooks", name, { session, handlers: handlers[name].length });

      for (const handler of ordered(name)) {
        const api = apiOf(handler.plugin);

        if (api === undefined) continue;

        try {
          await budgeted(name, api.signal, (signal) =>
            observers[name](handler.run, event, base(api, signal, context)),
          );
        } catch (error) {
          api.report({
            severity: "error",
            path: ["hooks", name],
            message: failure(handler.plugin, name, error),
          });
        }
      }
    },
    async transform(name, value, context) {
      dev("hooks", name, { session, handlers: handlers[name].length });
      let current = value;

      for (const handler of ordered(name)) {
        const api = apiOf(handler.plugin);

        if (api === undefined) continue;

        try {
          current = await budgeted(name, api.signal, (signal) =>
            transformers[name](handler.run, current, base(api, signal, context)),
          );
        } catch (error) {
          throw new SdkError("internal", failure(handler.plugin, name, error));
        }
      }

      return current;
    },
    async decide(name, value, context, step) {
      const decider = deciders[name];
      const chain = ordered(name);

      if (chain.length === 0 && (await readCall(kernel, context.session, step.call)) === null)
        return { kind: "done", value: CONTINUE };

      return runStep<Decision<HookEvent<typeof name>>>(kernel, {
        session: context.session,
        head: step.head,
        run: step.run,
        call: step.call,
        kind: "hook",
        replay: "safe",
        intent: decider.intent(value, context.principal),
        part: step.part,
        signal: step.signal,
        async body(durable) {
          const acting = stepContext(context.session, step);
          let current = value;
          let modified = false;

          for (const handler of chain) {
            const shared = apiOf(handler.plugin);

            if (shared === undefined) continue;
            const api = stepPluginApi(kernel, shared, acting, context.session);

            let decision: Decision<HookEvent<typeof name>>;

            try {
              decision = await budgeted(name, api.signal, (signal) =>
                decider.invoke(handler.run, current, { ...base(api, signal, context), ...durable }),
              );
            } catch (error) {
              if (isParked(error)) throw error;

              return { action: "error", message: failure(handler.plugin, name, error) };
            }

            dev("hooks", name, { session, plugin: handler.plugin, decision: decision.action });

            if (decision.action === "reject" || decision.action === "error") return decision;

            if (decision.action === "modify") {
              current = decision.value;
              modified = true;
            }
          }

          return modified ? { action: "modify", value: current } : CONTINUE;
        },
        settle: async (ended) => ({
          result: decider.encode(ended.kind === "done" ? ended.value : CONTINUE),
          updates: [],
        }),
        decode: (result) => decider.decode(result),
      });
    },
  };
}

/** Returns whether a name is a core hook: what installing a plugin's declared `hooks` iterates by. */
export function isCoreHook(name: string): name is HookName<"core"> {
  return (
    Object.hasOwn(observers, name) ||
    Object.hasOwn(transformers, name) ||
    Object.hasOwn(deciders, name)
  );
}

/** Dispatches `before_send` for a submission as the durable step `hook:before_send:<message>`, outside any run or head, and waits in process while it is parked, running it again on each wake, as `runAction` does: what the kernel's `admit` runs. A revision of a pending message (`replace` is the message itself) first forgets the decision its earlier version recorded. */
export async function gateSubmission(
  kernel: Kernel,
  submission: Submission,
  context: Parameters<AdmissionGate>[1],
): Promise<Decision<Submission>> {
  const { session } = context;
  const call = asId<"call">(`hook:before_send:${context.message}`);

  if (submission.replace === context.message) {
    const found = await readCall(kernel, session, call);

    if (found !== null && found.record.result !== null)
      await commit(kernel, [
        { name: callRef(session, call), target: null, expect: found.ref.revision },
      ]);
  }

  let woken = Promise.withResolvers<void>();
  const dispose = kernel.waits.onWoken(session, call, () => woken.resolve());

  try {
    for (;;) {
      woken = Promise.withResolvers<void>();

      const outcome = await kernel
        .pluginsFor(session)
        .hooks.decide(
          "before_send",
          submission,
          { session, head: context.head, run: context.run, principal: context.principal },
          { call, run: null, head: null, part: null, signal: NEVER },
        );

      if (outcome.kind === "done") return outcome.value;

      if (outcome.kind === "interrupted") return CONTINUE;
      await woken.promise;
    }
  } finally {
    dispose();
  }
}

/** Returns the connection a decide step's handlers act from, for one execution: `CORE_CONTEXT` (participant and owner, the plugin apis' authority) with its origin the step (its run and head null outside them, as `before_send`'s), and a fresh acquisition counter. */
function stepContext(session: SessionId, step: HookStep): ConnectionContext {
  const { run, head, call } = step;
  let acquisitions = 0;

  return {
    ...CORE_CONTEXT,
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
}

/** Runs one handler under its budget and its plugin's deactivation: resolves what it returns, or rejects once 5 s pass (`before_compaction` 300 s) or the plugin deactivates; the handler's signal fires at either. */
async function budgeted<T>(
  name: HookName<"core">,
  deactivated: AbortSignal,
  run: (signal: AbortSignal) => Awaitable<T>,
): Promise<T> {
  const seconds = name === "before_compaction" ? 300 : 5;
  const budget = new AbortController();
  const ended = Promise.withResolvers<never>();

  const timer = setTimeout(() => {
    budget.abort();
    ended.reject(new Error(`exceeded its ${seconds} s budget`));
  }, seconds * 1000);

  const deactivate = (): void => ended.reject(new Error("was deactivated"));
  deactivated.addEventListener("abort", deactivate, { once: true });

  try {
    return await Promise.race([
      Promise.resolve().then(() => run(AbortSignal.any([budget.signal, deactivated]))),
      ended.promise,
    ]);
  } finally {
    clearTimeout(timer);
    deactivated.removeEventListener("abort", deactivate);
  }
}

/** Returns a handler failure as one sentence naming the plugin and the hook. */
function failure(plugin: string, name: HookName<"core">, error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);

  return `Plugin ${plugin}'s ${name} handler failed: ${reason}`;
}

/** Returns an empty handler list per core hook. */
function emptyHandlers(): Handlers {
  return {
    session_activated: [],
    before_send: [],
    run_started: [],
    transform_context: [],
    transform_transcript: [],
    before_compaction: [],
    before_request: [],
    before_tool: [],
    after_tool: [],
    after_request: [],
    run_ended: [],
  };
}

/** Returns the decision a decide step's result holds, reading a `modify` value with `value`; null when it holds another shape. */
function decodeDecision<V>(result: Json, value: (json: Json) => V | null): Decision<V> | null {
  if (!isJsonObject(result)) return null;

  switch (result.action) {
    case "continue":
      return CONTINUE;
    case "modify": {
      const modified = result.value === undefined ? null : value(result.value);

      return modified === null ? null : { action: "modify", value: modified };
    }

    case "reject":
      return typeof result.reason === "string" ? { action: "reject", reason: result.reason } : null;
    case "error":
      return typeof result.message === "string"
        ? { action: "error", message: result.message }
        : null;
    default:
      return null;
  }
}

/** Returns the tool call a recorded `before_tool` value holds, or null when it holds another shape. */
function decodeToolCall(value: Json): ToolCall | null {
  if (!isJsonObject(value)) return null;
  const { call, name, args } = value;
  const klass = value.class;

  if (typeof call !== "string" || typeof name !== "string" || args === undefined) return null;

  return classes.Check(klass)
    ? { call: asId<"call">(call), name, args, class: classes.Decode(klass) }
    : null;
}

/** Returns whether a recorded `before_send` value holds a submission: content, source, delivery, configuration and replace by their shapes. */
function isSubmission(value: Json): value is Submission {
  return (
    isJsonObject(value) &&
    (typeof value.content === "string" || Array.isArray(value.content)) &&
    isJsonObject(value.source) &&
    typeof value.source.kind === "string" &&
    (value.delivery === "steer" || value.delivery === "queue" || value.delivery === "attach") &&
    (value.configuration === null || isJsonObject(value.configuration)) &&
    (value.replace === null || typeof value.replace === "string")
  );
}
