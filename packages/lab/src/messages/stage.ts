/**
 * What `screens/thread.tsx` derives from a session before `Timeline` draws it,
 * minus the queries: the same app functions, called in the same order.
 */
import { EMPTY_LIVE_PARTS, isTerminalPhase } from "@nyte-ai/client";
import { IDLE, projectLive } from "@nyte-ai/app/live-fold.ts";
import type { LiveSnapshot } from "@nyte-ai/app/live-fold.ts";
import { displayTranscriptParts } from "@nyte-ai/app/conversation/transcript-presentation.ts";
import { rendersInTranscript, transcriptRows } from "@nyte-ai/app/conversation/transcript-rows.ts";
import type { TranscriptRow } from "@nyte-ai/app/conversation/transcript-rows.ts";
import type { Scene } from "./specimens";

export interface Stage {
  readonly live: LiveSnapshot;
  readonly rows: readonly TranscriptRow[];
  readonly working: boolean;
  readonly settledWork: boolean;
}

export function stage(scene: Scene): Stage {
  const live =
    scene.run === undefined
      ? IDLE
      : projectLive(IDLE, scene.overlay ?? EMPTY_LIVE_PARTS, scene.run);

  const landing = scene.landing ?? [];
  const running = scene.run !== undefined && !isTerminalPhase(scene.run.phase);
  const working = live.runState !== "idle" || running || landing.length > 0;
  const lastTurn = scene.transcript.findLast(rendersInTranscript);

  const settledWork =
    lastTurn?.kind === "turn" && displayTranscriptParts(lastTurn.parts).at(-1)?.kind === "step";

  const rows = transcriptRows({
    loading: scene.loading === true,
    failed: scene.failed === true,
    turns: scene.transcript,
    landing,
    retrying: live.runState === "retrying" ? live.retry.message : undefined,
    working,
  });

  return { live, rows, working, settledWork };
}

/** Each row the scene became, and how a turn row's parts were regrouped for drawing. */
export function trail({ rows, live, working }: Stage): readonly string[] {
  return rows.flatMap((row): readonly string[] => {
    switch (row.kind) {
      case "skeleton":
      case "error":
        return [row.kind];
      case "retry":
        return [`retry "${row.message}"`];
      case "landing":
        return [`landing${row.pending ? " · pending" : ""}`];
      case "live": {
        if (!row.working) return [];

        const overlay = (
          [
            ["text", live.text.size],
            ["thinking", live.thinking.size],
            ["tools", live.tools.size],
          ] as const
        )
          .flatMap(([name, size]) => (size > 0 ? [`${name}×${String(size)}`] : []))
          .join(" ");

        return [`live · ${live.runState}${overlay === "" ? "" : ` · ${overlay}`}`];
      }

      case "turn": {
        const turns = [row.turn, ...row.continuations];

        const head = `turn${row.trailing && working ? " · trailing, running" : ""}${
          row.continuations.length > 0 ? ` · +${String(row.continuations.length)} continuation` : ""
        }`;

        return [
          head,
          ...turns.flatMap((entry, turnIndex): readonly string[] => {
            if (entry.kind !== "turn") return [`  ${entry.kind}`];

            const display = displayTranscriptParts(entry.parts);
            const running = row.trailing && working && turnIndex === turns.length - 1;

            const groups = display.map((item, index) => {
              switch (item.kind) {
                case "part":
                  return `  ${item.part.kind}${item.part.kind === "tool" ? `:${item.part.class.kind}` : ""}`;
                case "response":
                  return `  response ×${String(item.parts.length)}`;
                case "step": {
                  const kinds = item.parts
                    .map((part) => (part.kind === "tool" ? part.class.kind : part.kind))
                    .join(", ");

                  // TurnBody unwraps a settled one-call step back into its part.
                  const lone =
                    item.parts.length === 1 &&
                    item.parts[0]?.kind === "tool" &&
                    !(running && index === display.length - 1);

                  return lone ? `  step → line [${kinds}]` : `  step [${kinds}]`;
                }

                default: {
                  const _exhaustive: never = item;

                  return _exhaustive;
                }
              }
            });

            return entry.failure === undefined
              ? groups
              : [...groups, `  failure ${entry.failure.class}`];
          }),
        ];
      }

      default: {
        const _exhaustive: never = row;

        return _exhaustive;
      }
    }
  });
}
