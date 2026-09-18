import type { ToolProgress, ToolTurnPart } from "@nyte-ai/protocol";
import type { LiveSnapshot, LiveToolProgress } from "../live.ts";
import { activityVerb, presentTool } from "./tool-detail.ts";
import type { ToolPresentation } from "./tool-detail.ts";
import { formatRunDuration } from "./transcript-presentation.ts";
import type { WorkTurnPart } from "./transcript-presentation.ts";

interface PresentedTool {
  readonly part: ToolTurnPart;
  progress: ToolProgress | undefined;
  presentation: ToolPresentation;
}

export interface WorkGroupPresentationInput {
  readonly parts: readonly WorkTurnPart[];
  readonly liveTools: ReadonlyMap<string, LiveToolProgress>;
  readonly cwd: string | undefined;
  readonly durationMs: number;
  readonly running: boolean;
  readonly live?: LiveSnapshot;
  readonly stale: boolean;
}

/**
 * Own one cache per mounted work group. Inputs are immutable snapshots, but may
 * move backwards after an abandoned render. No returned value shares mutable
 * cache state. Parts/cwd changes rebuild the index; progress frames visit only
 * the previous and current live tool maps, including removed overlays.
 */
export function createWorkGroupPresentation() {
  let previousParts: readonly WorkTurnPart[] | undefined;
  let previousCwd: string | undefined;
  let previousLiveTools: ReadonlyMap<string, LiveToolProgress> = new Map();
  let indexed = new Map<string, PresentedTool[]>();
  let byPart = new Map<ToolTurnPart, PresentedTool>();
  let added = 0;
  let removed = 0;
  let activity: string | undefined;

  const contribute = (presentation: ToolPresentation, direction: number): void => {
    added += direction * (presentation.added ?? 0);
    removed += direction * (presentation.removed ?? 0);
  };

  return ({
    parts,
    liveTools,
    cwd,
    durationMs,
    running,
    live,
    stale,
  }: WorkGroupPresentationInput) => {
    if (parts !== previousParts || cwd !== previousCwd) {
      const nextIndex = new Map<string, PresentedTool[]>();
      const nextByPart = new Map<ToolTurnPart, PresentedTool>();
      const runningNames: string[] = [];
      added = removed = 0;
      for (const part of parts) {
        if (part.kind !== "tool") continue;
        const progress = liveTools.get(part.callId)?.progress;
        const cached = byPart.get(part);
        const entry = {
          part,
          progress,
          presentation:
            cached !== undefined && cached.progress === progress && cwd === previousCwd
              ? cached.presentation
              : presentTool(part, progress, cwd),
        };
        nextByPart.set(part, entry);
        const matches = nextIndex.get(part.callId);
        if (matches === undefined) nextIndex.set(part.callId, [entry]);
        else matches.push(entry);
        contribute(entry.presentation, 1);
        if (entry.presentation.state === "running") runningNames.push(part.toolName);
      }
      // Core's public presenter derives status from the durable result, not
      // progress. Thus membership and oldest-first activity order change only
      // during preparation, even for running calls without a live overlay.
      activity = activityVerb(runningNames);
      indexed = nextIndex;
      byPart = nextByPart;
      previousParts = parts;
      previousCwd = cwd;
    } else if (liveTools !== previousLiveTools) {
      const update = (callId: string, progress: ToolProgress | undefined): void => {
        const entries = indexed.get(callId);
        if (entries === undefined) return;
        for (const entry of entries) {
          if (entry.progress === progress) continue;
          contribute(entry.presentation, -1);
          entry.progress = progress;
          entry.presentation = presentTool(entry.part, progress, cwd);
          contribute(entry.presentation, 1);
        }
      };
      for (const [callId, tool] of liveTools) update(callId, tool.progress);
      for (const callId of previousLiveTools.keys()) {
        if (!liveTools.has(callId)) update(callId, undefined);
      }
    }
    previousLiveTools = liveTools;
    // Missing tool results can survive an interrupted run. Only the live run
    // controls group activity; errors remain on their individual tool rows.
    const active = running;
    let verb: string;
    let detail: string | undefined;
    if (active) {
      const newest = live?.order.at(-1);
      verb =
        activity ??
        (live !== undefined && live.tools.size > 0
          ? "Working"
          : newest?.kind === "thinking"
            ? "Thinking"
            : newest?.kind === "text"
              ? "Working"
              : stale
                ? "This is taking a bit longer"
                : "Preparing next move");
    } else {
      verb = "Worked";
      const duration = formatRunDuration(durationMs);
      detail = duration === undefined ? undefined : `for ${duration}`;
    }
    return { active, summary: { verb, detail, added, removed } };
  };
}
