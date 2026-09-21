/**
 * The kernel objects that travel on the wire: a commit and what it carries,
 * a run's phase, tool progress. Moved here from `@nyte-ai/core`'s kernel
 * model so a client in another process or language reads the same shapes;
 * core re-exports them under their old names. The mutable kernel vocabulary
 * (refs, leases, changes, effects) stays in core.
 */
import type {
  AssistantMessage,
  JsonValue,
  Message,
  ProviderCheckpointMaterial,
  ToolResultMessage,
  Usage,
  UserMessage,
} from "@nyte-ai/schema";
import type { Failure } from "@nyte-ai/schema";
import { Value } from "typebox/value";
import { TreeId as TreeIdSchema } from "./schemas.ts";
import type { JobReport, SessionId } from "./sdk.ts";

export type { Failure, FailureClass } from "@nyte-ai/schema";

/** SHA-256 hex over the object's canonical JSON. */
export type Oid = string;
/** Position in a session's event stream. The first event is 1. */
export type Seq = number;
/** The VCS backend's id for one workspace tree: a git tree hash, SHA-1 or SHA-256. */
export type TreeId = string & { readonly __brand: "TreeId" };

/** Parse the untrusted string a wire request or a git command supplied. */
export function treeId(value: string): TreeId {
  if (!Value.Check(TreeIdSchema, value)) throw new Error(`Invalid tree id: ${value}`);
  return value;
}

/** The cursor is older than the stream's floor: take a snapshot, then watch from its seq. */
export class CursorExpired extends Error {
  readonly floor: Seq;
  constructor(floor: Seq) {
    super(`Event cursor is older than the stream floor ${String(floor)}`);
    this.name = "CursorExpired";
    this.floor = floor;
  }
}

/** Who did it, as the host defines identity. Attribution, not authorization. */
export interface Actor {
  readonly clientId?: string;
  readonly userId?: string;
  readonly device?: string;
}

export interface ModelRef {
  readonly provider?: string;
  readonly id: string;
}

export type MessageSource = {
  readonly kind: "action";
  readonly label: string;
};

/**
 * What a tool call is, stamped by the runner from the tool's own typed
 * arguments when the call commits, and again from its result when it settles.
 * A file mutation is `file_edit` or `file_write` until it settles; a settled
 * one is `file_patch` and carries what changed. A failed call keeps its call
 * class. Provenance for clients, never context.
 */
export type ToolClass =
  | { readonly kind: "file_edit"; readonly path: string }
  | { readonly kind: "file_write"; readonly path: string }
  | {
      readonly kind: "file_patch";
      readonly op: "edit" | "write";
      readonly path: string;
      readonly added: number;
      readonly removed: number;
      readonly patch: string;
    }
  | { readonly kind: "file_read"; readonly path: string }
  | { readonly kind: "list"; readonly path: string }
  | { readonly kind: "shell"; readonly command: string }
  /** A create names the child it owns; the card draws from this title before the child is listed. */
  | {
      readonly kind: "delegate";
      readonly role: "create";
      readonly title: string;
      readonly target: { readonly kind: "one"; readonly session: SessionId };
    }
  /** A call on one child session, or an await over several children. */
  | {
      readonly kind: "delegate";
      readonly role: "send" | "await" | "read" | "stop";
      readonly target:
        | { readonly kind: "one"; readonly session: SessionId }
        | {
            readonly kind: "many";
            readonly sessions: readonly [SessionId, ...SessionId[]];
            readonly mode: "any" | "all";
          };
    }
  | { readonly kind: "custom"; readonly label: string };

/** Fields every conversation commit carries. */
export interface CommitBase {
  readonly kind: "commit";
  readonly parent: Oid | null;
  /** The change this commit landed, when a submission produced it. */
  readonly change?: Oid;
  /** Correlation for the client that submitted the landed change. */
  readonly key?: string;
  /** The run that wrote this commit, when a runner did. */
  readonly run?: string;
  readonly at: number;
  readonly author?: Actor;
}

export type CommitStart =
  | { readonly kind: "none" }
  | { readonly kind: "run"; readonly tree: TreeId | null };

