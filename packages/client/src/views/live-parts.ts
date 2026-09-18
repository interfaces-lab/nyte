import type { RunId, SessionEvent, ToolProgress } from "@nyte-ai/protocol";

export type LivePart =
  | {
      readonly kind: "text";
      readonly runId: RunId;
      readonly attempt: number;
      readonly index: number;
      readonly text: string;
    }
  | {
      readonly kind: "thinking";
      readonly runId: RunId;
      readonly attempt: number;
      readonly index: number;
      readonly text: string;
    }
  | {
      readonly kind: "tool";
      readonly runId: RunId;
      readonly callId: string;
      readonly progress: ToolProgress;
    };

/** Text keeps its first arrival position; tool progress moves to its latest arrival. */
export type LiveParts = readonly LivePart[];

export const EMPTY_LIVE_PARTS: LiveParts = [];

/** Stable identity of a provisional part, independent of a renderer. */
export function livePartKey(part: LivePart): string {
  switch (part.kind) {
    case "text":
    case "thinking":
      return `${part.kind}:${part.runId}:${String(part.attempt)}:${String(part.index)}`;
    case "tool":
      return `tool:${part.callId}`;
    default: {
      const exhaustive: never = part;
      return exhaustive;
    }
  }
}

function retainParts(parts: LiveParts, keep: (part: LivePart) => boolean): LiveParts {
  const remaining = parts.filter(keep);
  return remaining.length === parts.length ? parts : remaining;
}

/**
 * Fold a head's stream in arrival order. The caller owns head selection and
 * reconnects start from EMPTY_LIVE_PARTS. Seq is a cursor, not an event identity:
 * a head move and several commits can share it.
 */
export function foldLiveParts(parts: LiveParts, event: SessionEvent): LiveParts {
  switch (event.kind) {
    case "text_delta":
    case "reasoning_delta": {
      const part = {
        kind: event.kind === "text_delta" ? "text" : "thinking",
        runId: event.runId,
        attempt: event.attempt,
        index: event.index,
        text: event.delta,
      } satisfies LivePart;
      // The part a delta extends is almost always the newest, so search from the end.
      const key = livePartKey(part);
      const index = parts.findLastIndex((existing) => livePartKey(existing) === key);
      const existing = parts[index];
      if (existing === undefined || existing.kind === "tool") return [...parts, part];
      const next = [...parts];
      next[index] = { ...part, text: existing.text + event.delta };
      return next;
    }
    case "tool_progress":
      return [
        ...parts.filter((part) => part.kind !== "tool" || part.callId !== event.callId),
        {
          kind: "tool",
          runId: event.runId,
          callId: event.callId,
          progress: event.progress,
        },
      ];
    case "run":
      switch (event.run.phase.kind) {
        case "retry":
        case "done":
        case "aborted":
        case "failed":
          return retainParts(parts, (part) => part.runId !== event.run.runId);
        case "respond":
        case "tools":
        case "waiting":
          return parts;
        default: {
          const exhaustive: never = event.run.phase;
          return exhaustive;
        }
      }
    case "commit": {
      const commit = event.item.commit;
      if (commit.body.kind === "checkpoint") return EMPTY_LIVE_PARTS;
      if (commit.body.kind !== "message") return parts;
      const message = commit.body.message;
      switch (message.role) {
        case "assistant":
          // Responses are serialized within a run. Its deltas flush before the
          // commit, and tool execution starts after it, so no newer part exists.
          return commit.run === undefined
            ? parts
            : retainParts(parts, (part) => part.runId !== commit.run);
        case "toolResult":
          return retainParts(
            parts,
            (part) => part.kind !== "tool" || part.callId !== message.toolCallId,
          );
        case "user":
          return parts;
        default: {
          const exhaustive: never = message;
          return exhaustive;
        }
      }
    }
    case "activation_changed":
    case "job":
    case "synced":
    case "plugins_changed":
    case "notification":
    case "status_changed":
    case "head_moved":
    case "compaction":
    case "queued":
    case "landed":
    case "queue_cancelled":
    case "config_queued":
    case "stack":
    case "fact":
    case "deleted":
    case "effect":
    case "diagnostic":
      return parts;
    default: {
      const exhaustive: never = event;
      return exhaustive;
    }
  }
}
