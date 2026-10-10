import type {
  CallId,
  HeadName,
  Json,
  PrincipalId,
  RunId,
  SessionId,
  ToolInfo,
  ToolOutcome,
} from "@nyte-ai/schema";
import type { Kernel } from "./kernel.ts";
import type { ConnectionContext } from "./principals.ts";
import type { ToolDefinition } from "./tools.ts";

/** Resolves the tools a session can call in one run: what `executeCall` looks up and an invocation's `tools` lists and activates; core-f fills `kernel.tools(session, run)` from the registries. */
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

/** Returns the tool intent a call record's `intent` holds, or null when it holds another shape. */
export function decodeToolIntent(value: Json): ToolIntent | null {
  throw new Error("not implemented");
}

/** Runs one tool call to its outcome, or parks it. Resolves the definition through `kernel.tools(session, run)` (unknown → `failed`); dispatches `kernel.beforeTool` as a durable step of kind `hook` with id `hook:before_tool:<call>` (`reject` → `rejected`, nothing runs); validates `args` (`failed`); writes the tool part (`id = call`, phase `calling`, placement transcript `step`) with `call intent`; runs `definition.execute` as a durable step of kind `tool` under the definition's `replay`, its intent a `ToolIntent` `{ name, args, principal }`. `parked` returns the marker for the turn driver. `done` validates `output` against `definition.output` (`failed`), applies `kernel.afterTool`, diffs `kernel.snapshots(session)` into `changes` (null without snapshots), and settles in one set: the call's result, the part's `settled { outcome, changes }` state, the head commit, events `[call settled, part settled, commit]`, plus `changes { files }` when the diff is non-empty. `interrupted` settles the same way with `{ kind: "interrupted" }`; an aborted `signal` settles `stopped`. `key` marks a nested `tools.execute` from the step `call`: the nested call and its part have the id `<call>:<key>`, its own step record lives at `calls/<call>:<key>`, and its outcome is recorded in and replays from the parent's `nested[key]`. */
export function executeCall(
  kernel: Kernel,
  input: {
    readonly session: SessionId;
    readonly head: HeadName;
    readonly run: RunId;
    readonly call: CallId;
    readonly name: string;
    readonly args: Json;
    readonly context: ConnectionContext;
    readonly signal: AbortSignal;
    readonly key?: string;
  },
): Promise<ToolOutcome | { readonly kind: "parked" }> {
  throw new Error("not implemented");
}
