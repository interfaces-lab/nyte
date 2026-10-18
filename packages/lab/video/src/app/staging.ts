import type { SessionView } from "@nyte-ai/sdk";
import { displayTranscriptParts } from "@nyte-ai/app/conversation/transcript-presentation.ts";
import { transcriptRows } from "@nyte-ai/app/conversation/transcript-rows.ts";
import type { TranscriptRow } from "@nyte-ai/app/conversation/transcript-rows.ts";
import { showsTool } from "@nyte-ai/plugin/client/presentation";
import type { Scene } from "../../../src/messages/build";

export interface Staged {
  readonly rows: readonly TranscriptRow[];
  readonly changes: SessionView["changes"];
  readonly working: boolean;
  readonly settledWork: boolean;
}

/** The lab's staging, with the changes the transcript rows now read. */
export function staged(scene: Scene): Staged {
  const landing = scene.landing ?? [];
  const running = scene.execution !== undefined && scene.execution.kind !== "idle";
  const working = running || landing.length > 0;
  const lastTurn = scene.turns.at(-1);
  const settledWork = lastTurn !== undefined && displayTranscriptParts(lastTurn.messages).at(-1)?.kind === "step";

  const changes = scene.turns.flatMap((turn) =>
    turn.messages.flatMap((message): SessionView["changes"] => {
      if (!showsTool(message) || message.state.phase !== "settled") return [];
      const { changes: changed, name } = message.state;
      if (changed === null) return [];
      return changed.paths.map((path) => ({
        path,
        status: name === "write" && changed.removed === 0 ? "added" : "modified",
        added: changed.added,
        removed: changed.removed,
      }));
    }),
  );

  const rows = transcriptRows({
    loading: scene.loading === true,
    failed: scene.failed === true,
    turns: scene.turns,
    changes,
    landing,
    held: scene.execution?.kind === "idle" && scene.execution.lastRun?.end.kind !== "completed",
    retrying: scene.execution?.kind === "retrying" ? scene.execution.reason : undefined,
    working,
    running,
  });

  return { rows, changes, working, settledWork };
}
