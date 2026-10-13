import type { Configuration } from "./configuration.ts";
import type { FileChange } from "./files.ts";
import type { CommitId, MessageId, PartId, Revision, RunId, Seq, TurnId } from "./ids.ts";
import type { Delivery, MessageSource, Schedule, UserContent } from "./messages.ts";
import type { ContextView } from "./models.ts";
import type { PartStatus, PartView } from "./parts.ts";
import type { BackgroundItem, Execution, RunEnd, WaitTarget } from "./runs.ts";
import type { HeadInfo, SessionCatalogView } from "./sessions.ts";
import type { ToolClass } from "./tools.ts";
import type { Activation } from "./workspaces.ts";

/**
 * Bounds what a view carries. The tail is what a client draws on open; the
 * rest comes from `history()` as the user scrolls back. Turns, parts and
 * everything else are whole.
 *
 * @category views
 * @since 0.1.0
 */
export type ViewOptions = {
  /** How many messages from the end to carry. Default: the host's bound. */
  readonly tail?: number;
};

/**
 * Returns everything a client draws for one head: one list of messages, the
 * turns over it, execution, background work, configuration, context, heads,
 * changes and the catalog.
 *
 * **Details**
 *
 * A message is a user input or a part; a part is the one UI primitive, so a
 * thought, a tool call, the model's prose and a plugin's map are the same
 * thing to the client: kind, state, status, a renderer. The sdk folds the
 * client journal, host admission and the live stream into this list; core
 * computes everything that needs a loop. A client buckets by turn in one
 * pass and draws.
 *
 * **Example** (Reading the latest view once)
 *
 * ```ts
 * declare const session: Session;
 *
 * const view = await session.view();
 * const busy = view.execution.kind !== "idle";
 * const unread = view.heads.filter((head) => head.unread).length;
 * ```
 *
 * @see {@link Head.watch}
 * @category views
 * @since 0.1.0
 */
export type SessionView = {
  /** The head revision this view reflects; pass as `expect`. Null when the host holds no revision paired with this tip (§54a): read the view again. */
  readonly revision: Revision | null;
  /** The seq of the last durable event this view folded (§54g). */
  readonly seq: Seq;

  readonly activation: Activation;
  /** Conversation order, including this client's unsent and the live tail. */
  readonly messages: readonly Message[];
  /** Every part not in the transcript, with its placement as given. A client picks the kinds it knows. */
  readonly parts: readonly PartView[];
  /** Same order as messages; computed by the fold, never by the client. */
  readonly turns: readonly TurnInfo[];
  /** The head's run phase: the one place it lives. */
  readonly execution: Execution;
  /** Children, jobs and pages working for this head. */
  readonly background: readonly BackgroundItem[];
  /** The head's stored selection and what admission would resolve now. */
  readonly configuration: {
    readonly selected: Configuration | null;
    readonly effective: Configuration | null;
  };
  readonly context: ContextView;
  readonly heads: readonly HeadInfo[];
  /** Files this session changed, latest state per path, first-seen order. A field, not a derivation. */
  readonly changes: readonly FileChange[];
  /** Commands, settings, skills, agents, tools. A new object only when a plugin, skill or MCP server reloads. */
  readonly catalog: SessionCatalogView;
};

/**
 * Returns one transcript row: a user input or a part. Nothing else.
 *
 * **Details**
 *
 * Every message has one id from the moment it exists until it is committed,
 * minted once and reused at every stage:
 *
 * - user: the submission key. `send()` mints it before the network, the
 *   journal stores it, admission echoes it, the commit carries it.
 * - part: the part id. For text and thinking `${run}:${attempt}:${index}`,
 *   for tool the call id, for compaction and branchSummary the part id,
 *   minted when the part is created; a commit's id is its object's content
 *   hash, so it cannot be the id of a part its body names.
 *   The same id live and committed.
 *
 * A withdrawn user message leaves the list. A failed attempt's parts stay
 * with status failed until the next attempt's parts replace them; the retry
 * reason is on execution.
 *
 * **Example** (Narrowing a part message)
 *
 * ```ts
 * declare const view: SessionView;
 *
 * for (const message of view.messages) {
 *   if (message.kind === "user") continue;
 *   if (isPart(message, tool)) {
 *     console.log(message.state.name, message.status.kind);
 *   }
 * }
 * ```
 *
 * @category views
 * @since 0.1.0
 */
