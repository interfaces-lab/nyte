/**
 * The log is the event stream. This projects one `LogItem` into the durable
 * `SessionEvent` a client renders, and one live `HarnessEvent` into the
 * ephemeral overlay that references the provisioned entry it settles into.
 *
 * Nothing here reads storage: a projection consumes what it was handed, so a
 * replaying watcher and a live watcher produce the same events for the same
 * item. That rule shapes the event types: an event carries exactly what its
 * log item knows. Claim state has its own `claim` events, and usage comes from
 * `runs.get`, which can read the ledger; projecting either onto a run boundary
 * event would mean inventing values here.
 */
import type { HarnessEvent } from "../harness/agent-harness.ts";
import { toJsonValue } from "../harness/session/types.ts";
import type { Entry, JsonValue, LogItem } from "../harness/session/types.ts";
import { transcriptFromEntries } from "../views/transcript.ts";
import type { DurableEvent, EphemeralEvent, RunEnd, ToolProgress } from "./types.ts";

/**
 * A durable item becomes at most one event. Items with no client meaning
 * (step attempts, tool intents, usage records, internal facts) project to
 * `undefined` rather than to a event kind nobody renders.
 */
export function durableEvent(item: LogItem): DurableEvent | undefined {
  switch (item.kind) {
    case "entry":
      return entryEvent(item.entry, item.seq);
    case "head":
      return {
        seq: item.seq,
        kind: "head_moved",
        head: item.head,
        to: item.leafId,
        by: item.by,
      };
    case "fact":
      return { seq: item.seq, kind: "name_changed", name: item.name };
    case "claim":
      return {
        seq: item.seq,
        kind: "claim",
        head: item.event.kind === "released" ? item.event.head : item.event.claim.head,
        runId: item.event.kind === "released" ? item.event.runId : item.event.claim.runId,
        state: item.event.kind,
      };
    case "record":
      return recordEvent(item, item.seq);
    case "fact_value":
      return undefined;
    default: {
      const exhaustive: never = item;
      return exhaustive;
    }
  }
}

function entryEvent(entry: Entry, seq: number): DurableEvent | undefined {
  if (entry.type === "compaction") {
    return { seq, kind: "compaction", entryId: entry.id, summary: entry.summary };
  }
  // One entry projects on its own so a live watcher never re-reads the branch.
  // A client that wants the assembled conversation calls `messages.list`.
  const turn = transcriptFromEntries([entry])[0];
  if (turn === undefined) return undefined;
  return { seq, kind: "message", entryId: entry.id, turn };
}

function recordEvent(
  item: Extract<LogItem, { kind: "record" }>,
  seq: number,
): DurableEvent | undefined {
  const { record } = item;
  switch (record.type) {
    case "operation_started":
      return {
        seq,
        kind: "run_started",
        runId: record.id,
        head: record.head,
        startedAt: record.timestamp,
        operation: record.intent.kind,
        ...(record.config?.agent === undefined ? {} : { agent: record.config.agent }),
      };
    case "operation_finished":
      return {
        seq,
        kind: "run_finished",
        runId: record.runId,
        head: record.head,
        finishedAt: record.timestamp,
        outcome: runEnd(record.outcome, record.error),
      };
    case "queue_enqueued": {
      // Queue targets are admitted user messages; anything else is not a
      // pending item a client can edit, so it projects to nothing.
      if (record.target.message.role !== "user") return undefined;
      return {
        seq,
        kind: "queued",
        item: {
          entryId: record.target.id,
          delivery: record.queue === "followUp" ? "queue" : record.queue,
          content: record.target.message.content,
        },
      };
    }
    case "queue_consumed":
      return { seq, kind: "queue_consumed", entryId: record.entryId };
    case "queue_cancelled":
      return { seq, kind: "queue_cancelled", entryId: record.entryId };
    default:
      return undefined;
  }
}

function runEnd(
  outcome: "completed" | "aborted" | "failed",
  error: { code: string; message: string } | undefined,
): RunEnd {
  switch (outcome) {
    case "completed":
      return { kind: "completed" };
    case "aborted":
      return { kind: "aborted" };
    case "failed":
      return { kind: "failed", error: { message: error?.message ?? "run failed" } };
    default: {
      const exhaustive: never = outcome;
      return exhaustive;
    }
  }
}

/**
 * A tool's partial result is author-shaped and typed `any` upstream, so it is
 * narrowed here like any boundary value: text parts flatten, images become
 * placeholders, anything else contributes nothing.
 */
function toolProgress(partialResult: unknown): ToolProgress {
  if (typeof partialResult !== "object" || partialResult === null) return { text: "" };
  const content = "content" in partialResult ? partialResult.content : undefined;
  const title = "title" in partialResult ? partialResult.title : undefined;
  const details = "details" in partialResult ? jsonDetails(partialResult.details) : undefined;
  const text = Array.isArray(content)
    ? content
        .map(partText)
        .filter((part) => part !== "")
        .join("\n")
    : "";
  return {
    text,
    ...(typeof title === "string" ? { title } : {}),
    ...(details === undefined ? {} : { details }),
  };
}

/** A partial that does not round-trip through JSON drops rather than throws (invariant 31). */
function jsonDetails(value: unknown): JsonValue | undefined {
  if (value === undefined) return undefined;
  try {
    return toJsonValue(value);
  } catch {
    return undefined;
  }
}

function partText(part: unknown): string {
  if (typeof part !== "object" || part === null || !("type" in part)) return "";
  if (part.type === "text" && "text" in part && typeof part.text === "string") return part.text;
  if (part.type === "image" && "mimeType" in part && typeof part.mimeType === "string") {
    return `[image ${part.mimeType}]`;
  }
  return "";
}

/** A live harness event becomes an overlay, or nothing a client can use. */
export function ephemeralEvent(event: HarnessEvent): EphemeralEvent | undefined {
  switch (event.type) {
    case "message_update": {
      const update = event.assistantMessageEvent;
      if (update.type === "text_delta") {
        return {
          kind: "text_delta",
          entryId: event.entryId,
          contentIndex: update.contentIndex,
          delta: update.delta,
        };
      }
      if (update.type === "thinking_delta") {
        return {
          kind: "reasoning_delta",
          entryId: event.entryId,
          contentIndex: update.contentIndex,
          delta: update.delta,
        };
      }
      return undefined;
    }
    case "tool_execution_update":
      return {
        kind: "tool_progress",
        entryId: event.entryId,
        callId: event.toolCallId,
        progress: toolProgress(event.partialResult),
      };
    case "retry_scheduled":
      return {
        kind: "retry_scheduled",
        runId: event.runId,
        attempt: event.attempt,
        maxAttempts: event.maxAttempts,
        at: Date.now() + event.delayMs,
        message: event.errorMessage,
      };
    case "retry_start":
      return { kind: "retry_started", runId: event.runId, attempt: event.attempt };
    case "compaction_start":
      return { kind: "compacting", runId: event.runId, reason: event.reason };
    case "plugin_updated":
      return { kind: "plugins_changed", plugins: event.plugins };
    case "handler_error":
      // A hook, listener, or plugin failure is contained (invariant 21), but a
      // client should still hear about it; it arrives as the diagnostic it is.
      return {
        kind: "diagnostic",
        owner:
          event.kind === "hook"
            ? `hook ${event.hook}`
            : event.kind === "event"
              ? `listener ${event.event}`
              : `plugin ${event.plugin}`,
        level: "error",
        message: event.error,
      };
    case "diagnostic":
      return {
        kind: "diagnostic",
        owner: event.owner,
        level: event.level,
        message: event.message,
      };
    default:
      return undefined;
  }
}
