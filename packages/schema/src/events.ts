import type { Configuration } from "./configuration.ts";
import type { FileChange } from "./files.ts";
import type {
  CallId,
  CommitId,
  HeadName,
  MessageId,
  PartId,
  PrincipalId,
  RunId,
  Seq,
} from "./ids.ts";
import type { Delivery, MessageSource, Schedule, UserContent } from "./messages.ts";
import type { Failure } from "./model/message.ts";
import type { ContextView, Usage } from "./models.ts";
import type { Placement } from "./parts.ts";
import type { Json } from "./primitives.ts";
import type { BackgroundItem, RunEnd, RunView, WaitTarget } from "./runs.ts";
import type { SessionCatalogView, SessionInfo } from "./sessions.ts";
import type { ToolClass, ToolOutcome, ToolProgress } from "./tools.ts";
import type { Activation } from "./workspaces.ts";

/**
 * Returns one logged event with its seq and time.
 *
 * **Details**
 *
 * The log is the sequence of these. `watch()` on the host folds the log plus
 * the live stream; over the wire the same events travel and the sdk runs the
 * same fold. A reconnecting watch asks for the log after its last seq and
 * rejoins the live stream. `inspect().events()` reads the log raw.
 *
 * @category events
 * @since 0.1.0
 */
export type SessionEvent = { readonly seq: Seq; readonly at: number } & DurableEvent;

/**
 * Returns what one ref update means: the durable events the fold consumes.
 *
 * **Details**
 *
 * Every ref update carries one. Each carries what the fold consumes inline;
 * objects stay content-addressed for storage.
 *
 * - `commit`: the head advanced to this commit.
 * - `head`: a move that wrote no commit.
 * - `part` `created`: `state` is the initial state; `owner` is the plugin
 *   that contributed the definition, null for an ownerless part.
 * - `input` `scheduled`: `position` is the message's index in the head's
 *   inbox after the change, so a reorder is a scheduled event.
 * - `request`: a provider request settled.
 * - `changes`: the session's changed files after a write-class call; the
 *   whole list, latest per path.
 * - `session`: name, pinned, archived, workspace.
 *
 * Ordering within one set: the entries' events are logged in entry order, so
 * a landing is [input landed, commit] and an edit is [run stopping, head
 * moved, input admitted]. The fold never sees a commit before the input it
 * lands.
 *
 * The fold is one function, `(view, event) → view`, structurally shared,
 * the same code in core and in the sdk. The log is the source of truth; the
 * view is a cache of folding it. A host that loses its in-memory view
 * rebuilds it from the log; a client that loses its socket resumes from seq.
 *
 * **Example** (Folding a run's end)
 *
 * ```ts
 * declare const events: readonly SessionEvent[];
 *
 * for (const event of events) {
 *   if (event.kind === "run" && event.change === "ended") {
 *     console.log(event.seq, event.run, event.end.kind);
 *   }
 * }
 * ```
 *
 * @see {@link PatchEvent}
 * @category events
 * @since 0.1.0
 */
