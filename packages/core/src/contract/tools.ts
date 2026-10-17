import type {
  Awaitable,
  CallId,
  HeadName,
  Json,
  RunId,
  Schema,
  ToolClass,
  ToolInfo,
  ToolOutcome,
  ToolProgress,
  ToolResult,
  WaitOutcome,
  WaitTarget,
} from "@nyte-ai/schema";
import type { Connection } from "./host.ts";
import type { Session } from "./session.ts";
import type { ExecutionEnv, Workspace } from "./workspace.ts";

export interface ToolInvocation extends Durable {
  readonly run: RunId;
  readonly call: CallId;
  readonly head: HeadName;
  readonly signal: AbortSignal;
  readonly session: Session;
  readonly sdk: Connection;
  readonly workspace: Workspace;
  readonly env: ExecutionEnv;
  progress(update: ToolProgress): void;
  readonly tools: {
    execute(
      name: string,
      args: Json,
      options?: { readonly key?: string; readonly signal?: AbortSignal },
    ): Promise<ToolOutcome>;
    list(): readonly ToolInfo[];
  };
}

export interface Durable {
  wait(
    target:
      | WaitTarget
      | {
          readonly kind: "any" | "all";
          readonly targets: readonly WaitTarget[];
          readonly deadline?: number;
          readonly untilInput?: boolean;
        },
  ): Promise<WaitOutcome>;
  memo<T extends Json>(name: string, compute: () => Awaitable<T>): Promise<T>;
  now(): number;
}

export interface ToolDefinition<Args = unknown, Output = unknown> {
  readonly name: string;
  readonly namespace?: string;
  readonly description: string;
  readonly parameters: Schema<Args>;
  readonly output?: Schema<Output>;
  readonly exposure?: "model" | "deferred" | "code" | "hidden";
  readonly grammar?:
    | { readonly kind: "lark"; readonly source: string }
    | { readonly kind: "regex"; readonly pattern: string };
  class(args: Args, context: { readonly call: CallId }): ToolClass;
  /** What a call can change besides the session: `"workspace"` when it may write the workspace's files, so the runner snapshots the tree around it and records what changed; `"none"` when it cannot (reads, browser pages, canvases, questions, delegation that does not wait on a subagent, or a script whose nested calls declare their own); `task` and `await` keep the default, since the subagent writes the same workspace while they wait. Default `"workspace"`. A call nested inside one that snapshots is covered by its parent's pair and takes none of its own. */
  readonly effects?: "workspace" | "none";
  /** Whether a permissions policy may hold a call before it runs: `"policy"` (the default) lets a before_tool gate such as the approvals plugin ask by the call's class; `"never"` for a call that changes nothing the user guards (a question, a canvas, a web search, a page read, or a script whose nested calls are gated on their own); `"runtime"` for the mirror of a call another agent runtime runs, which asked through `PluginApi.approve` before it ran. Snapshots read `effects`, never this. */
  readonly approval?: "policy" | "never" | "runtime";
  readonly replay: "safe" | "never";
  execute(args: Args, invocation: ToolInvocation): Promise<ToolResult<Output>>;
}
