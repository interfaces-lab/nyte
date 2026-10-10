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
import type { Workspace } from "./workspace.ts";

/**
 * Returns what a tool's `execute` receives: the same connection a client
 * gets, bound to where the call runs, plus the durable-step primitives.
 *
 * **Details**
 *
 * The invocation's sdk has no owner authority, so a run cannot register a
 * folder. `sessions.create({ parent })` through it records the run and call
 * that spawned the child; a client's sdk records only the session.
 *
 * @category tools
 * @since 0.1.0
 */
export interface ToolInvocation extends Durable {
  readonly run: RunId;
  readonly call: CallId;
  /** The head this run is on; a side-head run targets itself. */
  readonly head: HeadName;
  /** Fires when the call is stopped. */
  readonly signal: AbortSignal;
  /** Full handle; children via `sdk.sessions.create({ parent: session.id })`. */
  readonly session: Session;
  /** The run's connection, with participant authority. */
  readonly sdk: Connection;
  /** The session's workspace. */
  readonly workspace: Workspace;
  /** Files and exec, resolved; no Capability unwrapping inside a tool. */
  readonly env: ExecutionEnv;
  /** Writes the tool part's progress; the client draws it. */
  progress(update: ToolProgress): void;
  /** Nested calls and deferred tools. */
  readonly tools: {
    /**
     * Calls another tool under `before_tool` policy.
     *
     * **Gotchas**
     *
     * Keyed so a re-run finds the one it already made. The default key is
     * call order, so concurrent calls need explicit keys.
     */
    execute(name: string, args: Json, options?: { readonly key?: string; readonly signal?: AbortSignal }): Promise<ToolOutcome>;
    /** Brings deferred tools into the declared set for the rest of this run. */
    activate(names: readonly string[]): Promise<void>;
    /** Returns the session's tools with output schemas and exposure, so codemode can type its sandbox. */
    list(): readonly ToolInfo[];
  };
}

/**
 * Returns what a durable step can do: park, memoise and read a recorded
 * clock.
 *
 * **Details**
 *
 * Tools, part actions and core decide hooks are all durable steps; a host
 * restart re-runs them with everything below replayed. Acquisitions made
 * through a durable step are recorded like nested calls:
 * `sessions.create`, `parts.create`, `jobs.start` and `browser.open`, keyed
 * by call order or an explicit key, return the same thing on a re-run. No
 * memo needed.
 *
 * Write a step so that everything before its first `wait()` is either cheap
 * and repeatable or already recorded.
 *
 * @see {@link ToolDefinition.replay}
 * @category durability
 * @since 0.1.0
 */
export interface Durable {
  /**
   * Parks the step durably until a target settles; a wake re-runs the step
   * and this call resolves at once.
   *
   * **Details**
   *
   * Wait is the only blocking primitive. The delegate adapters task, create,
   * send, await, read and stop are built on `sessions.create`, `send`,
   * `receipt.settled` and `wait`. `any`/`all` combine targets; `deadline`
   * bounds the whole wait; `untilInput` also wakes when the user sends to
   * this head.
   *
   * **Example** (A synchronous subagent)
   *
   * ```ts
   * const execute: ToolDefinition<{ task: string }>["execute"] = async (args, invocation) => {
   *   const child = await invocation.sdk.sessions.create({ parent: invocation.session.id });
   *   const receipt = await child.send(args.task);
   *   const landed = await receipt.landed();
   *   if (landed.kind !== "landed" || landed.run === null) return { content: [{ kind: "text", text: "Not started." }] };
   *   const outcome = await invocation.wait({ kind: "run", session: child.id, run: landed.run });
   *   const text = outcome.kind === "run" ? `Child ended: ${outcome.end.kind}` : outcome.kind;
   *   return { content: [{ kind: "text", text }] };
   * };
   * ```
   *
   * @returns {@link WaitOutcome}
   */
  wait(target: WaitTarget | { readonly kind: "any" | "all"; readonly targets: readonly WaitTarget[]; readonly deadline?: number; readonly untilInput?: boolean }): Promise<WaitOutcome>;
  /**
   * Stores a computed value under a name unless one exists, and returns the
   * durable winner.
   *
   * **Details**
   *
   * The re-run gets the recorded value. A tool that fetches, then writes,
   * memoises the fetch and is safe to replay.
   *
   * **Example** (Memoising a fetch before a write)
   *
   * ```ts
   * declare const invocation: ToolInvocation;
   *
   * const issue = await invocation.memo("issue", async () => {
   *   const response = await fetch("https://api.example.com/issues/42");
   *   return { title: String((await response.json()).title) };
   * });
   * await invocation.env.files.write("ISSUE.md", `# ${issue.title}\n`);
   * ```
   */
  memo<T extends Json>(name: string, compute: () => Awaitable<T>): Promise<T>;
  /** Returns the recorded clock: the same value on a re-run. */
  now(): number;
}