export type CommitOutcome =
  | { readonly kind: "ok" }
  | { readonly kind: "failed"; readonly failure: Failure };

export type Commit = CommitBase &
  (
    | {
        readonly body: {
          readonly kind: "message";
          readonly message: UserMessage;
          readonly agent?: string;
          readonly source?: MessageSource;
        };
        readonly start: CommitStart;
      }
    | {
        readonly body: { readonly kind: "message"; readonly message: AssistantMessage };
        readonly calls: Readonly<Record<string, ToolClass>>;
        readonly outcome: CommitOutcome;
      }
    | {
        readonly body: { readonly kind: "message"; readonly message: ToolResultMessage };
        readonly call: ToolClass;
        readonly tree: TreeId | null;
      }
    | {
        readonly body: { readonly kind: "completion"; readonly job: JobReport };
        readonly start: CommitStart;
      }
    | {
        readonly body: {
          readonly kind: "checkpoint";
          readonly summary: string;
          readonly retainedTail: readonly Message[];
          readonly material?: ProviderCheckpointMaterial;
          readonly tokensBefore: number;
          readonly usage?: Usage;
        };
      }
    | {
        readonly body: {
          readonly kind: "summary";
          readonly text: string;
          readonly usage?: Usage;
        };
        /** Commits summarized into this one. Provenance only, never context. */
        readonly imports: readonly Oid[];
      }
    | {
        readonly body: {
          readonly kind: "config";
          readonly model?: ModelRef;
          readonly thinkingLevel?: string;
          readonly agent?: string;
        };
      }
  );

export type CommitBody =
  | {
      readonly kind: "message";
      readonly message: UserMessage;
      /** Agent selection travels with a submitted user message. */
      readonly agent?: string;
      readonly source?: MessageSource;
    }
  | { readonly kind: "message"; readonly message: AssistantMessage }
  | { readonly kind: "message"; readonly message: ToolResultMessage }
  /** Background work's report, consumed by the model without impersonating user input. */
  | { readonly kind: "completion"; readonly job: JobReport }
  /** A context checkpoint. Projection starts at the newest one. */
  | {
      readonly kind: "checkpoint";
      readonly summary: string;
      readonly retainedTail: readonly Message[];
      readonly material?: ProviderCheckpointMaterial;
      readonly tokensBefore: number;
      /** What the summarizing call cost, when a model wrote the summary. */
      readonly usage?: Usage;
    }
  /** What a path that was left was about, placed where the head landed. */
  | { readonly kind: "summary"; readonly text: string; readonly usage?: Usage }
  /** Run inputs declared on the branch; the latest value of each field wins. */
  | {
      readonly kind: "config";
      readonly model?: ModelRef;
      readonly thinkingLevel?: string;
      readonly agent?: string;
    };

/** Run inputs as a branch declares them: the fold of its config commits, latest field wins. */
export interface BranchConfig {
  readonly model?: ModelRef;
  readonly thinkingLevel?: string;
  readonly agent?: string;
}

export type DelegateRequest =
  | { readonly kind: "commit"; readonly oid: Oid }
  | { readonly kind: "change"; readonly oid: Oid };

export type RunOrigin =
  | { readonly kind: "user" }
  | {
      readonly kind: "continuation";
      readonly session: SessionId;
      readonly request: DelegateRequest;
    };

export type RunPhase =
  | { readonly kind: "respond" }
  | { readonly kind: "tools" }
  | { readonly kind: "waiting" }
  | {
      readonly kind: "retry";
      readonly at: number;
      readonly retries: number;
      readonly failure: Failure;
    }
  | { readonly kind: "done" }
  | { readonly kind: "aborted" }
  | { readonly kind: "failed"; readonly failure: Failure };

/** A run in a terminal phase will never advance; only a new run follows it. */
export function isTerminalPhase(phase: RunPhase): boolean {
  return phase.kind === "done" || phase.kind === "aborted" || phase.kind === "failed";
}

export interface ToolProgress {
  readonly text: string;
  readonly title?: string;
  readonly details?: JsonValue;
}
