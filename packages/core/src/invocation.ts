import type { CallId, HeadName, RunId, SessionId, WorkspaceId } from "@nyte-ai/schema";
import type { ExecutionEnv } from "./environment.ts";
import type { Kernel } from "./kernel.ts";
import type { ConnectionContext } from "./principals.ts";
import type { Durable, ToolInvocation } from "./tools.ts";

/** Returns what a tool's `execute` receives, bound to where the call runs. `session` and `sdk` act from the call: the context with participant authority only and `origin` set to `{ session, run, head, call, sequence }`, `sequence` a fresh counter for this execution so its acquisitions key `acq:<n>` the same way on every re-run; `workspace` is `kernel.workspace` of the session's workspace; `env` is the environment `executeCall` resolved through `kernel.env(session)`; `progress` publishes a `progress` patch on the tool part, dropped once the run is stopping; `tools.execute` is a nested `executeCall` keyed by the caller's key or call order; `tools.activate` and `tools.list` are `kernel.tools(session, run)`'s; `wait`, `memo` and `now` are the step's `durable`. Binds synchronously; no I/O. */
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
  },
): ToolInvocation {
  throw new Error("not implemented");
}