/**
 * Describes a tool: its name, schemas, exposure, class, replay policy and
 * execute function.
 *
 * **Example** (A replay-safe read tool)
 *
 * ```ts
 * import { z } from "zod";
 *
 * const readFile = {
 *   name: "read",
 *   description: "Read a file in the workspace.",
 *   parameters: z.object({ path: z.string() }),
 *   class: (args) => ({ kind: "read", path: args.path }),
 *   replay: "safe",
 *   execute: async (args, invocation) => {
 *     const file = await invocation.env.files.read(args.path);
 *     const text = file.kind === "text" ? file.contents : `${args.path}: ${file.kind}`;
 *     return { content: [{ kind: "text", text }] };
 *   },
 * } satisfies ToolDefinition<{ path: string }>;
 * ```
 *
 * @see {@link ToolInvocation}
 * @category tools
 * @since 0.1.0
 */
export interface ToolDefinition<Args = unknown, Output = unknown> {
  readonly name: string;
  /** "github", "mcp/linear": grouped in listings and codemode's ALL_TOOLS. */
  readonly namespace?: string;
  readonly description: string;
  /** Validates the call; its JSON Schema goes to the model. */
  readonly parameters: Schema<Args>;
  /** Validates `ToolResult.output`; what clients and codemode read. */
  readonly output?: Schema<Output>;
  /** Default model. deferred: listed by name until `activate()`. code: callable from codemode only. hidden: callable by plugins only. */
  readonly exposure?: "model" | "deferred" | "code" | "hidden";
  /** Constrained sampling of the arguments, for providers that support it (OpenAI Lark). Ignored elsewhere; parameters still validate the call. */
  readonly grammar?: { readonly kind: "lark"; readonly source: string } | { readonly kind: "regex"; readonly pattern: string };
  /** Returns what the call does; method syntax on purpose, so a typed tool stays assignable to `ToolDefinition<unknown>`. */
  class(args: Args, context: { readonly call: CallId }): ToolClass;
  /**
   * Says whether `execute` may run again after a host died mid-call. No
   * default.
   *
   * **Details**
   *
   * Core records a call's intent before `execute` and its result after. A
   * host that dies between them resumes with an intent and no result:
   *
   * - `safe`: `execute` runs again from the top. Recorded `wait()` outcomes
   *   and nested `tools.execute()` results replay instantly in order, so the
   *   code is deterministic up to its first unrecorded effect. This is also
   *   how a parked tool wakes: no continuation, a re-run whose `wait()`
   *   resolves at once.
   * - `never`: `execute` does not run again. The call settles as
   *   `interrupted`; the model sees it and decides.
   *
   * **When to use**
   *
   * `memo()` records an intermediate result under a name; a tool that
   * fetches, then writes, memoises the fetch and is safe. A tool whose effect
   * cannot be recorded, or that must not repeat, is never.
   */
  readonly replay: "safe" | "never";
  /** Runs the call. */
  execute(args: Args, invocation: ToolInvocation): Promise<ToolResult<Output>>;
}
