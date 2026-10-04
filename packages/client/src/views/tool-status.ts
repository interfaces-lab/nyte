import type { ToolReason, ToolState, TurnToolClass } from "@nyte-ai/protocol";

export type ToolTense = "running" | "past" | "none";

export type ToolTone = "running" | "attention" | "success" | "failure" | "stopped";

export type ToolWord =
  | `Exit ${number}`
  | "Needs input"
  | "Failed"
  | "Timed out"
  | "Blocked"
  | "Stopped"
  | "Interrupted";

export interface ToolStatus {
  readonly tense: ToolTense;
  readonly tone: ToolTone;
  readonly word: ToolWord | undefined;
}

export type ShellFacts = NonNullable<Extract<TurnToolClass, { readonly kind: "shell" }>["facts"]>;

const RUNNING: ToolStatus = { tense: "running", tone: "running", word: undefined };

function failed(reason: ToolReason): ToolStatus {
  switch (reason.kind) {
    case "exit":
      return { tense: "past", tone: "failure", word: `Exit ${reason.code}` };
    case "error":
      return { tense: "none", tone: "failure", word: "Failed" };
    case "timeout":
      return { tense: "none", tone: "failure", word: "Timed out" };
    case "denied":
      return { tense: "none", tone: "failure", word: "Blocked" };
    case "cancelled":
      return { tense: "none", tone: "stopped", word: "Stopped" };
    case "interrupted":
      return { tense: "none", tone: "stopped", word: "Interrupted" };
    default: {
      const _exhaustive: never = reason;

      return _exhaustive;
    }
  }
}

/**
 * The one reading of a call's state every surface draws. A verb appears only
 * when it is true: present while open, past once the tool finished on its own
 * (success, or a command that ran and exited nonzero), none otherwise, when
 * the subject and the word say what happened ("pnpm test · Timed out").
 */
export function toolStatus(state: ToolState): ToolStatus {
  switch (state.kind) {
    case "pending":
      return RUNNING;
    case "running": {
      const { waitingFor } = state;

      if (waitingFor === undefined) return RUNNING;

      switch (waitingFor.kind) {
        case "input":
          return { tense: "running", tone: "attention", word: "Needs input" };
        default: {
          const _exhaustive: never = waitingFor.kind;

          return _exhaustive;
        }
      }
    }

    case "success":
      return { tense: "past", tone: "success", word: undefined };
    case "error":
      return failed(state.reason);
    default: {
      const _exhaustive: never = state;

      return _exhaustive;
    }
  }
}

/** A measured span as a duration: tenths under ten seconds, then whole units. */
export function formatToolDuration(ms: number): string {
  const seconds = Math.max(0, ms) / 1000;

  if (seconds < 10) return `${seconds.toFixed(1)}s`;

  if (seconds < 60) return `${String(Math.floor(seconds))}s`;
  const minutes = Math.floor(seconds / 60);

  if (minutes < 60) return `${String(minutes)}m ${String(Math.floor(seconds % 60))}s`;

  return `${String(Math.floor(minutes / 60))}h ${String(minutes % 60)}m`;
}
