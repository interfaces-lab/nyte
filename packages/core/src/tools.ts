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
import type { Connection } from "./connection.ts";
import type { ExecutionEnv } from "./environment.ts";
import type { Session } from "./session.ts";
import type { Workspace } from "./workspaces.ts";

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
    activate(names: readonly string[]): Promise<void>;
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
  readonly replay: "safe" | "never";
  execute(args: Args, invocation: ToolInvocation): Promise<ToolResult<Output>>;
}
