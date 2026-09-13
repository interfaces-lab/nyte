/**
 * The read models a snapshot carries: the transcript, the context status, the
 * per-file change totals. Core's projections build them; a client only
 * reads them, so their shapes live here.
 */
import type { JsonValue, Message } from "@nyte-ai/schema";
import type { CommitBody, Oid } from "./kernel.ts";

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
  kind: "tool";
  callId: string;
  toolName: string;
  /** Absent when the call itself is not on this branch and only its result is. */
  args?: JsonValue;
  result?: {
    commit: Oid;
    output: string;
    details?: JsonValue;
    title?: string;
    isError: boolean;
  };
};

export type TurnPart =
  | UserTurnPart
  | { kind: "assistant"; commit: Oid; contentIndex: number; text: string }
  | { kind: "thinking"; commit: Oid; contentIndex: number; text: string }
  | ToolTurnPart
  | { kind: "note"; commit: Oid; text: string };

export type TurnOutcome = "completed" | "aborted" | "failed";

export type Turn =
  | {
      kind: "turn";
      id: Oid;
      parts: TurnPart[];
      outcome: TurnOutcome;
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
    }
  | {
      kind: "note";
      commit: Oid;
      at: number;
      body: Extract<CommitBody, { kind: "note" }>;
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
  /** The settled tool-result commit that last touched the file. */
  readonly lastCommit: Oid;
}
