/**
 * Renderer lookups over the observer's live overlay, as pure functions.
 *
 * `@nyte-ai/client` folds the stream; this file only derives what
 * the transcript views index by: streaming text per part, tool progress per
 * call, arrival order, and what the run's phase means for the overlay.
 * Identities survive a frame that changed none of them, so settled turns do
 * not re-render per token.
 */
import type { RunId, RunInfo, ToolProgress } from "@nyte-ai/protocol";
import { EMPTY_LIVE_PARTS } from "@nyte-ai/client";
import type { LivePart, LiveParts } from "@nyte-ai/client";

export type LivePartRef = Omit<Exclude<LivePart, { kind: "tool" }>, "text">;

export interface LiveToolProgress {
  readonly runId: RunId;
  readonly progress: ToolProgress;
}

export type LiveRunState = LiveSnapshot["runState"];

type LiveRun =
  | { readonly runState: "idle" | "working" | "stopping"; readonly retry?: never }
  | {
      readonly runState: "retrying";
      readonly retry: { readonly at: number; readonly message: string };
    };

export type LiveSnapshot = LiveRun & {
  readonly parts: LiveParts;
  /** Streaming text by `${runId}:${attempt}:${index}`. */
  readonly text: ReadonlyMap<string, string>;
  readonly thinking: ReadonlyMap<string, string>;
  readonly tools: ReadonlyMap<string, LiveToolProgress>;
  /** Arrival order of in-flight text and reasoning parts. */
  readonly order: readonly LivePartRef[];
};

export const IDLE: LiveSnapshot = {
  parts: EMPTY_LIVE_PARTS,
  runState: "idle",
  text: new Map(),
  thinking: new Map(),
  tools: new Map(),
  order: [],
};

export function livePartKey(runId: RunId, attempt: number, index: number): string {
  return `${runId}:${String(attempt)}:${String(index)}`;
}

/** Streaming or calling tools is work; a retry waits out its delay; a flagged stop is settling; anything else leaves the overlay idle. */
export function liveRun(run: RunInfo | undefined): LiveRun {
  if (run === undefined) return { runState: "idle" };

  switch (run.phase.kind) {
    case "respond":
    case "tools":
      return { runState: run.abortRequested === true ? "stopping" : "working" };
    case "retry":
      return run.abortRequested === true
        ? { runState: "stopping" }
        : {
            runState: "retrying",
            retry: { at: run.phase.at, message: run.phase.failure.message },
          };
    case "waiting":
      return { runState: run.abortRequested === true ? "stopping" : "idle" };
    case "done":
    case "aborted":
    case "failed":
      return { runState: "idle" };
    default: {
      const _exhaustive: never = run.phase;

      return _exhaustive;
    }
  }
}

function sameRun(previous: LiveRun, next: LiveRun): boolean {
  return (
    previous.runState === next.runState &&
    previous.retry?.at === next.retry?.at &&
    previous.retry?.message === next.retry?.message
  );
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
 * Renderer lookups derived from core's ordered overlay, with no folding rules.
 * A text delta leaves `tools` and `order` at their previous identity: every
 * settled turn reads `tools`, and a fresh map per token would re-render them
 * all on each frame.
 */
export function projectLive(
  previous: LiveSnapshot,
  parts: LiveParts,
  run: RunInfo | undefined,
): LiveSnapshot {
  const state = liveRun(run);

  if (parts === previous.parts) {
    return sameRun(previous, state)
      ? previous
      : {
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

    // A settled response and its successor may reuse the stream identity
    // while a snapshot is pending; both generations stay visible in this slot.
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
