/**
 * The overlay fold for one open session's `watch` events, as pure functions.
 *
 * Durable events refresh one kernel snapshot. Streaming text stays provisional
 * under `(runId, attempt, index)` until its assistant commit lands. Core owns
 * accumulation and settlement; this adapter owns renderer lookups and refreshes.
 */
import type { RunId, RunInfo, Seq, SessionEvent, ToolProgress } from "@nyte-ai/core";
import { EMPTY_LIVE_PARTS, foldLiveParts } from "@nyte-ai/core/views";
import type { LivePart, LiveParts } from "@nyte-ai/core/views";

export type LivePartRef = Omit<Exclude<LivePart, { kind: "tool" }>, "text">;

export interface LiveToolProgress {
  readonly runId: RunId;
  readonly progress: ToolProgress;
}

export interface LiveDiagnostic {
  readonly owner: string;
  readonly level: "info" | "warn" | "error";
  readonly message: string;
}

export type LiveState = {
  readonly parts: LiveParts;
  readonly diagnostics: readonly LiveDiagnostic[];
} & (
  | { readonly runState: "idle" | "working"; readonly retry?: never }
  | {
      readonly runState: "retrying";
      readonly retry: { readonly at: number; readonly message: string };
    }
);

export type LiveRunState = LiveState["runState"];

export type LiveSnapshot = LiveState & {
  /** Streaming text by `${runId}:${attempt}:${index}`. */
  readonly text: ReadonlyMap<string, string>;
  readonly thinking: ReadonlyMap<string, string>;
  readonly tools: ReadonlyMap<string, LiveToolProgress>;
  /** Arrival order of in-flight text and reasoning parts. */
  readonly order: readonly LivePartRef[];
};

/** How many diagnostics the overlay keeps; older ones scroll off. */
const DIAGNOSTIC_LIMIT = 3;

export const IDLE: LiveSnapshot = {
  parts: EMPTY_LIVE_PARTS,
  runState: "idle",
  text: new Map(),
  thinking: new Map(),
  tools: new Map(),
  order: [],
  diagnostics: [],
};

export function livePartKey(runId: RunId, attempt: number, index: number): string {
  return `${runId}:${String(attempt)}:${String(index)}`;
}

function sameTools(
  previous: ReadonlyMap<string, LiveToolProgress>,
  next: ReadonlyMap<string, LiveToolProgress>,
): boolean {
  if (previous.size !== next.size) return false;
  for (const [callId, tool] of next) {
    const before = previous.get(callId);
    if (before === undefined || before.runId !== tool.runId || before.progress !== tool.progress) {
      return false;
    }
  }
  return true;
}

function sameOrder(previous: readonly LivePartRef[], next: readonly LivePartRef[]): boolean {
  return (
    previous.length === next.length &&
    previous.every((ref, index) => {
      const other = next[index];
      return (
        other !== undefined &&
        ref.kind === other.kind &&
        ref.runId === other.runId &&
        ref.attempt === other.attempt &&
        ref.index === other.index
      );
    })
  );
}

/**
 * Renderer lookups derived from core's ordered stream, with no folding rules.
 * A text delta leaves `tools` and `order` at their previous identity: every
 * settled turn reads `tools`, and a fresh map per token would re-render them
 * all on each frame.
 */
