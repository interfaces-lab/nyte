import { SubmissionType, ToolCallType, asId, compile, withJson } from "@nyte-ai/schema";
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
} from "@nyte-ai/schema";
import { Type } from "typebox";
import type { TSchema } from "typebox";
import { isParked, runStep } from "./durable.ts";
import type { StepOutcome } from "./durable.ts";
import { dev } from "./dev-log.ts";
import { SdkError } from "./error.ts";
import type { AdmissionGate, Kernel } from "./kernel.ts";
import type { HookEntry, HookHandler, HookName, HookTable, PluginApi } from "./plugin.ts";
import { stepPluginApi } from "./plugin-runtime.ts";
import { CORE_CONTEXT } from "./principals.ts";
import type { ConnectionContext } from "./principals.ts";
import { callRef } from "./refs.ts";
import { commit, readCall } from "./session-state.ts";
import type { Durable } from "./tools.ts";

/** Names the core hooks of one phase. */
export type CoreHook<Phase extends HookTable[keyof HookTable]["phase"]> = {
  [N in HookName<"core">]: HookTable[N & keyof HookTable]["phase"] extends Phase ? N : never;
}[HookName<"core">];

/** What a core hook receives. */
export type HookEvent<N extends HookName<"core">> = HookTable[N & keyof HookTable]["event"];

/** Where an operation dispatches a hook and the principal acting; handlers see the session, head and run. */
export interface HookContext {
  readonly session: SessionId;
  readonly head: HeadName | null;
  readonly run: RunId | null;
  readonly principal: PrincipalId;
}

/** The durable step a decide dispatch runs as, its call keyed by what it gates (`hook:before_tool:<call>`, `hook:before_send:<message>`). */
export interface HookStep {
  readonly call: CallId;
  readonly run: RunId | null;
  readonly head: HeadName | null;
  readonly part: PartId | null;
  readonly signal: AbortSignal;
}

/** Holds one session's hook handlers and dispatches them by phase. */
export interface HookDispatch {
  /** Adds a plugin's handler, run with the api it registered through; the disposer removes it. */
  register<N extends HookName<"core">>(
    plugin: string,
    api: PluginApi<"core">,
    name: N,
    entry: HookEntry<"core", N>,
  ): Disposer;
  /** Runs every handler in order; never rejects: a throw or an exceeded budget is reported against the handler's plugin. */
  observe<N extends CoreHook<"observe">>(
    name: N,
    event: HookEvent<N>,
    context: HookContext,
  ): Promise<void>;
  /** Chains the value through every handler in order; a throw or an exceeded budget rejects `internal` naming the plugin. */
  transform<N extends CoreHook<"transform">>(
    name: N,
    value: HookEvent<N>,
    context: HookContext,
  ): Promise<HookEvent<N>>;
  /** Runs the handlers as one replay-safe durable step of kind `hook` at `step.call`, each acting from the step, and resolves the recorded decision or `parked`. With no handler and no step recorded it resolves `continue` and writes nothing. */
  decide<N extends CoreHook<"decide">>(
    name: N,
    value: HookEvent<N>,
    context: HookContext,
    step: HookStep,
  ): Promise<StepOutcome<Decision<HookEvent<N>>>>;
}

type Base = {
  readonly api: PluginApi<"core">;
  readonly signal: AbortSignal;
  readonly session: SessionId | null;
  readonly head: HeadName | null;
  readonly run: RunId | null;
};

interface Handler<N extends HookName<"core">> {
  readonly plugin: string;
  readonly api: PluginApi<"core">;
  readonly order: number;
  readonly sequence: number;
  readonly run: HookHandler<"core", N>;
}

/** How one decide hook is called, recorded and read back. */
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

const submissions = compile(withJson(decisionType(SubmissionType)));

const toolCalls = compile(withJson(decisionType(ToolCallType)));

/** One caller per hook, so a call indexed by a generic hook name is typed by that hook. */
type Observers = {
  readonly [N in CoreHook<"observe">]: (
    run: HookHandler<"core", N>,
    event: HookEvent<N>,
    context: Base,
  ) => Awaitable<void>;
};

type Transformers = {
  readonly [N in CoreHook<"transform">]: (
    run: HookHandler<"core", N>,
    value: HookEvent<N>,
    context: Base,
  ) => Awaitable<HookEvent<N>>;
};

type Deciders = { readonly [N in CoreHook<"decide">]: Decider<N> };

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
    decode: (result) => (submissions.Check(result) ? submissions.Decode(result) : null),
  },
  before_tool: {
    invoke: (run, event, context) => run(event, context),
    intent: (event, principal) => ({ ...event, principal }),
    encode: (decision) => decision,
    decode: (result) => (toolCalls.Check(result) ? toolCalls.Decode(result) : null),
  },
};

/** Returns a session's empty hook dispatch. Handlers run by ascending `order` (default 0), then registration sequence, each with the api it registered through and a signal that fires at its budget (5 s; `before_compaction` 300 s) or when its plugin deactivates. */
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

  return {
    register(plugin, api, name, entry) {
      const handler: Handler<typeof name> = {
        plugin,
        api,
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
        const { api } = handler;

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
        const { api } = handler;

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
            const api = stepPluginApi(kernel, handler.api, acting, context.session);

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

/** Returns whether a name is a core hook. */
export function isCoreHook(name: string): name is HookName<"core"> {
  return (
    Object.hasOwn(observers, name) ||
    Object.hasOwn(transformers, name) ||
    Object.hasOwn(deciders, name)
  );
}

/** Dispatches `before_send` as the durable step `hook:before_send:<message>` and waits in process while it is parked, running it again on each wake: what the kernel's `admit` runs. A revision of a pending message first forgets the decision its earlier version recorded. */
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

/** Returns `CORE_CONTEXT` acting from a decide step, with a fresh acquisition counter for one execution. */
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

/** Runs one handler under its budget and its plugin's deactivation, rejecting at either. */
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

function failure(plugin: string, name: HookName<"core">, error: unknown): string {
  const reason = error instanceof Error ? error.message : String(error);

  return `Plugin ${plugin}'s ${name} handler failed: ${reason}`;
}

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

/** The TypeBox schema of a `Decision` over a value schema. */
function decisionType<T extends TSchema>(value: T) {
  return Type.Union([
    Type.Object({ action: Type.Literal("continue") }),
    Type.Object({ action: Type.Literal("modify"), value }),
    Type.Object({ action: Type.Literal("reject"), reason: Type.String() }),
    Type.Object({ action: Type.Literal("error"), message: Type.String() }),
  ]);
}
