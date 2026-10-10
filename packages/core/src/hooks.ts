import type {
  CallId,
  Decision,
  Disposer,
  HeadName,
  PartId,
  PrincipalId,
  RunId,
  SessionId,
} from "@nyte-ai/schema";
import type { StepOutcome } from "./durable.ts";
import type { Kernel } from "./kernel.ts";
import type { HookEntry, HookName, HookTable } from "./plugin.ts";

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

/** Returns the durable step a decide dispatch runs as: its call id, keyed by what it gates (§33k: `hook:before_tool:<call>`, `hook:before_send:<message>`), and where it runs. */
export interface HookStep {
  readonly call: CallId;
  readonly run: RunId | null;
  readonly head: HeadName | null;
  readonly part: PartId | null;
}

/** Holds one session's hook handlers and dispatches them by phase. */
export interface HookDispatch {
  /** Adds a plugin's handler under a hook; the disposer removes it. A handler added while a dispatch runs joins the next one. */
  register<N extends HookName<"core">>(plugin: string, name: N, entry: HookEntry<"core", N>): Disposer;
  /** Runs every handler in order, each awaited by the dispatcher; the operation does not await the promise, which never rejects. A throw or an exceeded budget is reported as an issue against the handler's plugin, and the next handler runs. */
  observe<N extends CoreHook<"observe">>(name: N, event: HookEvent<N>, context: HookContext): Promise<void>;
  /** Chains the value through every handler in order, each seeing the previous result, and resolves the last; with none registered, `value` as given. A throw or an exceeded budget fails the operation: rejects `SdkError("internal")` naming the plugin. */
  transform<N extends CoreHook<"transform">>(name: N, value: HookEvent<N>, context: HookContext): Promise<HookEvent<N>>;
  /** Runs the handlers as one durable step of kind `hook` at `step.call`, replay safe, its intent the event with the context's principal (so a `before_tool` step decodes as a `ToolIntent`); each handler gets the step's `Durable`. In order: `continue` passes on, `modify` replaces the value later handlers see, `reject` short-circuits, `error` fails; a throw or an exceeded budget is `error` naming the plugin, the budget covering compute, not the park. Resolves `done` with the recorded decision (`modify` with the last value when any handler modified, else `continue`), replayed on a re-run, or `parked` when a handler parked, for the caller to wait on the wake: the turn driver returns, admission waits in process as `runAction` does. With no handler registered and no step recorded at `step.call`, resolves `done` with `continue` and writes nothing. */
  decide<N extends CoreHook<"decide">>(
    name: N,
    value: HookEvent<N>,
    context: HookContext,
    step: HookStep,
  ): Promise<StepOutcome<Decision<HookEvent<N>>>>;
}

/** Returns a session's empty hook dispatch. Handlers run by ascending `order` (default 0), then registration sequence; each gets its plugin's api (`kernel.pluginsFor(session).api(plugin)`), the context's session, head and run, and a signal that fires at its budget (`AbortSignal.timeout(5_000)`; `before_compaction` `300_000`) or when its plugin deactivates. */
export function createHookDispatch(kernel: Kernel, session: SessionId): HookDispatch {
  throw new Error("not implemented");
}