export function projectLive(
  previous: LiveSnapshot,
  state: LiveState,
  parts: LiveParts = state.parts,
): LiveSnapshot {
  if (state === previous && parts === previous.parts) return previous;
  if (parts === previous.parts) {
    return {
      ...state,
      parts,
      text: previous.text,
      thinking: previous.thinking,
      tools: previous.tools,
      order: previous.order,
    };
  }
  const text = new Map<string, string>();
  const thinking = new Map<string, string>();
  const tools = new Map<string, LiveToolProgress>();
  const order: LivePartRef[] = [];
  for (const part of parts) {
    if (part.kind === "tool") {
      const before = previous.tools.get(part.callId);
      tools.set(
        part.callId,
        before !== undefined && before.runId === part.runId && before.progress === part.progress
          ? before
          : { runId: part.runId, progress: part.progress },
      );
      continue;
    }
    const key = livePartKey(part.runId, part.attempt, part.index);
    const texts = part.kind === "text" ? text : thinking;
    // A settled response and its successor may reuse the stream identity.
    // Until the snapshot arrives, both generations remain visible in this slot.
    if (!texts.has(key)) {
      order.push({ kind: part.kind, runId: part.runId, attempt: part.attempt, index: part.index });
    }
    texts.set(key, (texts.get(key) ?? "") + part.text);
  }
  return {
    ...state,
    parts,
    text,
    thinking,
    tools: sameTools(previous.tools, tools) ? previous.tools : tools,
    order: sameOrder(previous.order, order) ? previous.order : order,
  };
}

function withoutRetry(snapshot: LiveState, runState: Exclude<LiveRunState, "retrying">): LiveState {
  return {
    parts: snapshot.parts,
    runState,
    diagnostics: snapshot.diagnostics,
  };
}

function foldRun(snapshot: LiveState, run: RunInfo): LiveState {
  switch (run.phase.kind) {
    case "respond":
    case "tools":
      return withoutRetry(snapshot, "working");
    case "retry":
      // The attempt that failed streamed into these buffers; nothing commits it.
      return {
        parts: snapshot.parts,
        diagnostics: snapshot.diagnostics,
        runState: "retrying",
        retry: { at: run.phase.at, message: run.phase.error },
      };
    case "waiting":
      return withoutRetry(snapshot, "idle");
    case "done":
    case "aborted":
    case "failed":
      return withoutRetry(snapshot, "idle");
    default: {
      const _exhaustive: never = run.phase;
      return _exhaustive;
    }
  }
}

interface FoldResult {
  readonly snapshot: LiveState;
  /** The seq the settled thread must reach after this event; absent for ephemeral events. */
  readonly refreshAt?: Seq;
}

/** Fold one watch event into the overlay. Pure: the caller applies the result. */
export function foldState(snapshot: LiveState, event: SessionEvent): FoldResult {
  const parts = foldLiveParts(snapshot.parts, event);
  const current = parts === snapshot.parts ? snapshot : { ...snapshot, parts };
  switch (event.kind) {
    case "activation_changed":
    case "job":
    case "synced":
    case "plugins_changed":
    case "notification":
    case "status_changed":
      return { snapshot };
    case "commit":
      return { snapshot: current, refreshAt: event.seq };
    case "run":
      return { snapshot: foldRun(current, event.run), refreshAt: event.seq };
    case "head_moved":
    case "compaction":
    case "queued":
    case "landed":
    case "queue_cancelled":
    case "stack":
    case "fact":
    case "deleted":
      return { snapshot, refreshAt: event.seq };
    case "effect":
      // Parked controls come from the snapshot, including waits announced before
      // the run phase changes or while another parallel tool is still running.
      return {
        snapshot: event.state === "waiting" ? withoutRetry(snapshot, "idle") : snapshot,
        refreshAt: event.seq,
      };
    case "text_delta":
    case "reasoning_delta":
    case "tool_progress":
      return { snapshot: withoutRetry(current, "working") };
    case "diagnostic":
      return {
        snapshot: {
          ...snapshot,
          diagnostics: [
            ...snapshot.diagnostics.slice(1 - DIAGNOSTIC_LIMIT),
            { owner: event.owner, level: event.level, message: event.message },
          ],
        },
      };
    default: {
      const _exhaustive: never = event;
      return _exhaustive;
    }
  }
}

/**
 * The overlay after a watch resumes from a fresh snapshot: everything before
 * its seq is settled in that snapshot, so no buffer survives, and the run
 * state comes from the run the snapshot reports.
 */
export function resumeFrom(snapshot: LiveState, run: RunInfo | undefined): LiveSnapshot {
  const cleared = { ...IDLE, diagnostics: snapshot.diagnostics };
  return run === undefined ? cleared : projectLive(cleared, foldRun(cleared, run));
}
