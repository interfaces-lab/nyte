/**
 * The read models a snapshot carries: the transcript, the context status, the
 * per-file change totals. Core's projections build them; a client only
 * reads them, so their shapes live here.
 */
import type { Message } from "@nyte-ai/schema";
import type { CommitBody, Failure, Oid, ToolClass } from "./kernel.ts";
import type { RunId } from "./sdk.ts";

type UserMessage = Extract<Message, { role: "user" }>;

export interface UserTurnPart {
  kind: "user";
  commit: Oid;
  parent: Oid | null;
  content: UserMessage["content"];
  /** The submission key the landed change carried, when the sender gave one. */
  key?: string;
}

export type ToolTurnPart = {
  readonly kind: "tool";
  readonly callId: string;
  /** The settled class once the result commit landed, else the call's. */
  readonly class: ToolClass;
  /** Absent while the call has not settled on this branch. */
  readonly result?: { readonly commit: Oid; readonly output: string; readonly isError: boolean };
};

export type TurnPart =
  | UserTurnPart
  | {
      readonly kind: "assistant";
      readonly commit: Oid;
      readonly contentIndex: number;
      readonly text: string;
    }
  | {
      readonly kind: "thinking";
      readonly commit: Oid;
      readonly contentIndex: number;
      readonly text: string;
    }
  | ToolTurnPart;

export type Turn =
  | {
      kind: "turn";
      id: Oid;
      /** The run that wrote the turn's commits. A turn of only a user message has none yet. */
      run?: RunId;
      parts: TurnPart[];
      /** Why the turn's assistant message stopped, when it stopped with `error` or `aborted`. */
      failure?: Failure;
      /** When the turn's first commit landed. */
      startedAt: number;
      /**
       * How long the turn's commits span. A turn of one commit spans zero,
       * which is a turn nothing followed rather than a turn that took no time.
       * The number is the record's, so every client that draws the turn reports
       * the same one however many times the transcript is rebuilt.
       */
      durationMs: number;
    }
  | {
      kind: "checkpoint";
      commit: Oid;
      at: number;
      body: Extract<CommitBody, { kind: "checkpoint" }>;
    }
  | {
      kind: "summary";
      commit: Oid;
      at: number;
      body: Extract<CommitBody, { kind: "summary" }>;
    }
  | {
      kind: "config";
      commit: Oid;
      at: number;
      body: Extract<CommitBody, { kind: "config" }>;
    };

export interface ContextStatus {
  /** Estimated tokens in the context that would be sent on the next step. */
  readonly estimatedTokens: number;
  /** Tokens reported by the last settled assistant turn, when available. */
  readonly lastTurnTokens?: number;
  /** Tokens covered by the latest provider usage report. */
  readonly usageTokens: number;
  /** Locally estimated tokens appended after the latest usage report. */
  readonly trailingTokens: number;
  readonly contextWindow: number;
  readonly percent?: number;
}

export interface FileChange {
  readonly path: string;
  readonly added: number;
  readonly removed: number;
}

export type FileDiffKind = "added" | "modified" | "deleted" | "renamed";

/** One file of a run's diff. A binary file counts zero lines and carries the patch git prints. */
export interface FileDiff {
  readonly path: string;
  readonly kind: FileDiffKind;
  readonly added: number;
  readonly removed: number;
  readonly patch: string;
}
