/**
 * The kernel objects that travel on the wire: a commit and what it carries,
 * a run's phase, tool progress. Moved here from `@nyte-ai/core`'s kernel
 * model so a client in another process or language reads the same shapes;
 * core re-exports them under their old names. The mutable kernel vocabulary
 * (refs, leases, changes, effects) stays in core.
 */
import type { JsonValue, Message, ProviderCheckpointMaterial, Usage } from "@nyte-ai/schema";
import type { JobInfo } from "./sdk.ts";

/** SHA-256 hex over the object's canonical JSON. */
export type Oid = string;
/** Position in a session's event stream. The first event is 1. */
export type Seq = number;

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

/** One point in a conversation. Model context is linear, so it has one parent. */
export interface Commit {
  readonly kind: "commit";
  readonly parent: Oid | null;
  /** Provenance only: commits this one summarizes or carries over. Never context. */
  readonly imports?: readonly Oid[];
  /** The change this commit landed, when a submission produced it. */
  readonly change?: Oid;
  /**
   * The submission key the landed change carried. Correlation for the client
   * that sent it, never authorization; it stays out of the message content.
   */
  readonly key?: string;
  /** The run that wrote this commit, when a runner did. Provenance for per-run views. */
  readonly run?: string;
  readonly body: CommitBody;
  readonly at: number;
  readonly author?: Actor;
}

export type CommitBody =
  | {
      readonly kind: "message";
      readonly message: Message;
      /** Agent selection travels with its message through submit, cancel, and redelivery. */
      readonly agent?: string;
    }
  /** Background tool output, consumed by the model without impersonating user input. */
  | { readonly kind: "completion"; readonly job: JobInfo }
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
    }
  /** Product-defined. Stored and replayed by core, rendered by clients, unseen by the model. */
  | { readonly kind: "note"; readonly type: string; readonly data?: JsonValue };

/** Run inputs as a branch declares them: the fold of its config commits, latest field wins. */
export interface BranchConfig {
  readonly model?: ModelRef;
  readonly thinkingLevel?: string;
  readonly agent?: string;
}

export type RunPhase =
  | { readonly kind: "respond" }
  | { readonly kind: "tools" }
  | { readonly kind: "waiting" }
  | { readonly kind: "retry"; readonly at: number; readonly error: string }
  | { readonly kind: "done" }
  | { readonly kind: "aborted" }
  | { readonly kind: "failed"; readonly error: string };

/** A run in a terminal phase will never advance; only a new run follows it. */
export function isTerminalPhase(phase: RunPhase): boolean {
  return phase.kind === "done" || phase.kind === "aborted" || phase.kind === "failed";
}

export interface ToolProgress {
  readonly text: string;
  readonly title?: string;
  readonly details?: JsonValue;
}