export type Message = { readonly id: MessageId; readonly turn: TurnId; readonly at: number } & (
  | {
      readonly kind: "user";
      readonly content: UserContent;
      readonly source: MessageSource;
      readonly delivery: Delivery;
      readonly status: UserStatus;
      /** Alternatives sharing this message's parent; count 1 = never edited. */
      readonly siblings: {
        readonly index: number;
        readonly count: number;
        readonly ids: readonly CommitId[];
      };
    }
  | {
      readonly kind: "part";
      readonly part: PartId;
      /** "text" | "thinking" | "tool" | "ask/question" | "maps/places" ... */
      readonly partKind: string;
      /** Step/answer sit in the turn's work and reply; note is a system record between turns. Built-ins fix it; a plugin part chooses in its placement. */
      readonly role: "step" | "answer" | "note";
      /** Narrow with `isPart(message, kind)`. */
      readonly state: unknown;
      readonly version: number;
      readonly status: PartStatus;
    }
);

/**
 * Returns where a user message is between the client and the commit.
 *
 * **Details**
 *
 * - `unsent`: in this client's journal only; `retrying` says when and why.
 * - `pending`: admitted, not yet placed. `covered` false means no host will
 *   run it yet.
 * - `landed`: committed; `replaced` says which message it edited and which
 *   run that stopped.
 *
 * @category views
 * @since 0.1.0
 */
export type UserStatus =
  | {
      readonly kind: "unsent";
      readonly attempts: number;
      readonly retrying: { readonly at: number; readonly reason: string } | null;
    }
  | { readonly kind: "pending"; readonly schedule: Schedule; readonly covered: boolean }
  | {
      readonly kind: "landed";
      readonly commit: CommitId;
      readonly run: RunId | null;
      readonly replaced: { readonly previous: MessageId; readonly stopped: RunId | null } | null;
    };

/**
 * Returns one turn: its run, prompt, state, step count and summary, computed
 * by the fold.
 *
 * **Details**
 *
 * Follow-on-scroll, pause on reader input and resume after a quiet spell
 * stay in the client; they are about the scrollport. Every row is
 * `renderers[partKind]` or the fallback; the user row is the one non-part
 * renderer.
 *
 * **Example** (The client's whole transcript build, O(n))
 *
 * ```ts
 * declare const view: SessionView;
 * declare function draw(turn: TurnInfo, messages: readonly Message[]): void;
 *
 * const byTurn = new Map<TurnId, Message[]>();
 * for (const message of view.messages) {
 *   const bucket = byTurn.get(message.turn) ?? [];
 *   bucket.push(message);
 *   byTurn.set(message.turn, bucket);
 * }
 * for (const turn of view.turns) draw(turn, byTurn.get(turn.id) ?? []);
 * ```
 *
 * **Example** (Compact step window)
 *
 * ```ts
 * declare const turn: TurnInfo;
 * declare const opened: boolean | undefined;
 * declare const density: "compact" | "detailed";
 *
 * const content =
 *   opened === true ? "open"
 *   : turn.state.kind === "working" && turn.steps > 0 ? "preview"
 *   : opened === false ? "closed"
 *   : density === "detailed" && !turn.thinkingOnly ? "open"
 *   : "closed";
 * ```
 *
 * @category views
 * @since 0.1.0
 */
export type TurnInfo = {
  readonly id: TurnId;
  readonly run: RunId | null;
  /** Null = a continuation a background report opened. */
  readonly prompt: MessageId | null;
  /**
   * `working` carries an activity from the newest live tool's class:
   * "Exploring" | "Editing" | "Running".
   */
  readonly state:
    | { readonly kind: "working"; readonly activity: string | null }
    | { readonly kind: "waiting"; readonly on: WaitTarget }
    | { readonly kind: "ended"; readonly end: RunEnd };
  readonly startedAt: number;
  readonly endedAt: number | null;
  /** Count of role step parts; the window is "preview" when working && steps > 0. */
  readonly steps: number;
  /** The turn's steps are all thinking. */
  readonly thinkingOnly: boolean;
  /** What the turn did, maintained incrementally as tools settle. */
  readonly summary: {
    /** Per tool class: how many calls settled ok and the paths they touched. Adding a class adds a key, never a field. */
    readonly byClass: Readonly<
      Record<ToolClass["kind"], { readonly count: number; readonly paths: readonly string[] }>
    >;
    readonly failed: number;
    readonly stopped: number;
    readonly added: number;
    readonly removed: number;
  };
};