export type DurableEvent = { readonly head: HeadName | null } & (
  | {
      readonly kind: "commit";
      readonly id: CommitId;
      readonly parent: CommitId | null;
      readonly run: RunId | null;
      readonly body: CommitBody;
    }
  | {
      readonly kind: "head";
      readonly from: CommitId | null;
      readonly to: CommitId | null;
      readonly reason: "moved" | "merged" | "created" | "removed";
    }
  | { readonly kind: "seen"; readonly principal: PrincipalId; readonly commit: CommitId | null }
  | ({ readonly kind: "input"; readonly message: MessageId } & (
      | {
          readonly change: "admitted";
          readonly content: UserContent;
          readonly source: MessageSource;
          readonly delivery: Delivery;
          readonly schedule: Schedule;
          readonly covered: boolean;
          readonly configuration: Configuration;
          readonly replaced: {
            readonly previous: MessageId;
            readonly stopped: RunId | null;
          } | null;
        }
      | { readonly change: "scheduled"; readonly schedule: Schedule; readonly position: number }
      | { readonly change: "landed"; readonly commit: CommitId; readonly run: RunId | null }
      | { readonly change: "withdrawn" }
      | { readonly change: "superseded"; readonly by: MessageId }
    ))
  | ({ readonly kind: "run"; readonly run: RunId } & (
      | { readonly change: "started"; readonly view: RunView }
      | { readonly change: "phase"; readonly phase: "responding" | "executing" }
      | { readonly change: "waiting"; readonly on: WaitTarget }
      | {
          readonly change: "retrying";
          readonly attempt: number;
          readonly until: number;
          readonly reason: string;
        }
      | { readonly change: "stopping" }
      | { readonly change: "ended"; readonly end: RunEnd }
    ))
  | ({ readonly kind: "part"; readonly part: PartId } & (
      | {
          readonly change: "created";
          readonly partKind: string;
          readonly placement: Placement;
          readonly state: Json;
          readonly version: number;
          readonly run: RunId | null;
          readonly owner: string | null;
        }
      | { readonly change: "updated"; readonly state: Json; readonly version: number }
      | { readonly change: "waiting"; readonly call: CallId }
      | { readonly change: "settled"; readonly commit: CommitId; readonly endedAt: number }
      | { readonly change: "failed"; readonly failure: Failure }
      | { readonly change: "closed" }
    ))
  | ({ readonly kind: "call"; readonly call: CallId; readonly part: PartId } & (
      | {
          readonly change: "intent";
          readonly name: string;
          readonly args: Json;
          readonly class: ToolClass;
        }
      | { readonly change: "waiting"; readonly on: WaitTarget }
      | {
          readonly change: "settled";
          readonly outcome: ToolOutcome;
          readonly changes: {
            readonly added: number;
            readonly removed: number;
            readonly paths: readonly string[];
          } | null;
        }
    ))
  | { readonly kind: "background"; readonly item: BackgroundItem }
  | {
      readonly kind: "configured";
      readonly selected: Configuration | null;
      readonly effective: Configuration | null;
    }
  | {
      readonly kind: "request";
      readonly usage: Usage;
      readonly context: ContextView;
      readonly step: "assistant" | "compaction" | "summary" | "plugin";
    }
  | { readonly kind: "changes"; readonly files: readonly FileChange[] }
  | { readonly kind: "session"; readonly info: SessionInfo }
  | { readonly kind: "activation"; readonly activation: Activation }
  | { readonly kind: "catalog"; readonly catalog: SessionCatalogView }
);

/**
 * Returns the one event that is never logged: a transient patch to a live
 * part.
 *
 * **Details**
 *
 * `append` is a token for text or thinking; `markdown` is a text or thinking
 * part's whole text so far, replacing it; `progress` is a tool saying what it
 * is doing, replacing the last. Coalesced by the fold. The durable
 * `part.settled` carries the final state once.
 *
 * **Gotchas**
 *
 * A watch that starts or resumes mid-stream gets each streaming part's text
 * as one `markdown` patch, then new patches from there; old ones are gone.
 *
 * @category events
 * @since 0.1.0
 */
export type PatchEvent = { readonly kind: "patch"; readonly part: PartId } & (
  | { readonly append: string }
  | { readonly markdown: string }
  | { readonly progress: ToolProgress }
);

/**
 * Returns what a commit holds: a user message, or a reference to a part's
 * settled version.
 *
 * **Details**
 *
 * A part commit carries only the id; its state travelled in part events.
 * Compaction and branch summary commits name the commits they replace.
 *
 * @category events
 * @since 0.1.0
 */
export type CommitBody =
  | {
      readonly kind: "user";
      readonly message: MessageId;
      readonly content: UserContent;
      readonly source: MessageSource;
      readonly delivery: Delivery;
      /** The parent's earlier user commits, in creation order; the fold appends this commit, whose id is its own content hash. */ readonly siblings: readonly CommitId[];
    }
  | { readonly kind: "part"; readonly part: PartId }
  | { readonly kind: "compaction"; readonly part: PartId; readonly replaces: readonly CommitId[] }
  | {
      readonly kind: "branchSummary";
      readonly part: PartId;
      readonly replaces: readonly CommitId[];
    };
